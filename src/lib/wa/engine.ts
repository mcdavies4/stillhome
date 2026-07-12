// src/lib/wa/engine.ts
// Conversation state machine. Entry point: handleInbound().
//
// INTEGRATION POINTS (marked ⚠️): quoting and Flutterwave calls should reuse
// Nolgic's existing pricing + Bills API code where noted.

import Stripe from "stripe";
import {
  db, upsertWaUser, getConversation, setConversation, resetConversation,
  getBeneficiaries, type Conversation, type Draft, type WaUser, type Beneficiary,
} from "./db";
import { sendText, sendButtons } from "./client";
import { extractOrder, type Extraction } from "./extract";
import { BILLERS, billerByKey, billersForHelp } from "./billers";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://nolgic.com";

const TTL_MIN = { collecting: 30, confirming: 30, awaiting_payment: 20 } as const;
const DAILY_ORDER_CAP = 10;

function ttl(minutes: number): string {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

// ---------------------------------------------------------------------------
// Entry point — called from the webhook route for each deduped text/button msg
// ---------------------------------------------------------------------------
export async function handleInbound(
  waPhone: string,
  profileName: string | undefined,
  text: string,
  buttonId?: string // set when the message is an interactive button reply
): Promise<void> {
  const user = await upsertWaUser(waPhone, profileName);
  let convo = await getConversation(user.id);

  // Lazy TTL enforcement
  if (convo.expires_at && new Date(convo.expires_at) < new Date()) {
    if (convo.state === "awaiting_payment") {
      await expireOrder(convo);
      await sendText(waPhone, "That payment link expired. Say *retry* or start a new order.");
    }
    await resetConversation(user.id);
    convo = await getConversation(user.id);
  }

  // First contact welcome
  if (!user.welcomed) {
    await db.from("wa_users").update({ welcomed: true }).eq("id", user.id);
    await sendText(
      waPhone,
      `👋 Welcome to *Nolgic* — pay Nigerian electricity bills from the UK, right here in WhatsApp.\n\n` +
        `Just tell me what you need, e.g.:\n` +
        `*IKEDC ₦10,000 meter 04123456789*\n\n` +
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
// idle / collecting
// ---------------------------------------------------------------------------
async function handleCollecting(user: WaUser, convo: Conversation, text: string): Promise<void> {
  const beneficiaries = await getBeneficiaries(user.id);
  const ex = await extractOrder(text, beneficiaries, convo.draft);

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
          `Supported: ${billersForHelp()}\n` +
          `Shortcuts: *again* (repeat last order), *list* (saved meters), *status* (last order).`
      );

    case "list_beneficiaries": {
      if (!beneficiaries.length)
        return sendText(user.wa_phone, "No saved meters yet. After your first order I'll offer to save it.");
      const lines = beneficiaries
        .map((b) => `• *${b.alias}* — ${b.meter_number}${b.customer_name ? ` (${b.customer_name})` : ""}`)
        .join("\n");
      return sendText(user.wa_phone, `Saved meters:\n${lines}\n\nSay e.g. *${beneficiaries[0].alias} ₦5k* to buy.`);
    }

    case "check_status": {
      const { data: order } = await db
        .from("orders")
        .select("status, created_at, amount_ngn")
        .eq("wa_user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!order) return sendText(user.wa_phone, "No orders yet — tell me what you'd like to buy!");
      return sendText(user.wa_phone, `Last order: ₦${Number(order.amount_ngn).toLocaleString()} — status: *${order.status}*.`);
    }

    case "repeat_last": {
      const { data: last } = await db
        .from("orders")
        .select("biller_code, item_code, meter_number, amount_ngn")
        .eq("wa_user_id", user.id)
        .eq("status", "complete")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!last) return sendText(user.wa_phone, "No previous completed order to repeat. Tell me what you need!");
      const biller = BILLERS.find((b) => b.biller_code === last.biller_code && b.item_code === last.item_code);
      const draft: Draft = {
        biller_code: last.biller_code,
        item_code: last.item_code,
        biller_label: biller?.label ?? "Electricity",
        meter_type: biller?.meter_type ?? "prepaid",
        meter_number: last.meter_number,
        amount_ngn: (ex.updates.amount_ngn as number) ?? Number(last.amount_ngn),
      };
      return validateAndQuote(user, draft);
    }

    case "buy_bill":
    case "other": {
      if (ex.intent === "other") {
        return sendText(user.wa_phone, ex.reply_if_other ?? "Tell me the disco, amount, and meter number to get started.");
      }

      // Merge extraction into draft
      const draft: Draft = { ...convo.draft };
      if (ex.resolved_beneficiary_id) {
        const b = beneficiaries.find((x) => x.id === ex.resolved_beneficiary_id);
        if (b) {
          draft.biller_code = b.biller_code;
          draft.item_code = b.item_code;
          draft.meter_number = b.meter_number;
          const def = BILLERS.find((d) => d.biller_code === b.biller_code && d.item_code === b.item_code);
          draft.biller_label = def?.label ?? "Electricity";
          draft.meter_type = (b.meter_type as Draft["meter_type"]) ?? def?.meter_type;
          draft.beneficiary_alias = b.alias;
        }
      }
      if (ex.updates.biller_key) {
        const def = billerByKey(ex.updates.biller_key)!;
        draft.biller_code = def.biller_code;
        draft.item_code = def.item_code;
        draft.biller_label = def.label;
        draft.meter_type = def.meter_type;
      }
      if (ex.updates.meter_number) draft.meter_number = ex.updates.meter_number;
      if (ex.updates.amount_ngn) draft.amount_ngn = ex.updates.amount_ngn;
      if (ex.updates.beneficiary_alias) draft.beneficiary_alias = String(ex.updates.beneficiary_alias).toLowerCase();
      if (ex.updates.save_beneficiary) draft.save_beneficiary = true;

      // What's still missing?
      const missing: string[] = [];
      if (!draft.biller_code) missing.push("biller");
      if (!draft.meter_number) missing.push("meter");
      if (!draft.amount_ngn) missing.push("amount");

      if (missing.length) {
        await setConversation(user.id, { state: "collecting", draft, expires_at: ttl(TTL_MIN.collecting) });
        return sendText(user.wa_phone, questionFor(missing[0]));
      }

      // Minimum amount check
      const def = BILLERS.find((b) => b.biller_code === draft.biller_code && b.item_code === draft.item_code);
      if (def && draft.amount_ngn! < def.min_ngn) {
        await setConversation(user.id, { state: "collecting", draft: { ...draft, amount_ngn: undefined }, expires_at: ttl(TTL_MIN.collecting) });
        return sendText(user.wa_phone, `Minimum for ${def.label} is ₦${def.min_ngn.toLocaleString()}. How much would you like?`);
      }

      return validateAndQuote(user, draft);
    }
  }
}

function questionFor(field: string): string {
  switch (field) {
    case "biller": return `Which disco is this for? (${billersForHelp()})`;
    case "meter": return "What's the meter number? (digits only)";
    case "amount": return "How much in naira? e.g. *₦10,000* or *10k*";
    default: return "Could you give me a bit more detail?";
  }
}

// ---------------------------------------------------------------------------
// validate meter → quote GBP → confirming
// ---------------------------------------------------------------------------
async function validateAndQuote(user: WaUser, draft: Draft): Promise<void> {
  await sendText(user.wa_phone, "🔍 Checking that meter…");

  const validation = await flwValidateMeter(draft.item_code!, draft.biller_code!, draft.meter_number!);
  if (!validation.ok) {
    await setConversation(user.id, {
      state: "collecting",
      draft: { ...draft, meter_number: undefined },
      expires_at: ttl(TTL_MIN.collecting),
    });
    return sendText(
      user.wa_phone,
      `❌ That meter number didn't validate with ${draft.biller_label ?? "the provider"}. ` +
        `Please double-check and send it again (digits only).`
    );
  }
  draft.customer_name = validation.customerName;

  // ⚠️ INTEGRATION: replace with Nolgic's existing pricing function.
  const quote = await getGbpQuote(draft.amount_ngn!);
  draft.quoted_gbp = quote.gbp;
  draft.fx_rate = quote.fxRate;
  draft.quoted_at = new Date().toISOString();

  await setConversation(user.id, { state: "confirming", draft, expires_at: ttl(TTL_MIN.confirming) });

  await sendButtons(
    user.wa_phone,
    `⚡ *${draft.biller_label}*\n` +
      `Meter: ${draft.meter_number}\n` +
      `Name: *${draft.customer_name}*\n` +
      `Amount: ₦${draft.amount_ngn!.toLocaleString()} → *£${draft.quoted_gbp.toFixed(2)}* (all fees included)\n\n` +
      `Is this correct?`,
    [
      { id: "confirm_pay", title: "Pay ✓" },
      { id: "confirm_change", title: "Change" },
      { id: "confirm_cancel", title: "Cancel" },
    ]
  );
}

// ---------------------------------------------------------------------------
// confirming
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
    // Daily cap — basic abuse control
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

  // Anything else while confirming → treat as an edit attempt
  await setConversation(user.id, { state: "collecting", expires_at: ttl(TTL_MIN.collecting) });
  return handleCollecting(user, { ...convo, state: "collecting" }, text);
}

async function createOrderAndPaymentLink(user: WaUser, convo: Conversation): Promise<void> {
  const d = convo.draft;

  // ⚠️ INTEGRATION: align these columns with Nolgic's existing `orders` schema.
  const { data: order, error } = await db
    .from("orders")
    .insert({
      source: "whatsapp",
      wa_user_id: user.id,
      status: "awaiting_payment",
      biller_code: d.biller_code,
      item_code: d.item_code,
      meter_number: d.meter_number,
      customer_name: d.customer_name,
      amount_ngn: d.amount_ngn,
      amount_gbp: d.quoted_gbp,
      fx_rate: d.fx_rate,
    })
    .select("id")
    .single();
  if (error || !order) {
    console.error("[engine] order insert failed", error);
    return sendText(user.wa_phone, "Something went wrong on our side — please try again in a minute.");
  }

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    expires_at: Math.floor(Date.now() / 1000) + 30 * 60, // Stripe minimum 30 min
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "gbp",
          unit_amount: Math.round(d.quoted_gbp! * 100),
          product_data: {
            name: `${d.biller_label} — ₦${d.amount_ngn!.toLocaleString()}`,
            description: `Meter •••${d.meter_number!.slice(-4)} (${d.customer_name})`,
          },
        },
      },
    ],
    metadata: { order_id: order.id, wa_user_id: user.id, source: "whatsapp" },
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
    `💳 Pay *£${d.quoted_gbp!.toFixed(2)}* securely here:\n${session.url}\n\n` +
      `Link valid for 20 minutes. The token arrives in this chat right after payment. ⚡`
  );
}

