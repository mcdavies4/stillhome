import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { activateFromWebhook } from "@/lib/recurring";
import { alertFounder } from "@/lib/alerts";
import { paystackReferenceFor, verifyWebhookSignature } from "@/lib/paystack";
import { confirmPaystackPayment } from "@/lib/paystack-process";
import { bulkIdFromPsRef, confirmBulkPayment } from "@/lib/bulk";
import { confirmPayRequest } from "@/lib/payforme";
import { parsePfmRef } from "@/lib/payforme-shared";

// Paystack (₦) payment pipeline — the naira twin of /api/stripe/webhook.
//   charge.success
//     -> verify signature, then re-verify the payment with Paystack's API (reference, amount, currency)
//     -> atomically claim pending_payment -> paid
//     -> vend through the active bills provider (shared pipeline), refund through Paystack on confirmed failure
//   Bulk airtime batches (reference NLGPB-<id>) and Pay for Me payments (NLGP-...) are routed to their own handlers.
//
// Dashboard setup (Nolgic business, NOT Odogwu's):
//   Settings -> API Keys & Webhooks -> Webhook URL = https://www.nolgic.com/api/paystack/webhook
//   (use the www host: webhooks do not follow redirects)
//
// After a valid signature we always answer 200, otherwise Paystack keeps retrying.

export async function POST(req: Request) {
  const raw = await req.text();
  if (!verifyWebhookSignature(raw, req.headers.get("x-paystack-signature"))) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let event: any;
  try {
    event = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Bad JSON" }, { status: 400 });
  }
  if (event?.event !== "charge.success") return NextResponse.json({ received: true });

  const data = event.data ?? {};
  const orderId: string | undefined = data.metadata?.order_id;
  const reference: string = String(data.reference ?? "");

  // "Pay for Me" payments carry their own reference (NLGP-<request id>-<attempt>). One payment, several items.
  const pfm = parsePfmRef(reference);
  if (pfm && pfm.rail === "paystack") {
    try {
      const r = await confirmPayRequest(pfm.requestId, { ref: reference });
      return NextResponse.json({ received: true, payForMe: true, state: r.state });
    } catch (e: any) {
      console.error("[paystack-webhook] pay-for-me verification failed", e?.message ?? e);
      return NextResponse.json({ error: "Verification failed, retry" }, { status: 500 });
    }
  }
  // Bulk airtime: one payment, many numbers (reference NLGPB-<batch id>).
  const bulkId = bulkIdFromPsRef(reference);
  if (bulkId) {
    try {
      const r = await confirmBulkPayment(bulkId);
      return NextResponse.json({ received: true, bulk: true, state: r.state });
    } catch (e: any) {
      console.error("[paystack-webhook] bulk verification failed", e?.message ?? e);
      return NextResponse.json({ error: "Verification failed, retry" }, { status: 500 });
    }
  }
  if (!orderId) return NextResponse.json({ received: true, note: "no order_id (not a Nolgic payment)" });

  const db = supabaseAdmin();
  const { data: existing } = await db.from("orders").select("*").eq("id", orderId).maybeSingle();
  if (!existing) return NextResponse.json({ received: true, note: "unknown order" });

  if (existing.payment_provider !== "paystack" || reference !== paystackReferenceFor(orderId)) {
    await alertFounder(
      "⚠️ Paystack webhook mismatch",
      `Order ${orderId}: provider=${existing.payment_provider}, reference=${reference}. Not processed.`
    );
    return NextResponse.json({ received: true, note: "mismatch" });
  }

  // Monthly repeat: the first payment carries the plan id. Activation is non-fatal and only happens when the card is reusable.
  const repeatPlanId: string | undefined = data.metadata?.recurring_plan_id;
  if (repeatPlanId) await activateFromWebhook(repeatPlanId, data);

  // The webhook is only a nudge: the payment is re-verified with Paystack's own API before anything is vended
  // (amount, currency, reference), and the order page runs the same check if this webhook never arrives.
  try {
    const r = await confirmPaystackPayment(orderId);
    return NextResponse.json({ received: true, state: r.state, result: r.outcome });
  } catch (e: any) {
    console.error("[paystack-webhook] verification failed", e?.message ?? e);
    return NextResponse.json({ error: "Verification failed, retry" }, { status: 500 });
  }
}
