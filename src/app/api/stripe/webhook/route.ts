import { NextResponse } from "next/server";
import Stripe from "stripe";
import { stripe } from "@/lib/stripe";
import { supabaseAdmin } from "@/lib/supabase";
import { createBillPayment, getBillStatus, getBalance, FlwError } from "@/lib/flutterwave";
import { getCountry } from "@/lib/countries";
import { alertFounder } from "@/lib/alerts";
import { sendReceipt } from "@/lib/whatsapp";
import { sendReceiptEmail } from "@/lib/email";
import { waOnFulfilled, waOnFailedRefunded, waOnNeedsReview } from "@/lib/wa/hooks";

// The heart of the product:
//   checkout.session.completed
//     -> mark paid
//     -> vend via Flutterwave Bills (idempotent reference = order id)
//     -> success: store token, email payer, WhatsApp recipient, status=fulfilled
//     -> failure: auto-refund the Stripe payment, status=failed_refunded
//
// Multi-country: each order carries country + currency; the vend and the
// wallet-balance guard use the order's own currency (NGN, GHS, ...), so a
// Ghana order vends from the cedi float and a Nigeria order from the naira float.

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

  // Country/currency for this order (defaults to NG/NGN for legacy rows).
  const countryCode: string = order.country ?? "NG";
  const country = getCountry(countryCode);
  const currency: string = order.currency ?? country.currency; // "NGN" | "GHS"
  const sym = country.currencySymbol;
  const amountLocal = Number(order.amount_ngn); // legacy column now holds local-currency amount

  const reference = `NOLGIC-${order.id}`;
  let vendAttempted = false;

  try {
    // Fail fast if the float for THIS currency can't cover the vend — live only.
    const isTestMode = (process.env.FLW_SECRET_KEY ?? "").startsWith("FLWSECK_TEST");
    const balance = isTestMode
      ? Number.MAX_SAFE_INTEGER
      : await getBalance(currency).catch(() => Number.MAX_SAFE_INTEGER);

    if (balance < amountLocal) {
      throw new FlwError(
        `Insufficient ${currency} wallet balance (${sym}${balance.toLocaleString()}) for ${sym}${amountLocal.toLocaleString()} vend`
      );
    }
    // Low-water alert: per-currency threshold, e.g. LOW_BALANCE_NGN / LOW_BALANCE_GHS
    const lowWater = Number(process.env[`LOW_BALANCE_${currency}`] ?? (currency === "NGN" ? "100000" : "500"));
    if (balance !== Number.MAX_SAFE_INTEGER && balance - amountLocal < lowWater) {
      alertFounder(
        `${currency} wallet running low`,
        `${currency} wallet will be ~${sym}${(balance - amountLocal).toLocaleString()} after order ${order.id}. Top up.`
      );
    }

    await db.from("orders").update({ flw_reference: reference }).eq("id", order.id);

    vendAttempted = true;
    const result = await createBillPayment({
      country: countryCode,
      identifier: order.identifier,
      amountLocal,
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

    if (order.email) {
      await sendReceiptEmail({ ...order, flw_token: token });
    }
    if (order.recipient_whatsapp && order.source !== "whatsapp") {
      await sendReceipt(order.recipient_whatsapp, { ...order, flw_token: token });
    }
    await waOnFulfilled({ ...order, flw_token: token });

    return NextResponse.json({ fulfilled: true });
  } catch (e) {
    const errMsg = e instanceof FlwError ? e.message : String(e);
    console.error(`[fulfil] order ${order.id} failed:`, errMsg);

    if (vendAttempted) {
      const outcome = await requeryOutcome(reference);
      if (outcome === "success") {
        let token: string | null = null;
        try {
          const status = await getBillStatus(reference);
          token = (status.data as any)?.extra ?? (status.data as any)?.token ?? null;
        } catch {}
        await db.from("orders").update({ status: "fulfilled", flw_token: token, error: null }).eq("id", order.id);
        if (order.email) {
          await sendReceiptEmail({ ...order, flw_token: token });
        }
        if (order.recipient_whatsapp && order.source !== "whatsapp") {
          await sendReceipt(order.recipient_whatsapp, { ...order, flw_token: token });
        }
        await waOnFulfilled({ ...order, flw_token: token });
        return NextResponse.json({ fulfilled: true, note: "recovered after error" });
      }
      if (outcome === "ambiguous") {
        await db.from("orders").update({ status: "needs_review", error: `AMBIGUOUS: ${errMsg}` }).eq("id", order.id);
        await alertFounder(
          "🔍 Order needs review — do NOT ignore",
          `Order ${order.id} (${order.biller_name} ${sym}${amountLocal.toLocaleString()} ${currency})\nVend outcome unknown after error: ${errMsg}\nCheck FLW dashboard for reference ${reference}: refund in Stripe if NOT delivered.`
        );
        await waOnNeedsReview(order);
        return NextResponse.json({ fulfilled: false, review: true });
      }
      // outcome === "failed": confirmed no delivery — safe to refund below.
    }

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
        `Order ${order.id} (${order.biller_name} ${sym}${amountLocal.toLocaleString()} ${currency})\nError: ${errMsg}`
      );
      await waOnFailedRefunded(order);
    } catch (refundErr: any) {
      await db
        .from("orders")
        .update({ status: "refund_failed", error: `${errMsg} | REFUND FAILED: ${refundErr.message}` })
        .eq("id", order.id);
      await alertFounder(
        "🚨 REFUND FAILED — manual action needed",
        `Order ${order.id}\nVend error: ${errMsg}\nRefund error: ${refundErr.message}\nPayment intent: ${session.payment_intent}`
      );
      await waOnNeedsReview(order);
    }

    return NextResponse.json({ fulfilled: false, refunded: true });
  }
}

async function requeryOutcome(reference: string): Promise<"success" | "failed" | "ambiguous"> {
  try {
    const status = await getBillStatus(reference);
    const s = String((status.data as any)?.status ?? "").toLowerCase();
    if (s.includes("success")) return "success";
    if (s.includes("fail")) return "failed";
    return "ambiguous";
  } catch (e) {
    const msg = e instanceof FlwError ? e.message.toLowerCase() : "";
    if (msg.includes("not found") || msg.includes("no transaction") || msg.includes("404")) {
      return "failed";
    }
    return "ambiguous";
  }
}
