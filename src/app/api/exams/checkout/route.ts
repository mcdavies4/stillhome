import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { rateLimit } from "@/lib/ratelimit";
import { velocityCheck } from "@/lib/velocity";
import { alertFounder } from "@/lib/alerts";
import { cap, normaliseEmail } from "@/lib/security";
import { activeProvider, billsTestMode } from "@/lib/bills";
import { paybetaConfigured, pbExamLookup } from "@/lib/paybeta";
import { ngnPayProvider, flwPayConfigured, flwPayIsTestMode, initializePayment as flwInitialize } from "@/lib/flwpay";
import { initializeTransaction, paystackConfigured, paystackIsTestMode } from "@/lib/paystack";
import { examFee, examIdOk, examMaxOrder, examService } from "@/lib/exams-shared";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Creates a normal Nolgic order for one exam PIN and a naira payment link for it. From here the order follows the SAME
// pipeline as every other bill (verify payment -> vend -> receipt, with review-not-refund whenever the outcome is unclear),
// so nothing about refunds or double-vends is new. Off until EXAMS_ENABLED=1.
export async function POST(req: Request) {
  if (process.env.EXAMS_ENABLED !== "1") return NextResponse.json({ error: "Exam PINs aren't open yet." }, { status: 503 });
  if (!(await rateLimit(req, "exams-checkout", 6, 10)).ok) {
    return NextResponse.json({ error: "Too many attempts. Please wait a few minutes and try again." }, { status: 429 });
  }

  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Bad request" }, { status: 400 }); }

  const email = normaliseEmail(body?.email);
  if (!email) return NextResponse.json({ error: "Enter a valid email address. The PIN is sent there too." }, { status: 400 });
  const service = cap(body?.service, 64);
  const code = cap(body?.code, 64);
  const identifier = cap(body?.identifier, 40).replace(/\s+/g, "");
  if (!service || !code) return NextResponse.json({ error: "Choose a PIN first." }, { status: 400 });

  const svc = examService(service);
  if (!examIdOk(service, identifier)) return NextResponse.json({ error: svc.idError }, { status: 400 });

  if (activeProvider() !== "paybeta" || !paybetaConfigured()) {
    return NextResponse.json({ error: "Exam PINs aren't available right now. Please check back soon." }, { status: 503 });
  }
  const rail = ngnPayProvider();
  if (rail === "flutterwave" ? !flwPayConfigured() : !paystackConfigured()) {
    return NextResponse.json({ error: "Naira payments aren't available yet. Please check back soon." }, { status: 503 });
  }

  // Price and name come from Paybeta's own list, never from the browser.
  let item;
  try { item = await pbExamLookup(service, code); }
  catch { return NextResponse.json({ error: "Exam PINs are temporarily unavailable. Please try again in a few minutes." }, { status: 503 }); }
  if (!item) return NextResponse.json({ error: "That PIN isn't available right now. Please pick it again." }, { status: 400 });
  if (item.price > examMaxOrder()) return NextResponse.json({ error: "That PIN is above the order limit." }, { status: 400 });

  const fee = examFee(item.price);
  const total = item.price + fee;
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || req.headers.get("x-real-ip") || "unknown";

  const approxPence = Math.round((total / Number(process.env.NGN_PER_GBP ?? 1900)) * 100);
  const vel = await velocityCheck({ email, ip, amountGbpPence: approxPence });
  if (vel.blocked) {
    alertFounder("Exam order blocked by velocity check", `Email: ${email}\nIP: ${ip}\nReason: ${vel.reason}\n${item.name} ₦${total.toLocaleString()}`);
    return NextResponse.json({ error: "For your security this order needs review. Please contact nolgichq@gmail.com if you believe this is a mistake." }, { status: 403 });
  }

  const testMode = billsTestMode() || (rail === "flutterwave" ? flwPayIsTestMode() : paystackIsTestMode());
  const billerName = `${svc.title} — ${item.name}`.slice(0, 120);
  const db = supabaseAdmin();
  const { data: order, error } = await db
    .from("orders")
    .insert({
      email, ip, country: "NG", currency: "NGN", payment_provider: rail,
      biller_code: service, item_code: code, biller_name: billerName,
      identifier, identifier_label: svc.idLabel, customer_name: null, recipient_whatsapp: null,
      amount_ngn: item.price, service_fee_local: fee,
      fx_ngn_per_gbp: Number(process.env.NGN_PER_GBP ?? 1900), service_fee_pence: 0, amount_gbp_pence: 0,
      status: "pending_payment",
      ...(testMode ? { is_test: true } : {}), // only written in test mode, same as the other checkouts
    })
    .select("id")
    .single();
  if (error || !order) {
    console.error("[exams] order insert failed", error?.message);
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }

  try {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL!;
    const back = `${appUrl}/exams/${order.id}?paid=1`;
    if (rail === "flutterwave") {
      const fw = await flwInitialize({ email, name: null, amountNgn: total, orderId: order.id, redirectUrl: back, description: billerName });
      await db.from("orders").update({ flw_pay_ref: fw.txRef }).eq("id", order.id);
      return NextResponse.json({ url: fw.link, orderId: order.id, total });
    }
    const init = await initializeTransaction({ email, amountNgn: total, orderId: order.id, callbackUrl: back });
    await db.from("orders").update({ paystack_reference: init.reference }).eq("id", order.id);
    return NextResponse.json({ url: init.authorizationUrl, orderId: order.id, total });
  } catch (e: any) {
    await db.from("orders").update({ status: "expired", error: `payment link failed: ${String(e?.message ?? e).slice(0, 160)}` }).eq("id", order.id).eq("status", "pending_payment");
    alertFounder("Exam payment link failed", `Order ${order.id}: ${e?.message ?? e}`);
    return NextResponse.json({ error: "We couldn't start the payment. Please try again." }, { status: 502 });
  }
}
