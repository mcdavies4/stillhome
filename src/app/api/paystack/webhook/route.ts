import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { alertFounder } from "@/lib/alerts";
import { paystackIsTestMode, paystackReferenceFor, refundTransaction, verifyWebhookSignature } from "@/lib/paystack";
import { fulfilClaimedOrder, type ClaimedOrder } from "@/lib/fulfil-order";
import { sendNgnReceiptEmail } from "@/lib/receipt-ngn";

// Paystack (₦) payment pipeline — the naira twin of /api/stripe/webhook.
//   charge.success
//     -> verify signature, order, reference, amount and currency
//     -> atomically claim pending_payment -> paid
//     -> vend via Flutterwave (shared pipeline), refund through Paystack on confirmed failure
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

  // Never vend on an underpayment or a wrong-currency charge.
  const expectedKobo = Math.round((Number(existing.amount_ngn) + Number(existing.service_fee_local ?? 0)) * 100);
  if (data.status !== "success" || data.currency !== "NGN" || Number(data.amount) !== expectedKobo) {
    await db
      .from("orders")
      .update({
        status: "needs_review",
        paystack_reference: reference,
        error: `PAYMENT MISMATCH: got ${data.amount} ${data.currency} (${data.status}), expected ${expectedKobo} NGN kobo`,
      })
      .eq("id", orderId)
      .eq("status", "pending_payment");
    await alertFounder(
      "🚨 Paystack amount mismatch — order NOT vended",
      `Order ${orderId}\nPaid: ${data.amount} ${data.currency} (${data.status})\nExpected: ${expectedKobo} kobo NGN\nReference ${reference} — check Paystack and refund if needed.`
    );
    return NextResponse.json({ received: true, note: "amount mismatch" });
  }

  // Safety: a Paystack TEST payment is not real money. If Flutterwave is on a LIVE key it would
  // vend a real bill from your real wallet, so refuse unless you've explicitly opted in to a
  // supervised end-to-end test (PAYSTACK_TEST_ALLOW_LIVE_VEND=1 — remove it afterwards).
  const flwIsLive = !(process.env.FLW_SECRET_KEY ?? "").startsWith("FLWSECK_TEST");
  if (paystackIsTestMode() && flwIsLive && process.env.PAYSTACK_TEST_ALLOW_LIVE_VEND !== "1") {
    await alertFounder(
      "Paystack TEST payment — not vended",
      `Order ${orderId}: Paystack is in test mode but Flutterwave is live, so nothing was vended. ` +
        `For a supervised end-to-end test set PAYSTACK_TEST_ALLOW_LIVE_VEND=1 (it will spend real ${existing.currency ?? "NGN"} float), then remove it.`
    );
    return NextResponse.json({ received: true, note: "test payment, live FLW — skipped" });
  }

  // Claim atomically: only proceed if we flip pending_payment -> paid.
  const { data: order } = await db
    .from("orders")
    .update({ status: "paid", paystack_reference: reference })
    .eq("id", orderId)
    .eq("status", "pending_payment")
    .select("*")
    .single();

  if (!order) return NextResponse.json({ received: true, note: "already processed" });

  const result = await fulfilClaimedOrder(order as ClaimedOrder, {
    refund: async () => {
      await refundTransaction(reference);
    },
    sendReceiptEmail: (o, token) => sendNgnReceiptEmail(o as any, token),
    paymentLabel: `Paystack ref ${reference}`,
  });

  return NextResponse.json({ received: true, result: result.outcome });
}
