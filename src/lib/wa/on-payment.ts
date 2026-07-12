// src/lib/wa/on-payment.ts
// Called from your EXISTING /api/stripe/webhook handler.
//
// Wire-up inside your current webhook (after signature verification):
//
//   import { onWhatsAppCheckoutCompleted, onWhatsAppCheckoutExpired } from "@/lib/wa/on-payment";
//
//   case "checkout.session.completed": {
//     const session = event.data.object as Stripe.Checkout.Session;
//     if (session.metadata?.source === "whatsapp") {
//       await onWhatsAppCheckoutCompleted(session);
//       break;
//     }
//     // ...existing web flow...
//   }
//   case "checkout.session.expired": {
//     const session = event.data.object as Stripe.Checkout.Session;
//     if (session.metadata?.source === "whatsapp") await onWhatsAppCheckoutExpired(session);
//     // ...existing web flow...
//   }

import Stripe from "stripe";
import { db, resetConversation, setConversation } from "./db";
import { deliverToken, sendText } from "./client";
import { billerByCode } from "./billers";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
const ADMIN_EMAIL = process.env.ADMIN_ALERT_EMAIL ?? "azubuikedavies@gmail.com";

interface VendResult {
  ok: boolean;
  token?: string;
  units?: string;
  flwReference?: string;
  error?: string;
}

/**
 * ⚠️ INTEGRATION: Replace the body of this function with Nolgic's existing
 * Flutterwave Bills vend call. Requirements it must keep:
 *   - reference = the order id (Flutterwave-side idempotency)
 *   - returns token + units on success
 * The implementation below matches FLW /v3/billers/{biller_code}/items/{item_code}/payment
 * style but your existing tested code is the source of truth.
 */
async function vendOrder(order: {
  id: string;
  biller_code: string;
  item_code: string;
  meter_number: string;
  amount_ngn: number;
}): Promise<VendResult> {
  try {
    const res = await fetch(
      `https://api.flutterwave.com/v3/billers/${order.biller_code}/items/${order.item_code}/payment`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.FLW_SECRET_KEY}`,
        },
        body: JSON.stringify({
          country: "NG",
          customer_id: order.meter_number,
          amount: order.amount_ngn,
          reference: order.id, // idempotency key
        }),
      }
    );
    const data = await res.json();
    if (data?.status === "success") {
      return {
        ok: true,
        token: data?.data?.token ?? data?.data?.extra ?? undefined,
        units: data?.data?.units ? String(data.data.units) : undefined,
        flwReference: data?.data?.flw_ref ?? data?.data?.reference,
      };
    }
    return { ok: false, error: data?.message ?? "vend rejected" };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

export async function onWhatsAppCheckoutCompleted(session: Stripe.Checkout.Session): Promise<void> {
  const orderId = session.metadata?.order_id;
  if (!orderId) return;

  // Idempotency guard — Stripe retries webhooks
  const { data: order } = await db.from("orders").select("*").eq("id", orderId).single();
  if (!order || order.status !== "awaiting_payment") return;

  await db.from("orders").update({ status: "paid", paid_at: new Date().toISOString() }).eq("id", orderId);

  const { data: waUser } = await db.from("wa_users").select("id, wa_phone").eq("id", order.wa_user_id).single();
  if (waUser) await setConversation(waUser.id, { state: "vending", expires_at: null });

  // Vend with retries (3x exponential backoff)
  let result: VendResult = { ok: false };
  for (let attempt = 1; attempt <= 3; attempt++) {
    result = await vendOrder(order);
    if (result.ok) break;
    await new Promise((r) => setTimeout(r, attempt * 2000));
  }

  if (result.ok) {
    await db
      .from("orders")
      .update({
        status: "complete",
        token: result.token ?? null,
        units: result.units ?? null,
        flw_reference: result.flwReference ?? null,
        completed_at: new Date().toISOString(),
      })
      .eq("id", orderId);

    if (waUser) {
      const biller = billerByCode(order.biller_code, order.item_code);
      await deliverToken(waUser.wa_phone, {
        billerLabel: biller?.label ?? "Electricity",
        meterNumber: order.meter_number,
        customerName: order.customer_name ?? "",
        token: result.token ?? "(sent by provider — check your meter/SMS)",
        units: result.units,
        reference: shortRef(orderId),
        gbpPaid: Number(order.amount_gbp).toFixed(2),
      });
      await resetConversation(waUser.id);
      await offerToSaveBeneficiary(waUser.id, waUser.wa_phone, order);
      await db.rpc("increment_wa_order_count", { p_user: waUser.id }).then(() => undefined, () => undefined);
    }

    // ⚠️ INTEGRATION: fire your existing Resend email receipt here too.
    return;
  }

  // Vend failed after retries → auto-refund, notify, alert
  await db.from("orders").update({ status: "vend_failed", vend_error: result.error ?? null }).eq("id", orderId);
  if (session.payment_intent) {
    try {
      await stripe.refunds.create({ payment_intent: String(session.payment_intent) });
      await db.from("orders").update({ status: "refunded" }).eq("id", orderId);
    } catch (err) {
      console.error("[on-payment] refund failed — MANUAL ACTION NEEDED", orderId, err);
    }
  }
  if (waUser) {
    await resetConversation(waUser.id);
    await sendText(
      waUser.wa_phone,
      `⚠️ The provider couldn't complete the vend, so we've refunded your £${Number(order.amount_gbp).toFixed(2)} in full — ` +
        `it'll appear on your card in 3–5 working days. Nothing lost. You can try again anytime.`
    );
  }

  // ⚠️ INTEGRATION: send admin alert via your existing Resend setup.
  console.error(`[ALERT ${ADMIN_EMAIL}] vend_failed order=${orderId} error=${result.error}`);
}

