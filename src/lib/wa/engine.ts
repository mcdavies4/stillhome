// src/lib/wa/engine.ts
// Conversation state machine — fully wired to the existing Nolgic modules:
//   validateCustomer (FLW meter validation, returns name + min/max)
//   quoteGbp        (site pricing — identical quotes on web and WhatsApp)
//   stripe          (shared Stripe client)
// Orders are inserted in the exact shape the existing Stripe webhook expects
// (status 'pending_payment', identifier/amount_gbp_pence/etc), so payment →
// vend → refund-on-failure all flow through the already-tested pipeline.

import { stripe } from "@/lib/stripe";
import { validateCustomer, FlwError } from "@/lib/flutterwave";
import { quoteGbp } from "@/lib/fx";
import {
  db, upsertWaUser, getConversation, setConversation, resetConversation,
  getBeneficiaries, type Conversation, type Draft, type WaUser,
} from "./db";
import { sendText, sendButtons } from "./client";
import { extractOrder } from "./extract";
import { getElectricityBillers, billerByKey, billerByCodes, billersForHelp } from "./billers";

const SITE = process.env.NEXT_PUBLIC_APP_URL ?? "https://nolgic.com";
const TTL_MIN = { collecting: 30, confirming: 30, awaiting_payment: 20 } as const;
const DAILY_ORDER_CAP = 10;

const ttl = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString();

// ---------------------------------------------------------------------------
export async function handleInbound(
  waPhone: string,
  profileName: string | undefined,
  text: string,
  buttonId?: string
): Promise<void> {
  const user = await upsertWaUser(waPhone, profileName);
  let convo = await getConversation(user.id);

  if (convo.expires_at && new Date(convo.expires_at) < new Date()) {
    if (convo.state === "awaiting_payment") {
      await expireOrder(convo);
      await sendText(waPhone, "That payment link expired. Say *retry* or start a new order.");
    }
    await resetConversation(user.id);
    convo = await getConversation(user.id);
  }

  if (!user.welcomed) {
    await db.from("wa_users").update({ welcomed: true }).eq("id", user.id);
    await sendText(
      waPhone,
      `👋 Welcome to *Nolgic* — pay Nigerian electricity bills from the UK, right here in WhatsApp.\n\n` +
        `Just tell me what you need, e.g.:\n*IKEDC ₦10,000 meter 04123456789*\n\n` +
        `You pay in £ by card, the token arrives in this chat. Say *help* anytime.`
    );
    if (!text.trim()) return;
  }

  switch (convo.state) {
    case "idle":
    case "collecting":
      return handleCollecting(user, convo, text);
    case "confirming":
      return handleConfirming(user, convo, text, buttonId);
    case "awaiting_payment":
      return handleAwaitingPayment(user, convo, text);
    case "vending":
      return sendText(waPhone, "⏳ Your order is processing — the token will land here in a moment.");
    case "failed":
      await resetConversation(user.id);
      return handleCollecting(user, await getConversation(user.id), text);
  }
}