// ---------------------------------------------------------------------------
// awaiting_payment
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
    .select("stripe_session_id, amount_gbp")
    .eq("id", convo.order_id!)
    .single();
  if (order?.stripe_session_id) {
    const session = await stripe.checkout.sessions.retrieve(order.stripe_session_id);
    if (session.url && session.status === "open") {
      return sendText(user.wa_phone, `Still waiting on payment — here's your link again:\n${session.url}\n\nSay *cancel* to stop.`);
    }
  }
  await resetConversation(user.id);
  return sendText(user.wa_phone, "That order lapsed. Say *retry* to start it again.");
}

async function expireOrder(convo: Conversation): Promise<void> {
  if (!convo.order_id) return;
  const { data: order } = await db
    .from("orders")
    .select("stripe_session_id, status")
    .eq("id", convo.order_id)
    .single();
  if (order?.status === "awaiting_payment") {
    await db.from("orders").update({ status: "expired" }).eq("id", convo.order_id);
    if (order.stripe_session_id) {
      try { await stripe.checkout.sessions.expire(order.stripe_session_id); } catch { /* already expired/paid */ }
    }
  }
}

// ---------------------------------------------------------------------------
// Flutterwave validation + quoting
// ---------------------------------------------------------------------------
async function flwValidateMeter(
  itemCode: string,
  billerCode: string,
  meterNumber: string
): Promise<{ ok: boolean; customerName?: string }> {
  // ⚠️ INTEGRATION: if Nolgic already wraps this endpoint, import and reuse it.
  try {
    const res = await fetch(
      `https://api.flutterwave.com/v3/bill-items/${itemCode}/validate?code=${billerCode}&customer=${encodeURIComponent(meterNumber)}`,
      { headers: { Authorization: `Bearer ${process.env.FLW_SECRET_KEY}` } }
    );
    const data = await res.json();
    if (data?.status === "success" && data?.data?.name) {
      return { ok: true, customerName: String(data.data.name).trim() };
    }
    return { ok: false };
  } catch (err) {
    console.error("[flw] validate error", err);
    return { ok: false };
  }
}

/**
 * ⚠️ INTEGRATION: Replace this with Nolgic's existing NGN→GBP pricing
 * (same FX source + margin as the website so the two channels never disagree).
 * The placeholder below reads a rate + margin from env as a stopgap.
 */
async function getGbpQuote(amountNgn: number): Promise<{ gbp: number; fxRate: number }> {
  const fxRate = Number(process.env.NGN_PER_GBP ?? 0);       // e.g. 2050
  const marginPct = Number(process.env.NOLGIC_MARGIN_PCT ?? 4);
  if (!fxRate) throw new Error("NGN_PER_GBP not configured and pricing integration not wired");
  const raw = amountNgn / fxRate;
  const gbp = Math.ceil(raw * (1 + marginPct / 100) * 100) / 100;
  return { gbp, fxRate };
}
