import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { alertFounder } from "@/lib/alerts";
import { paybetaConfigured, pbParseWebhook, pbVerifySignature, isPbReference } from "@/lib/paybeta";
import { canAutoRefund, paymentRefLabel, refundOrderPayment } from "@/lib/refund-order";
import { sendNgnReceiptEmail } from "@/lib/receipt-ngn";
import { sendReceipt } from "@/lib/whatsapp";
import { waOnFulfilled, waOnFailedRefunded } from "@/lib/wa/hooks";

// Paybeta webhook — the ONLY way Paybeta tells us the final result of a vend that was pending.
//
// Dashboard setup (Paybeta console -> Settings -> Webhook):
//   https://www.nolgic.com/api/paybeta/webhook      (use the www host: webhooks do not follow redirects)
//
// What it does:
//   1. verify the `Signature` header (HMAC-SHA256 of data.reference, keyed with PAYBETA_API_KEY)
//   2. record the event in paybeta_events (the order pipeline reads it as the vend's status)
//   3. if the order is waiting in needs_review:
//        success -> mark fulfilled, store the token, send the receipt
//        failed  -> refund through the rail the customer paid with (Paystack or Flutterwave), mark failed_refunded
//      Only orders in needs_review move, and only through an atomic status flip, so a repeated
//      webhook can never deliver or refund twice.
// After a valid signature we answer 200, otherwise Paybeta keeps retrying.

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!paybetaConfigured()) return NextResponse.json({ error: "Not configured" }, { status: 503 });

  const raw = await req.text();
  // A test ping (the Paybeta console checks the URL when you press Save) has no transaction in it.
  // Nothing is read, stored or acted on for it, so acknowledge with 200. Anything that does carry a
  // transaction reference must have a valid signature, otherwise 401.
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ received: true, note: "ignored" });
  }
  const ev = pbParseWebhook(payload);
  if (!ev) return NextResponse.json({ received: true, note: "ignored" });
  if (!pbVerifySignature(ev.reference, req.headers.get("signature"))) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }
  // Not one of ours (e.g. a vend made from the Paybeta console): acknowledge and ignore.
  if (!isPbReference(ev.reference)) return NextResponse.json({ received: true, note: "not a Nolgic reference" });

  const db = supabaseAdmin();

  if (!ev.recognised) {
    await alertFounder(
      "Paybeta webhook with an unrecognised status",
      `Reference ${ev.reference}. The payload had no status Nolgic understands, so it was stored as pending. Check this vend in the Paybeta console.\n\n${raw.slice(0, 600)}`
    );
  }

  // Never let a late "pending" overwrite a final answer.
  const { data: prev } = await db.from("paybeta_events").select("state").eq("reference", ev.reference).maybeSingle();
  if (prev && prev.state !== "pending" && ev.state === "pending") {
    return NextResponse.json({ received: true, note: "already final" });
  }
  const { error: saveErr } = await db.from("paybeta_events").upsert(
    { reference: ev.reference, state: ev.state, token: ev.token, raw: payload as any, updated_at: new Date().toISOString() },
    { onConflict: "reference" }
  );
  if (saveErr) {
    console.error("[paybeta-webhook] could not store event", saveErr.message);
    return NextResponse.json({ error: "Could not store event" }, { status: 500 }); // Paybeta will retry
  }
  if (prev && prev.state !== ev.state && prev.state !== "pending") {
    await alertFounder(
      "🚨 Paybeta changed a final result",
      `Reference ${ev.reference}: ${prev.state} -> ${ev.state}. Check the order and the Paybeta console by hand.`
    );
  }
  if (ev.state === "pending") return NextResponse.json({ received: true, state: "pending" });

  // Which order is this?
  const { data: order } = await db.from("orders").select("*").eq("flw_reference", ev.reference).maybeSingle();
  if (!order) return NextResponse.json({ received: true, note: "no matching order" });
  if (order.status !== "needs_review") return NextResponse.json({ received: true, note: `order is ${order.status}` });

  const sym = order.currency === "GHS" ? "₵" : "₦";
  const label = `${order.biller_name} ${sym}${Number(order.amount_ngn).toLocaleString()}`;

  // Only naira orders (Paystack / Flutterwave) are resolved automatically — Stripe orders are left for a human.
  if (!canAutoRefund(order)) {
    await alertFounder(
      `Paybeta says ${ev.state.toUpperCase()} — order needs a manual step`,
      `Order ${order.id} (${label}) is paid by ${order.payment_provider}.\nPaybeta result: ${ev.state}. ${ev.state === "success" ? "Use Mark delivered in /admin." : "Refund the customer in the payment dashboard."}`
    );
    return NextResponse.json({ received: true, note: "manual" });
  }

  if (ev.state === "success") {
    const { data: done } = await db
      .from("orders")
      .update({ status: "fulfilled", flw_token: ev.token ?? order.flw_token ?? null, error: null })
      .eq("id", order.id)
      .eq("status", "needs_review")
      .select("*")
      .maybeSingle();
    if (!done) return NextResponse.json({ received: true, note: "already handled" });
    const token = (done.flw_token as string | null) ?? null;
    try {
      if (done.email) await sendNgnReceiptEmail(done as any, token);
      if (done.recipient_whatsapp && done.source !== "whatsapp") await sendReceipt(done.recipient_whatsapp, { ...done, flw_token: token } as any);
      await waOnFulfilled({ ...done, flw_token: token } as any);
    } catch (e) {
      console.error("[paybeta-webhook] receipt failed", e);
    }
    await alertFounder("Paybeta confirmed a held order — delivered", `Order ${order.id} (${label}) was in review; Paybeta reports success, so it is now fulfilled.`);
    return NextResponse.json({ received: true, state: "success", order: "fulfilled" });
  }

  // failed -> claim first (status flip), then refund
  const { data: claimed } = await db
    .from("orders")
    .update({ status: "failed_refunded", error: "Paybeta reported the vend failed" })
    .eq("id", order.id)
    .eq("status", "needs_review")
    .select("*")
    .maybeSingle();
  if (!claimed) return NextResponse.json({ received: true, note: "already handled" });
  try {
    await refundOrderPayment(order);
    await alertFounder("Paybeta reported failure — customer auto-refunded", `Order ${order.id} (${label}) ${paymentRefLabel(order)}`);
    await waOnFailedRefunded(claimed as any);
    return NextResponse.json({ received: true, state: "failed", order: "failed_refunded" });
  } catch (e: any) {
    await db.from("orders").update({ status: "refund_failed", error: `Paybeta failed | REFUND FAILED: ${e?.message}` }).eq("id", order.id);
    await alertFounder("🚨 REFUND FAILED — manual action needed", `Order ${order.id} (${label})\nPaybeta reported the vend failed but the refund failed: ${e?.message}\n${paymentRefLabel(order)}`);
    return NextResponse.json({ received: true, state: "failed", order: "refund_failed" });
  }
}