// ---------------------------------------------------------------------------
async function handleCollecting(user: WaUser, convo: Conversation, text: string): Promise<void> {
  const [billers, beneficiaries] = await Promise.all([
    getElectricityBillers(),
    getBeneficiaries(user.id),
  ]);
  const ex = await extractOrder(text, billers, beneficiaries, convo.draft);

  switch (ex.intent) {
    case "cancel":
      await resetConversation(user.id);
      return sendText(user.wa_phone, "Cancelled. Start again whenever you're ready. 👍");

    case "help":
      return sendText(
        user.wa_phone,
        `*How Nolgic works*\n\n` +
          `1️⃣ Tell me the disco, amount, and meter number\n` +
          `2️⃣ I confirm the meter owner's name and the £ price\n` +
          `3️⃣ You pay by card (secure Stripe link)\n` +
          `4️⃣ Token arrives in this chat ⚡\n\n` +
          `Supported: ${billersForHelp(billers)}\n` +
          `Shortcuts: *again* (repeat last order), *list* (saved meters), *status* (last order).`
      );

    case "list_beneficiaries": {
      if (!beneficiaries.length)
        return sendText(user.wa_phone, "No saved meters yet. After your first order I'll save it for quick repeats.");
      const lines = beneficiaries
        .map((b) => `• *${b.alias}* — ${b.identifier}${b.customer_name ? ` (${b.customer_name})` : ""}`)
        .join("\n");
      return sendText(user.wa_phone, `Saved meters:\n${lines}\n\nSay e.g. *${beneficiaries[0].alias} ₦5k* to buy.`);
    }

    case "check_status": {
      const { data: order } = await db
        .from("orders")
        .select("status, amount_ngn, biller_name")
        .eq("wa_user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!order) return sendText(user.wa_phone, "No orders yet — tell me what you'd like to buy!");
      return sendText(
        user.wa_phone,
        `Last order: ${order.biller_name} ₦${Number(order.amount_ngn).toLocaleString()} — status: *${order.status}*.`
      );
    }

    case "repeat_last": {
      const { data: last } = await db
        .from("orders")
        .select("biller_code, item_code, biller_name, identifier, identifier_label, amount_ngn")
        .eq("wa_user_id", user.id)
        .eq("status", "fulfilled")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!last) return sendText(user.wa_phone, "No previous completed order to repeat. Tell me what you need!");
      const draft: Draft = {
        biller_code: last.biller_code,
        item_code: last.item_code,
        biller_name: last.biller_name,
        identifier: last.identifier,
        identifier_label: last.identifier_label ?? "Meter Number",
        amount_ngn: ex.updates.amount_ngn ?? Number(last.amount_ngn),
      };
      return validateAndQuote(user, draft);
    }

    case "buy_bill":
    case "other": {
      if (ex.intent === "other") {
        return sendText(user.wa_phone, ex.reply_if_other ?? "Tell me the disco, amount, and meter number to get started.");
      }

      const draft: Draft = { ...convo.draft };
      if (ex.resolved_beneficiary_id) {
        const b = beneficiaries.find((x) => x.id === ex.resolved_beneficiary_id);
        if (b) {
          draft.biller_code = b.biller_code;
          draft.item_code = b.item_code;
          draft.biller_name = b.biller_name ?? undefined;
          draft.identifier = b.identifier;
          draft.identifier_label = "Meter Number";
          draft.beneficiary_alias = b.alias;
        }
      }
      if (ex.updates.biller_key) {
        const def = await billerByKey(ex.updates.biller_key);
        if (def) {
          draft.biller_code = def.biller_code;
          draft.item_code = def.item_code;
          draft.biller_name = def.biller_name;
          draft.identifier_label = def.identifier_label;
        }
      }
      if (ex.updates.identifier) draft.identifier = ex.updates.identifier;
      if (ex.updates.amount_ngn) draft.amount_ngn = ex.updates.amount_ngn;
      if (ex.updates.beneficiary_alias) draft.beneficiary_alias = String(ex.updates.beneficiary_alias).toLowerCase();

      const missing: string[] = [];
      if (!draft.biller_code) missing.push("biller");
      if (!draft.identifier) missing.push("meter");
      if (!draft.amount_ngn) missing.push("amount");

      if (missing.length) {
        await setConversation(user.id, { state: "collecting", draft, expires_at: ttl(TTL_MIN.collecting) });
        return sendText(user.wa_phone, await questionFor(missing[0]));
      }
      return validateAndQuote(user, draft);
    }
  }
}

async function questionFor(field: string): Promise<string> {
  switch (field) {
    case "biller": {
      const billers = await getElectricityBillers();
      return `Which disco is this for? (${billersForHelp(billers)})`;
    }
    case "meter": return "What's the meter number? (digits only)";
    case "amount": return "How much in naira? e.g. *₦10,000* or *10k*";
    default: return "Could you give me a bit more detail?";
  }
}

