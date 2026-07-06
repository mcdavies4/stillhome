import { NextResponse } from "next/server";
import Stripe from "stripe";
import { stripe } from "@/lib/stripe";
import { supabaseAdmin } from "@/lib/supabase";
import { createBillPayment, getBillStatus, getNgnBalance, FlwError } from "@/lib/flutterwave";
import { alertFounder } from "@/lib/alerts";
import { sendReceipt } from "@/lib/whatsapp";
import { sendReceiptEmail } from "@/lib/email";

// The heart of the product:
//   checkout.session.completed
//     -> mark paid
//     -> vend via Flutterwave Bills (idempotent reference = order id)
//     -> success: store token, email payer, WhatsApp recipient, status=fulfilled
//     -> failure: auto-refund the Stripe payment, status=failed_refunded

export async function POST(req: Request) {
  const sig = req.headers.get("stripe-signature");
  const raw = await req.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(raw, sig!, process.env.STRIPE_WEBHOOK_SECRET!);
  } catch (e: any) {
    return NextResponse.json({ error: `Invalid signature: ${e.message}` }, { status: 400 });
  }

  if (event.type !== "checkout.session.completed") {
    return NextResponse.json({ received: true });
  }

  const session = event.data.object as Stripe.Checkout.Session;
  const orderId = session.metadata?.order_id;
  if (!orderId) return NextResponse.json({ error: "No order_id" }, { status: 400 });

  const db = supabaseAdmin();

  // Claim the order atomically: only proceed if we flip pending_payment -> paid.
  // A webhook retry after this point finds status != pending_payment and exits,
  // so we can never vend twice.
  const { data: order } = await db
    .from("orders")
    .update({
      status: "paid",
      stripe_payment_intent: String(session.payment_intent ?? ""),
    })
    .eq("id", orderId)
    .eq("status", "pending_payment")
    .select("*")
    .single();

  if (!order) return NextResponse.json({ received: true, note: "already processed" });

  const reference = `STILLHOME-${order.id}`;

  try {
    // Fail fast if the NGN float can't cover this vend — live mode only.
    const isTestMode = (process.env.FLW_SECRET_KEY ?? "").startsWith("FLWSECK_TEST");
    const balance = isTestMode
      ? Number.MAX_SAFE_INTEGER
      : await getNgnBalance().catch(() => Number.MAX_SAFE_INTEGER);

    if (balance < Number(order.amount_ngn)) {
      throw new FlwError(
        `Insufficient wallet balance (₦${balance.toLocaleString()}) for ₦${Number(order.amount_ngn).toLocaleString()} vend`
      );
    }
    const lowWater = Number(process.env.LOW_BALANCE_NGN ?? "100000");
    if (balance !== Number.MAX_SAFE_INTEGER && balance - Number(order.amount_ngn) < lowWater) {
      alertFounder(
        "Wallet running low",
        `NGN wallet will be ~₦${(balance - Number(order.amount_ngn)).toLocaleString()} after order ${order.id}. Top up.`
      );
    }

    await db.from("orders").update({ flw_reference: reference }).eq("id", order.id);

    const result = await createBillPayment({
      identifier: order.identifier,
      amountNgn: Number(order.amount_ngn),
      billerName: order.biller_name,
      itemCode: order.item_code,
      billerCode: order.biller_code,
      reference,
    });

    // Prepaid electricity: token may arrive in `extra` or via requery
    let token: string | null = (result as any)?.extra ?? null;
    if (!token) {
      try {
        const status = await getBillStatus(reference);
        token = (status.data as any)?.extra ?? (status.data as any)?.token ?? null;
      } catch {
        /* lazy recovery via /api/orders + daily cron will pick it up */
      }
    }

    await db
      .from("orders")
      .update({ status: "fulfilled", flw_token: token })
      .eq("id", order.id);

    await sendReceiptEmail({ ...order, flw_token: token });
    if (order.recipient_whatsapp) {
      await sendReceipt(order.recipient_whatsapp, { ...order, flw_token: token });
    }

    return NextResponse.json({ fulfilled: true });
  } catch (e) {
    const errMsg = e instanceof FlwError ? e.message : String(e);
    console.error(`[fulfil] order ${order.id} failed:`, errMsg);

    // Vend failed -> give the customer their money back automatically.
    try {
      await stripe.refunds.create({
        payment_intent: String(session.payment_intent),
        reason: "requested_by_customer",
      });
      await db
        .from("orders")
        .update({ status: "failed_refunded", error: errMsg })
        .eq("id", order.id);
      alertFounder(
        "Vend failed — customer auto-refunded",
        `Order ${order.id} (${order.biller_name} ₦${Number(order.amount_ngn).toLocaleString()})\nError: ${errMsg}`
      );
    } catch (refundErr: any) {
      await db
        .from("orders")
        .update({ status: "refund_failed", error: `${errMsg} | REFUND FAILED: ${refundErr.message}` })
        .eq("id", order.id);
      await alertFounder(
        "🚨 REFUND FAILED — manual action needed",
        `Order ${order.id}\nVend error: ${errMsg}\nRefund error: ${refundErr.message}\nPayment intent: ${session.payment_intent}`
      );
    }

    return NextResponse.json({ fulfilled: false, refunded: true });
  }
}
