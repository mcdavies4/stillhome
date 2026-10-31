// src/lib/flwpay-process.ts
// Turns a Flutterwave payment into a vend. Called from the webhook AND from the order-status poll,
// so a missed or oddly-signed webhook can never leave a paid customer waiting.
//
// The webhook/redirect is only a nudge. Everything is decided by Flutterwave's own verify call:
//   status "successful", currency NGN, amount == what we asked for, tx_ref == this order's reference.
// Then the order is claimed atomically (pending_payment -> paid) and handed to the shared vend pipeline.

import { supabaseAdmin } from "@/lib/supabase";
import { alertFounder } from "@/lib/alerts";
import { billsTestMode } from "@/lib/bills";
import { fulfilClaimedOrder, type ClaimedOrder } from "@/lib/fulfil-order";
import { sendNgnReceiptEmail } from "@/lib/receipt-ngn";
import { flwPayIsTestMode, flwPayReferenceFor, refundTransaction, verifyById, verifyByReference, FlwPayError, type FlwTx } from "@/lib/flwpay";

export type ConfirmState = "processed" | "unpaid" | "already" | "mismatch" | "skipped";
export interface ConfirmResult { state: ConfirmState; outcome?: string; note?: string }

const notFound = (e: unknown) =>
  e instanceof FlwPayError && (e.http === 404 || /no transaction|not found/i.test(e.message));

export async function confirmFlutterwavePayment(orderId: string, opts: { transactionId?: string | null } = {}): Promise<ConfirmResult> {
  const db = supabaseAdmin();
  const { data: order } = await db.from("orders").select("*").eq("id", orderId).maybeSingle();
  if (!order || order.payment_provider !== "flutterwave") return { state: "skipped", note: "not a Flutterwave order" };
  if (order.status !== "pending_payment") return { state: "already", note: order.status };

  const expectedRef = flwPayReferenceFor(order.id);

  // Ask Flutterwave. "Not found yet" just means the customer hasn't paid; anything else is a real error.
  let tx: FlwTx;
  try {
    const id = opts.transactionId ?? order.flw_pay_id ?? null;
    tx = id ? await verifyById(id) : await verifyByReference(expectedRef);
  } catch (e) {
    if (notFound(e)) return { state: "unpaid", note: "no transaction yet" };
    throw e; // network / 5xx: let the caller retry
  }

  if (tx.txRef !== expectedRef) {
    await alertFounder(
      "⚠️ Flutterwave payment mismatch",
      `Order ${order.id}: transaction ${tx.id} has tx_ref "${tx.txRef}", expected "${expectedRef}". Not processed.`
    );
    return { state: "mismatch", note: "tx_ref mismatch" };
  }
  if (tx.status !== "successful") return { state: "unpaid", note: tx.status || "no status" };

  // Never vend on an underpayment or a wrong-currency charge.
  const expected = Number(order.amount_ngn) + Number(order.service_fee_local ?? 0);
  if (tx.currency !== "NGN" || !Number.isFinite(tx.amount) || Math.abs(tx.amount - expected) > 0.005) {
    await db
      .from("orders")
      .update({
        status: "needs_review",
        flw_pay_id: tx.id,
        error: `PAYMENT MISMATCH: got ${tx.amount} ${tx.currency} (${tx.status}), expected ${expected} NGN`,
      })
      .eq("id", order.id)
      .eq("status", "pending_payment");
    await alertFounder(
      "🚨 Flutterwave amount mismatch — order NOT vended",
      `Order ${order.id}\nPaid: ${tx.amount} ${tx.currency} (${tx.status})\nExpected: ${expected} NGN\nTransaction ${tx.id} — check Flutterwave and refund if needed.`
    );
    return { state: "mismatch", note: "amount mismatch" };
  }

  // A Flutterwave TEST payment is not real money. If the bills provider is LIVE it would spend real float,
  // so refuse unless you've opted in to a supervised end-to-end test (PAYSTACK_TEST_ALLOW_LIVE_VEND=1; remove it afterwards).
  if (flwPayIsTestMode() && !billsTestMode() && process.env.PAYSTACK_TEST_ALLOW_LIVE_VEND !== "1") {
    await db
      .from("orders")
      .update({ status: "needs_review", flw_pay_id: tx.id, error: "TEST payment on a LIVE bills provider — not vended" })
      .eq("id", order.id)
      .eq("status", "pending_payment");
    await alertFounder(
      "Flutterwave TEST payment — not vended",
      `Order ${order.id}: Flutterwave pay-in is in test mode but the bills provider is live, so nothing was vended. ` +
        `For a supervised end-to-end test set PAYSTACK_TEST_ALLOW_LIVE_VEND=1 (it will spend real float), then remove it.`
    );
    return { state: "skipped", note: "test payment, live bills" };
  }

  // Claim atomically: only one caller (webhook or poll) gets to flip pending_payment -> paid.
  const { data: claimed } = await db
    .from("orders")
    .update({ status: "paid", flw_pay_id: tx.id, flw_pay_ref: expectedRef })
    .eq("id", order.id)
    .eq("status", "pending_payment")
    .select("*")
    .maybeSingle();
  if (!claimed) return { state: "already", note: "claimed elsewhere" };

  const result = await fulfilClaimedOrder(claimed as ClaimedOrder, {
    refund: async () => {
      await refundTransaction(tx.id);
    },
    sendReceiptEmail: async (o, token) => { await sendNgnReceiptEmail(o as any, token); },
    paymentLabel: `Flutterwave tx ${tx.id} (${expectedRef})`,
  });
  return { state: "processed", outcome: result.outcome };
}
