// src/lib/refund-order.ts
// One place that knows how to give a customer their money back, whichever rail they paid with.
// Used by webhooks that settle an order later (e.g. the Paybeta webhook).

import { refundTransaction as paystackRefund } from "@/lib/paystack";
import { refundTransaction as flwRefund, payProviderLabel } from "@/lib/flwpay";

type PaidOrder = { payment_provider?: string | null; paystack_reference?: string | null; flw_pay_id?: string | null };

/** True when we can refund this order automatically (Stripe orders are refunded by hand). */
export function canAutoRefund(o: PaidOrder): boolean {
  if (o.payment_provider === "paystack") return !!o.paystack_reference;
  if (o.payment_provider === "flutterwave") return !!o.flw_pay_id;
  return false;
}

/** Human-readable payment reference for alerts. */
export function paymentRefLabel(o: PaidOrder): string {
  if (o.payment_provider === "flutterwave") return `Flutterwave tx ${o.flw_pay_id ?? "?"}`;
  if (o.payment_provider === "paystack") return `Paystack ref ${o.paystack_reference ?? "?"}`;
  return payProviderLabel(o.payment_provider);
}

/** Full refund through the rail the customer paid with. Throws if it fails. */
export async function refundOrderPayment(o: PaidOrder): Promise<void> {
  if (o.payment_provider === "paystack" && o.paystack_reference) {
    await paystackRefund(o.paystack_reference);
    return;
  }
  if (o.payment_provider === "flutterwave" && o.flw_pay_id) {
    await flwRefund(o.flw_pay_id);
    return;
  }
  throw new Error("No automatic refund route for this order");
}
