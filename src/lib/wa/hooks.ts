// src/lib/wa/hooks.ts
// Thin hooks called from the EXISTING Stripe webhook after it fulfils or
// fails an order. The heavy lifting (atomic claim, vend, token recovery,
// auto-refund, alerts) stays in the webhook's already-tested pipeline —
// these hooks only handle the chat-side of a WhatsApp-originated order:
// send the bot-formatted token message, reset conversation state, and
// save the meter as a beneficiary for one-line repeat orders.

import { db, resetConversation } from "./db";
import { deliverToken, sendText } from "./client";

interface OrderRow {
  id: string;
  source?: string | null;
  wa_user_id?: string | null;
  biller_code: string;
  item_code: string;
  biller_name: string;
  identifier: string;
  customer_name: string | null;
  amount_ngn: number;
  amount_gbp_pence: number;
  flw_token?: string | null;
}

const shortRef = (orderId: string) => `NLG-${orderId.replace(/-/g, "").slice(0, 6).toUpperCase()}`;

/** Call after the webhook marks an order `fulfilled`. No-op for web orders. */
export async function waOnFulfilled(order: OrderRow): Promise<void> {
  if (order.source !== "whatsapp" || !order.wa_user_id) return;

  const { data: waUser } = await db
    .from("wa_users")
    .select("id, wa_phone")
    .eq("id", order.wa_user_id)
    .single();
  if (!waUser) return;

  try {
    await deliverToken(waUser.wa_phone, {
      billerLabel: order.biller_name,
      identifier: order.identifier,
      customerName: order.customer_name ?? "",
      token: order.flw_token ?? "(token sent by the provider — check the meter or SMS)",
      reference: shortRef(order.id),
      gbpPaid: (order.amount_gbp_pence / 100).toFixed(2),
    });
  } catch (err) {
    console.error("[wa-hooks] token delivery failed", order.id, err);
  }

  await resetConversation(waUser.id);
  await saveBeneficiary(waUser.id, waUser.wa_phone, order);
  await db.rpc("increment_wa_order_count", { p_user: waUser.id }).then(() => undefined, () => undefined);
}

/**
 * Call when the vend outcome is ambiguous and the order goes to `needs_review`.
 * The buyer has paid and is waiting — tell them it's being checked so the
 * silence doesn't look like their money vanished. The conversation resets so
 * they aren't locked out of chatting; the order resolves server-side.
 */
export async function waOnNeedsReview(order: OrderRow): Promise<void> {
  if (order.source !== "whatsapp" || !order.wa_user_id) return;
  const { data: waUser } = await db
    .from("wa_users")
    .select("id, wa_phone")
    .eq("id", order.wa_user_id)
    .single();
  if (!waUser) return;
  await resetConversation(waUser.id);
  try {
    await sendText(
      waUser.wa_phone,
      `⏳ Your payment went through, but the provider's response is delayed — ` +
        `we're confirming your token now. You'll get it here shortly, or a full refund ` +
        `if it can't be completed. No action needed.`
    );
  } catch (err) {
    console.error("[wa-hooks] needs-review notice failed", order.id, err);
  }
}

/** Call after the webhook auto-refunds a failed vend (`failed_refunded`). */
export async function waOnFailedRefunded(order: OrderRow): Promise<void> {
  if (order.source !== "whatsapp" || !order.wa_user_id) return;
  const { data: waUser } = await db
    .from("wa_users")
    .select("id, wa_phone")
    .eq("id", order.wa_user_id)
    .single();
  if (!waUser) return;
  await resetConversation(waUser.id);
  try {
    await sendText(
      waUser.wa_phone,
      `⚠️ The provider couldn't complete the vend, so we've refunded your ` +
        `£${(order.amount_gbp_pence / 100).toFixed(2)} in full — it'll appear on your card in 3–5 working days. ` +
        `Nothing lost. You can try again anytime.`
    );
  } catch (err) {
    console.error("[wa-hooks] failure notice failed", order.id, err);
  }
}

async function saveBeneficiary(
  waUserId: string,
  waPhone: string,
  order: Pick<OrderRow, "biller_code" | "item_code" | "biller_name" | "identifier" | "customer_name">
): Promise<void> {
  const { data: existing } = await db
    .from("wa_beneficiaries")
    .select("id")
    .eq("wa_user_id", waUserId)
    .eq("identifier", order.identifier)
    .maybeSingle();
  if (existing) {
    await db.from("wa_beneficiaries").update({ last_used_at: new Date().toISOString() }).eq("id", existing.id);
    return;
  }

  const { count } = await db
    .from("wa_beneficiaries")
    .select("id", { count: "exact", head: true })
    .eq("wa_user_id", waUserId);
  const alias = order.customer_name
    ? order.customer_name.split(" ")[0].toLowerCase()
    : `meter${(count ?? 0) + 1}`;

  const { error } = await db.from("wa_beneficiaries").upsert(
    {
      wa_user_id: waUserId,
      alias,
      biller_code: order.biller_code,
      item_code: order.item_code,
      biller_name: order.biller_name,
      identifier: order.identifier,
      customer_name: order.customer_name,
      last_used_at: new Date().toISOString(),
    },
    { onConflict: "wa_user_id,alias" }
  );
  if (error) return;

  try {
    await sendText(waPhone, `💾 Saved this meter as *${alias}* — next time just say "*${alias} ₦10k*".`);
  } catch { /* non-fatal */ }
}
