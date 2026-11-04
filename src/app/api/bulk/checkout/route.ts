import { NextResponse } from "next/server";
import { walletCovers } from "@/lib/capacity";
import { BACK_SOON_MESSAGE } from "@/lib/back-soon";
import { supabaseAdmin } from "@/lib/supabase";
import { rateLimit } from "@/lib/ratelimit";
import { alertFounder } from "@/lib/alerts";
import { normaliseEmail } from "@/lib/security";
import { ngnPayProvider, flwPayConfigured, flwPayIsTestMode, initializePayment as flwInitialize } from "@/lib/flwpay";
import { paybetaConfigured } from "@/lib/paybeta";
import { activeProvider, billsTestMode } from "@/lib/bills";
import { bulkEnabled, bulkTxRef, bulkPbReference } from "@/lib/bulk";
import { checkRows, bulkFee, BULK_FIRST_CAP, type DraftRow } from "@/lib/bulk-shared";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Creates a bulk airtime batch and a Flutterwave payment link for it. Nothing is bought until the payment is
// verified (see lib/bulk.ts). Bulk is off until BULK_ENABLED=1 is set in Vercel.
export async function POST(req: Request) {
  if (!bulkEnabled()) return NextResponse.json({ error: "Bulk airtime isn't open yet." }, { status: 503 });
  if (!(await rateLimit(req, "bulk-checkout", 6, 10)).ok) {
    return NextResponse.json({ error: "Too many attempts. Please wait a few minutes and try again." }, { status: 429 });
  }

  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Bad request" }, { status: 400 }); }

  const email = normaliseEmail(body?.email);
  if (!email) return NextResponse.json({ error: "Enter a valid email address for your receipt." }, { status: 400 });
  if (!Array.isArray(body?.recipients)) return NextResponse.json({ error: "No numbers supplied." }, { status: 400 });

  const checked = checkRows(
    (body.recipients as any[]).slice(0, 2000).map((r): DraftRow => ({ phone: String(r?.phone ?? ""), amount: Number(r?.amount), network: r?.network })) 
  );
  if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 });

  if (ngnPayProvider() !== "flutterwave" || !flwPayConfigured() || activeProvider() !== "paybeta" || !paybetaConfigured()) {
    return NextResponse.json({ error: "Bulk airtime isn't available right now — please check back soon." }, { status: 503 });
  }

  const cover = await walletCovers(checked.total, { context: `bulk airtime, ${checked.rows.length} numbers` });
  if (!cover.ok) return NextResponse.json({ error: BACK_SOON_MESSAGE, busy: true }, { status: 503, headers: { "Retry-After": "120" } });

  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || req.headers.get("x-real-ip") || "unknown";
  const db = supabaseAdmin();
  const total = checked.total;
  const fee = bulkFee(total);

  // New customers start with a smaller first batch (same idea as the single-order first-order cap).
  const [{ count: okOrders }, { count: okBulk }] = await Promise.all([
    db.from("orders").select("id", { count: "exact", head: true }).eq("email", email).eq("status", "fulfilled"),
    db.from("bulk_orders").select("id", { count: "exact", head: true }).eq("email", email).eq("status", "settled"),
  ]);
  if (!(okOrders ?? 0) && !(okBulk ?? 0) && total > BULK_FIRST_CAP) {
    return NextResponse.json({ error: `For a first order the limit is ₦${BULK_FIRST_CAP.toLocaleString("en-NG")}. Send a smaller batch now and the limit lifts after it is delivered.` }, { status: 400 });
  }
  // Don't let one email pile up unpaid batches.
  const hourAgo = new Date(Date.now() - 3600_000).toISOString();
  const { count: open } = await db.from("bulk_orders").select("id", { count: "exact", head: true }).eq("email", email).eq("status", "pending_payment").gte("created_at", hourAgo);
  if ((open ?? 0) >= 3) return NextResponse.json({ error: "You have several unpaid batches open. Finish one of them first." }, { status: 429 });

  const { data: bulk, error } = await db
    .from("bulk_orders")
    .insert({
      email, ip, status: "pending_payment", recipients_count: checked.rows.length, amount_total: total, service_fee: fee,
      payment_provider: "flutterwave", is_test: billsTestMode() || flwPayIsTestMode(),
    })
    .select("id")
    .single();
  if (error || !bulk) {
    console.error("[bulk] create failed", error?.message);
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
  const ref = bulkPbReference(bulk.id);
  const { error: recErr } = await db.from("bulk_recipients").insert(
    checked.rows.map((r, i) => ({ bulk_id: bulk.id, row_no: i + 1, network: r.network, phone: r.phone, amount: r.amount }))
  );
  if (recErr) {
    await db.from("bulk_orders").update({ status: "expired", error: "could not save recipients" }).eq("id", bulk.id);
    console.error("[bulk] recipients failed", recErr.message);
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
  await db.from("bulk_orders").update({ pb_reference: ref }).eq("id", bulk.id);

  try {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL!;
    const fw = await flwInitialize({
      email,
      amountNgn: total + fee,
      orderId: bulk.id,
      txRef: bulkTxRef(bulk.id),
      redirectUrl: `${appUrl}/bulk/${bulk.id}?paid=1`,
      description: `Bulk airtime — ${checked.rows.length} numbers`,
    });
    await db.from("bulk_orders").update({ flw_pay_ref: fw.txRef }).eq("id", bulk.id);
    return NextResponse.json({ url: fw.link, bulkId: bulk.id, total: total + fee });
  } catch (e: any) {
    await db.from("bulk_orders").update({ status: "expired", error: `payment link failed: ${e?.message}`.slice(0, 200) }).eq("id", bulk.id);
    alertFounder("Bulk payment link failed", `Bulk ${bulk.id}: ${e?.message ?? e}`);
    return NextResponse.json({ error: "We couldn't start the payment. Please try again." }, { status: 502 });
  }
}