// ---------------------------------------------------------------------------
async function validateAndQuote(user: WaUser, draft: Draft): Promise<void> {
  await sendText(user.wa_phone, "🔍 Checking that meter…");

  let name: string;
  let minimum: number | undefined;
  let maximum: number | undefined;
  try {
    const v = await validateCustomer(draft.item_code!, draft.biller_code!, draft.identifier!);
    name = v.name;
    minimum = v.minimum ?? undefined;
    maximum = v.maximum ?? undefined;
  } catch (e) {
    const msg = e instanceof FlwError ? e.message : "the provider couldn't validate this number";
    await setConversation(user.id, {
      state: "collecting",
      draft: { ...draft, identifier: undefined },
      expires_at: ttl(TTL_MIN.collecting),
    });
    return sendText(
      user.wa_phone,
      `❌ ${msg}. Please double-check the meter number and send it again (digits only).`
    );
  }
  draft.customer_name = name;

  if (minimum && draft.amount_ngn! < minimum) {
    await setConversation(user.id, {
      state: "collecting",
      draft: { ...draft, amount_ngn: undefined },
      expires_at: ttl(TTL_MIN.collecting),
    });
    return sendText(user.wa_phone, `Minimum for ${draft.biller_name} is ₦${minimum.toLocaleString()}. How much would you like?`);
  }
  if (maximum && draft.amount_ngn! > maximum) {
    await setConversation(user.id, {
      state: "collecting",
      draft: { ...draft, amount_ngn: undefined },
      expires_at: ttl(TTL_MIN.collecting),
    });
    return sendText(user.wa_phone, `Maximum for ${draft.biller_name} is ₦${maximum.toLocaleString()}. How much would you like?`);
  }

  // Same pricing as the website — one source of truth.
  const quote = quoteGbp(draft.amount_ngn!);
  draft.total_pence = quote.totalPence;
  draft.service_fee_pence = quote.serviceFeePence;
  draft.ngn_per_gbp = quote.ngnPerGbp;
  draft.quoted_at = new Date().toISOString();

  await setConversation(user.id, { state: "confirming", draft, expires_at: ttl(TTL_MIN.confirming) });

  await sendButtons(
    user.wa_phone,
    `⚡ *${draft.biller_name}*\n` +
      `Meter: ${draft.identifier}\n` +
      `Name: *${draft.customer_name}*\n` +
      `Amount: ₦${draft.amount_ngn!.toLocaleString()} → *£${(quote.totalPence / 100).toFixed(2)}* (all fees included)\n\n` +
      `Is this correct?`,
    [
      { id: "confirm_pay", title: "Pay ✓" },
      { id: "confirm_change", title: "Change" },
      { id: "confirm_cancel", title: "Cancel" },
    ]
  );
}

// ---------------------------------------------------------------------------
async function handleConfirming(user: WaUser, convo: Conversation, text: string, buttonId?: string): Promise<void> {
  const t = (buttonId ?? text).trim().toLowerCase();

  if (["confirm_cancel", "cancel", "no", "2", "stop"].includes(t)) {
    await resetConversation(user.id);
    return sendText(user.wa_phone, "Cancelled — nothing charged. 👍");
  }
  if (["confirm_change", "change", "edit"].includes(t)) {
    await setConversation(user.id, { state: "collecting", expires_at: ttl(TTL_MIN.collecting) });
    return sendText(user.wa_phone, "No problem — what should I change? (disco, meter number, or amount)");
  }
  if (["confirm_pay", "yes", "y", "1", "pay", "ok"].includes(t)) {
    const since = new Date(Date.now() - 24 * 3600_000).toISOString();
    const { count } = await db
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("wa_user_id", user.id)
      .gte("created_at", since);
    if ((count ?? 0) >= DAILY_ORDER_CAP) {
      await resetConversation(user.id);
      return sendText(user.wa_phone, "You've hit the daily order limit. Please try again tomorrow or email support@nolgic.com.");
    }
    return createOrderAndPaymentLink(user, convo);
  }

  await setConversation(user.id, { state: "collecting", expires_at: ttl(TTL_MIN.collecting) });
  return handleCollecting(user, { ...convo, state: "collecting" }, text);
}