export async function onWhatsAppCheckoutExpired(session: Stripe.Checkout.Session): Promise<void> {
  const orderId = session.metadata?.order_id;
  if (!orderId) return;
  const { data: order } = await db.from("orders").select("status, wa_user_id").eq("id", orderId).single();
  if (order?.status === "awaiting_payment") {
    await db.from("orders").update({ status: "expired" }).eq("id", orderId);
    if (order.wa_user_id) await resetConversation(order.wa_user_id);
  }
}

// --- helpers ----------------------------------------------------------------

function shortRef(orderId: string): string {
  return `NLG-${orderId.replace(/-/g, "").slice(0, 6).toUpperCase()}`;
}

async function offerToSaveBeneficiary(
  waUserId: string,
  waPhone: string,
  order: { biller_code: string; item_code: string; meter_number: string; customer_name: string | null }
): Promise<void> {
  // Skip if this meter is already saved
  const { data: existing } = await db
    .from("wa_beneficiaries")
    .select("id")
    .eq("wa_user_id", waUserId)
    .eq("meter_number", order.meter_number)
    .maybeSingle();
  if (existing) return;

  // Lightweight approach: auto-save under a numbered alias and tell the user
  // how to rename. (Full rename flow can come later — keep v1 simple.)
  const { count } = await db
    .from("wa_beneficiaries")
    .select("id", { count: "exact", head: true })
    .eq("wa_user_id", waUserId);
  const alias = order.customer_name
    ? order.customer_name.split(" ")[0].toLowerCase()
    : `meter${(count ?? 0) + 1}`;

  const biller = billerByCode(order.biller_code, order.item_code);
  await db.from("wa_beneficiaries").upsert(
    {
      wa_user_id: waUserId,
      alias,
      biller_code: order.biller_code,
      item_code: order.item_code,
      meter_number: order.meter_number,
      customer_name: order.customer_name,
      meter_type: biller?.meter_type ?? null,
      last_used_at: new Date().toISOString(),
    },
    { onConflict: "wa_user_id,alias" }
  );

  await sendText(
    waPhone,
    `💾 Saved this meter as *${alias}* — next time just say “*${alias} ₦10k*”.`
  );
}
