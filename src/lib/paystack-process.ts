// src/lib/paystack-process.ts
// Turns a Paystack payment into a vend. Called from the webhook AND from the order-status poll, so a missed
// webhook can never leave a paid customer waiting (same design as flwpay-process.ts for Flutterwave).
//
// The webhook/redirect is only a nudge. Everything is decided by Paystack's own verify call:
//   status "success", currency NGN, amount == what we asked for (in kobo), reference == this order's reference.
// Then the order is claimed atomically (pending_payment -> paid) and handed to the shared vend pipeline.

import { supabaseAdmin } from "@/lib/supabase";
import { alertFounder } from "@/lib/alerts";
import { billsTestMode } from "@/lib/bills";
import { fulfilClaimedOrder, type ClaimedOrder } from "@/lib/fulfil-order";
import { sendNgnReceiptEmail } from "@/lib/receipt-ngn";
import { paystackIsTestMode, paystackNotFound, paystackReferenceFor, refundTransaction, verifyTransaction } from "@/lib/paystack";

export type PsConfirmState = "processed" | "unpaid" | "already" | "mismatch" | "skipped";
export interface PsConfirmResult { state: PsConfirmState; outcome?: string; note?: string }

export async function confirmPaystackPayment(orderId: string): Promise<PsConfirmResult> {
  const db = supabaseAdmin();
  const { data: order } = await db.from("orders").select("*").eq("id", orderId).maybeSingle();
  if (!order || order.payment_provider !== "paystack") return { state: "skipped", note: "not a Paystack order" };
  if (order.status !== "pending_payment") return { state: "already", note: order.status };

  const expectedRef = paystackReferenceFor(order.id);

  // Ask Paystack. "Not found" just means the customer hasn't paid; anything else is a real error.
  let tx: Awaited<ReturnType<typeof verifyTransaction>>;
  try {
    tx = await verifyTransaction(expectedRef);
  } catch (e) {
    if (paystackNotFound(e)) return { state: "unpaid", note: "no transaction yet" };
    throw e; // network / 5xx: let the caller retry
  }

  if (tx.reference && tx.reference !== expectedRef) {
    await alertFounder("⚠️ Paystack payment mismatch", `Order ${order.id}: transaction has reference "${tx.reference}", expected "${expectedRef}". Not processed.`);
    return { state: "mismatch", note: "reference mismatch" };
  }
  if (tx.status !== "success") return { state: "unpaid", note: tx.status || "no status" };

  // Never vend on an underpayment or a wrong-currency charge.
  const expectedKobo = Math.round((Number(order.amount_ngn) + Number(order.service_fee_local ?? 0)) * 100);
  if (tx.currency !== "NGN" || tx.amountKobo !== expectedKobo) {
    await db
      .from("orders")
      .update({
        status: "needs_review",
        paystack_reference: expectedRef,
        error: `PAYMENT MISMATCH: got ${tx.amountKobo} ${tx.currency} (${tx.status}), expected ${expectedKobo} NGN kobo`,
      })
      .eq("id", order.id)
      .eq("status", "pending_payment");
    await alertFounder(
      "🚨 Paystack amount mismatch — order NOT vended",
      `Order ${order.id}\nPaid: ${tx.amountKobo} ${tx.currency} (${tx.status})\nExpected: ${expectedKobo} kobo NGN\nReference ${expectedRef} — check Paystack and refund if needed.`
    );
    return { state: "mismatch", note: "amount mismatch" };
  }

  // A Paystack TEST payment is not real money. If the bills provider is LIVE it would vend a real bill from your
  // real wallet, so refuse unless you've opted in to a supervised end-to-end test (PAYSTACK_TEST_ALLOW_LIVE_VEND=1).
  if (paystackIsTestMode() && !billsTestMode() && process.env.PAYSTACK_TEST_ALLOW_LIVE_VEND !== "1") {
    await alertFounder(
      "Paystack TEST payment — not vended",
      `Order ${order.id}: Paystack is in test mode but the bills provider is live, so nothing was vended. ` +
        `For a supervised end-to-end test set PAYSTACK_TEST_ALLOW_LIVE_VEND=1 (it will spend real ${order.currency ?? "NGN"} float), then remove it.`
    );
    return { state: "skipped", note: "test payment, live bills" };
  }

  // Claim atomically: only one caller (webhook or poll) gets to flip pending_payment -> paid.
  const { data: claimed } = await db
    .from("orders")
    .update({ status: "paid", paystack_reference: expectedRef })
    .eq("id", order.id)
    .eq("status", "pending_payment")
    .select("*")
    .maybeSingle();
  if (!claimed) return { state: "already", note: "claimed elsewhere" };

  const result = await fulfilClaimedOrder(claimed as ClaimedOrder, {
    refund: async () => {
      await refundTransaction(expectedRef);
    },
    sendReceiptEmail: async (o, token) => { await sendNgnReceiptEmail(o as any, token); },
    paymentLabel: `Paystack ref ${expectedRef}`,
  });
  return { state: "processed", outcome: result.outcome };
}