async function createOrderAndPaymentLink(user: WaUser, convo: Conversation): Promise<void> {
  const d = convo.draft;

  // Exact shape the existing Stripe webhook claims and fulfils.
  const { data: order, error } = await db
    .from("orders")
    .insert({
      source: "whatsapp",
      wa_user_id: user.id,
      email: null,
      biller_code: d.biller_code,
      item_code: d.item_code,
      biller_name: d.biller_name,
      identifier: d.identifier,
      identifier_label: d.identifier_label ?? "Meter Number",
      customer_name: d.customer_name,
      recipient_whatsapp: user.wa_phone,       // existing receipt path delivers here
      amount_ngn: d.amount_ngn,
      fx_ngn_per_gbp: d.ngn_per_gbp,
      service_fee_pence: d.service_fee_pence,
      amount_gbp_pence: d.total_pence,
      status: "pending_payment",
    })
    .select("id")
    .single();
  if (error || !order) {
    console.error("[wa-engine] order insert failed", error);
    return sendText(user.wa_phone, "Something went wrong on our side — please try again in a minute.");
  }

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "gbp",
          unit_amount: d.total_pence!,
          product_data: {
            name: `${d.biller_name} — ₦${d.amount_ngn!.toLocaleString()}`,
            description: `Meter •••${d.identifier!.slice(-4)} (${d.customer_name})`,
          },
        },
      },
    ],
    metadata: { order_id: order.id, source: "whatsapp" },
    success_url: `${SITE}/wa/paid`,
    cancel_url: `${SITE}/wa/cancelled`,
  });

  await db.from("orders").update({ stripe_session_id: session.id }).eq("id", order.id);
  await setConversation(user.id, {
    state: "awaiting_payment",
    order_id: order.id,
    expires_at: ttl(TTL_MIN.awaiting_payment),
  });

  await sendText(
    user.wa_phone,
    `💳 Pay *£${(d.total_pence! / 100).toFixed(2)}* securely here:\n${session.url}\n\n` +
      `Link valid for 20 minutes. The token arrives in this chat right after payment. ⚡`
  );
}

// ---------------------------------------------------------------------------
async function handleAwaitingPayment(user: WaUser, convo: Conversation, text: string): Promise<void> {
  const t = text.trim().toLowerCase();
  if (["cancel", "stop"].includes(t)) {
    await expireOrder(convo);
    await resetConversation(user.id);
    return sendText(user.wa_phone, "Order cancelled — nothing charged.");
  }
  const { data: order } = await db
    .from("orders")
    .select("stripe_session_id, status")
    .eq("id", convo.order_id!)
    .single();
  if (order?.status === "pending_payment" && order.stripe_session_id) {
    const session = await stripe.checkout.sessions.retrieve(order.stripe_session_id);
    if (session.url && session.status === "open") {
      return sendText(user.wa_phone, `Still waiting on payment — here's your link again:\n${session.url}\n\nSay *cancel* to stop.`);
    }
  }
  await resetConversation(user.id);
  return sendText(user.wa_phone, "That order lapsed. Say *retry* to start it again.");
}

export async function expireOrder(convo: Conversation): Promise<void> {
  if (!convo.order_id) return;
  const { data: order } = await db
    .from("orders")
    .select("stripe_session_id, status")
    .eq("id", convo.order_id)
    .single();
  if (order?.status === "pending_payment") {
    await db.from("orders").update({ status: "expired" }).eq("id", convo.order_id);
    if (order.stripe_session_id) {
      try { await stripe.checkout.sessions.expire(order.stripe_session_id); } catch { /* already expired/paid */ }
    }
  }
}
