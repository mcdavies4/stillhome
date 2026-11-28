import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { alertFounder } from "@/lib/alerts";
import { smeplugConfigured, smeStatus, isSmeReference } from "@/lib/smeplug";
import { canAutoRefund, paymentRefLabel, refundOrderPayment } from "@/lib/refund-order";
import { sendNgnReceiptEmail } from "@/lib/receipt-ngn";
import { sendReceipt } from "@/lib/whatsapp";
import { sendOrderRefundEmail, sendOrderRefundDelayedEmail } from "@/lib/order-status-mail";

// SMEPlug transaction webhook. SMEPlug's docs describe no signature header, so the payload is
// NOT trusted for the outcome. We take only the customer_reference from it, then requery
// GET /api/v1/transactions/{reference} with our own API key and act on that answer.
//
// Dashboard setup (SMEPlug -> Settings -> Webhook):
//   https://www.nolgic.com/api/smeplug/webhook      (www host: webhooks do not follow redirects)
//
// Effect (only for orders waiting in needs_review, through an atomic status flip):
//   success -> mark fulfilled, send the receipt
//   failed  -> refund through the rail the customer paid with, mark failed_refunded
// Pending or unknown answers change nothing. A repeated webhook can never deliver or refund twice.

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!smeplugConfigured()) return NextResponse.json({ error: "Not configured" }, { status: 503 });

  const raw = await req.text();
  let payload: any;
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ received: true, note: "ignored" });
  }

  const ref = String(payload?.transaction?.customer_reference ?? "").trim();
  // Not a Nolgic airtime reference (e.g. a data purchase made from the SMEPlug dashboard): acknowledge only.
  if (!ref || !isSmeReference(ref)) return NextResponse.json({ received: true, note: "not a Nolgic reference" });

  // Authoritative answer comes from our own requery, never from the webhook body.
  let answer;
  try {
    answer = await smeStatus(ref);
  } catch (e: any) {
    console.error("[smeplug-webhook] requery failed", e?.message);
    return NextResponse.json({ error: "Requery failed" }, { status: 500 }); // SMEPlug will retry
  }
  if (answer.state === "pending") return NextResponse.json({ received: true, state: "pending" });

  const db = supabaseAdmin();
  const { data: order } = await db.from("orders").select("*").eq("flw_reference", ref).maybeSingle();
  if (!order) return NextResponse.json({ received: true, note: "no matching order" });
  if (order.status !== "needs_review") return NextResponse.json({ received: true, note: `order is ${order.status}` });

  const sym = order.currency === "GHS" ? "₵" : "₦";
  const label = `${order.biller_name} ${sym}${Number(order.amount_ngn).toLocaleString()}`;

  if (!canAutoRefund(order)) {
    await alertFounder(
      `SMEPlug says ${answer.state.toUpperCase()} — order needs a manual step`,
      `Order ${order.id} (${label}) is paid by ${order.payment_provider}.\nSMEPlug result: ${answer.state} (${answer.detail}). ${answer.state === "success" ? "Use Mark delivered in /admin." : "Refund the customer in the payment dashboard."}`
    );
    return NextResponse.json({ received: true, note: "manual" });
  }

  if (answer.state === "success") {
    const { data: done } = await db
      .from("orders")
      .update({ status: "fulfilled", error: null })
      .eq("id", order.id)
      .eq("status", "needs_review")
      .select("*")
      .maybeSingle();
    if (!done) return NextResponse.json({ received: true, note: "already handled" });
    try {
      if (done.email) await sendNgnReceiptEmail(done as any, null);
      if (done.recipient_whatsapp && done.source !== "whatsapp") await sendReceipt(done.recipient_whatsapp, done as any);
    } catch (e) {
      console.error("[smeplug-webhook] receipt failed", e);
    }
    await alertFounder("SMEPlug confirmed a held order — delivered", `Order ${order.id} (${label}) was in review; SMEPlug reports success, so it is now fulfilled.`);
    return NextResponse.json({ received: true, state: "success", order: "fulfilled" });
  }

  // failed -> claim first (status flip), then refund
  const { data: claimed } = await db
    .from("orders")
    .update({ status: "failed_refunded", error: `SMEPlug reported the vend failed (${answer.detail})` })
    .eq("id", order.id)
    .eq("status", "needs_review")
    .select("*")
    .maybeSingle();
  if (!claimed) return NextResponse.json({ received: true, note: "already handled" });
  try {
    await refundOrderPayment(order);
    await alertFounder("SMEPlug reported failure — customer auto-refunded", `Order ${order.id} (${label}) ${paymentRefLabel(order)}`);
    await sendOrderRefundEmail(order as any);
    return NextResponse.json({ received: true, state: "failed", order: "failed_refunded" });
  } catch (e: any) {
    await db.from("orders").update({ status: "refund_failed", error: `SMEPlug failed | REFUND FAILED: ${e?.message}` }).eq("id", order.id);
    await alertFounder("🚨 REFUND FAILED — manual action needed", `Order ${order.id} (${label})\nSMEPlug reported the vend failed but the refund failed: ${e?.message}\n${paymentRefLabel(order)}`);
    await sendOrderRefundDelayedEmail(order as any);
    return NextResponse.json({ received: true, state: "failed", order: "refund_failed" });
  }
}
