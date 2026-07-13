// src/lib/wa/engine.ts
// Conversation state machine — electricity (variable amount), TV subscriptions
// and mobile data (fixed-price packages). Wired to the existing Nolgic modules
// (validateCustomer, quoteGbp, stripe) and the live orders schema; paid orders
// flow through the already-tested Stripe webhook → vend → refund pipeline.

import { stripe } from "@/lib/stripe";
import { validateCustomer, FlwError } from "@/lib/flutterwave";
import { quoteGbp } from "@/lib/fx";
import {
  db, upsertWaUser, getConversation, setConversation, resetConversation,
  getBeneficiaries, type Conversation, type Draft, type WaUser,
} from "./db";
import { sendText, sendButtons, sendList } from "./client";
import { extractOrder } from "./extract";
import {
  billerByKey, billerByCodes, billersSameDisco, billersForHelp,
  matchPackages, brandsForCategory, type WaBiller,
} from "./billers";

const SITE = process.env.NEXT_PUBLIC_APP_URL ?? "https://nolgic.com";
const TTL_MIN = { collecting: 30, confirming: 30, awaiting_payment: 20 } as const;
const DAILY_ORDER_CAP = 10;

const ttl = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString();

function applyBiller(draft: Draft, b: WaBiller): void {
  draft.category = b.category;
  draft.brand = b.brand;
  draft.biller_code = b.biller_code;
  draft.item_code = b.item_code;
  draft.biller_name = b.biller_name;
  draft.identifier_label = b.identifier_label;
  if (b.category !== "electricity" && b.amount > 0) draft.amount_ngn = b.amount;
}

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
      `👋 Welcome to *Nolgic* — pay Nigerian bills from the UK, right here in WhatsApp.\n\n` +
        `⚡ Electricity: *IKEDC 10k meter 04123456789*\n` +
        `📺 TV: *DStv Compact 1034567890*\n` +
        `📱 Data: *MTN 2GB 08031234567*\n` +
        `📞 Airtime: *1k airtime 08031234567*\n\n` +
        `You pay in £ by card. Say *help* anytime.`
    );
    if (!text.trim()) return;
  }

  switch (convo.state) {
    case "idle":
    case "collecting":
      return handleCollecting(user, convo, text, buttonId);
    case "confirming":
      return handleConfirming(user, convo, text, buttonId);
    case "awaiting_payment":
      return handleAwaitingPayment(user, convo, text);
    case "vending":
      return sendText(waPhone, "⏳ Your order is processing — confirmation will land here in a moment.");
    case "failed":
      await resetConversation(user.id);
      return handleCollecting(user, await getConversation(user.id), text, buttonId);
  }
}

// ---------------------------------------------------------------------------
async function handleCollecting(
  user: WaUser,
  convo: Conversation,
  text: string,
  buttonId?: string
): Promise<void> {
  // Package picked from an interactive list → skip extraction entirely.
  if (buttonId) {
    const picked = await billerByKey(buttonId);
    if (picked) {
      const draft: Draft = { ...convo.draft };
      applyBiller(draft, picked);
      return advance(user, draft);
    }
  }

  // Deterministic shortcut: the draft is waiting for an identifier and the
  // message is just a number — no extraction needed, no ambiguity possible.
  const bare = text.trim().replace(/[\s-]/g, "");
  if (/^\d{8,15}$/.test(bare) && !convo.draft.identifier && (convo.draft.biller_code || convo.draft.brand)) {
    return advance(user, { ...convo.draft, identifier: bare });
  }

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
          `1️⃣ Tell me what to pay for\n` +
          `2️⃣ I confirm the details and the £ price\n` +
          `3️⃣ You pay by card (secure Stripe link)\n` +
          `4️⃣ Confirmation (and token, for electricity) arrives here\n\n` +
          `${await billersForHelp()}\n\n` +
          `Examples: *IKEDC 10k meter 04123456789* • *DStv Compact 1034567890* • *MTN 2GB 08031234567*\n` +
          `Shortcuts: *again*, *list*, *status*.`
      );

    case "list_beneficiaries": {
      if (!beneficiaries.length)
        return sendText(user.wa_phone, "Nothing saved yet. After your first order I'll save it for quick repeats.");
      const lines = beneficiaries
        .map((b) => `• *${b.alias}* — ${b.biller_name ?? ""} ${b.identifier}${b.customer_name ? ` (${b.customer_name})` : ""}`)
        .join("\n");
      return sendText(user.wa_phone, `Saved:\n${lines}\n\nSay e.g. *${beneficiaries[0].alias}* to buy again.`);
    }

    case "check_status": {
      const { data: order } = await db
        .from("orders")
        .select("status, amount_ngn, biller_name")
        .eq("wa_user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!order) return sendText(user.wa_phone, "No orders yet — tell me what you'd like to pay for!");
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
      const def = await billerByCodes(last.biller_code, last.item_code);
      const draft: Draft = {
        biller_code: last.biller_code,
        item_code: last.item_code,
        biller_name: last.biller_name,
        identifier: last.identifier,
        identifier_label: last.identifier_label ?? def?.identifier_label ?? "Meter Number",
        category: def?.category ?? "electricity",
        brand: def?.brand,
        amount_ngn: ex.updates.amount_ngn ?? Number(last.amount_ngn),
      };
      return validateAndQuote(user, draft);
    }

    case "buy_bill":
    case "other": {
      if (ex.intent === "other") {
        const u = ex.updates ?? {};
        const hasUpdates =
          !!u.biller_key || !!u.brand || u.package_query !== undefined ||
          !!u.identifier || !!u.amount_ngn || !!ex.resolved_beneficiary_id;
        // Pure chit-chat with an order in progress → re-ask, don't reset the thread.
        if (!hasUpdates) {
          if (convo.draft.biller_code || convo.draft.brand) {
            const missingNow: string[] = [];
            if (!convo.draft.identifier) missingNow.push("identifier");
            if (["electricity", "airtime"].includes(convo.draft.category ?? "electricity") && !convo.draft.amount_ngn) missingNow.push("amount");
            if (missingNow.length) return sendText(user.wa_phone, await questionFor(missingNow[0], convo.draft));
          }
          return sendText(user.wa_phone, ex.reply_if_other ?? "Tell me what you'd like to pay for to get started.");
        }
        // Extracted something useful → treat exactly like buy_bill below.
      }

      const draft: Draft = { ...convo.draft };

      if (ex.resolved_beneficiary_id) {
        const b = beneficiaries.find((x) => x.id === ex.resolved_beneficiary_id);
        if (b) {
          const def = await billerByCodes(b.biller_code, b.item_code);
          if (def) applyBiller(draft, def);
          draft.identifier = b.identifier;
          draft.beneficiary_alias = b.alias;
        }
      }
      if (ex.updates.biller_key) {
        const def = await billerByKey(ex.updates.biller_key);
        if (def && (def.category === "electricity" || def.category === "airtime")) applyBiller(draft, def);
      }
      if (ex.updates.brand) {
        draft.brand = ex.updates.brand;
        draft.category = (await brandsForCategory("tv")).some(
          (x) => x.toLowerCase() === ex.updates.brand!.toLowerCase()
        )
          ? "tv"
          : "data";
        // brand changed → previous package selection no longer applies
        if (ex.updates.package_query !== undefined) {
          draft.package_query = ex.updates.package_query;
          draft.biller_code = undefined;
          draft.item_code = undefined;
        }
      } else if (ex.updates.package_query !== undefined && draft.brand) {
        draft.package_query = ex.updates.package_query;
        draft.biller_code = undefined;
        draft.item_code = undefined;
      }
      if (ex.updates.identifier) draft.identifier = ex.updates.identifier;
      if (ex.updates.amount_ngn && ["electricity", "airtime"].includes(draft.category ?? "electricity")) {
        draft.amount_ngn = ex.updates.amount_ngn;
      }
      if (ex.updates.beneficiary_alias) draft.beneficiary_alias = String(ex.updates.beneficiary_alias).toLowerCase();

      return advance(user, draft);
    }
  }
}

/** Decide the next step from whatever the draft now holds. */
async function advance(user: WaUser, draft: Draft): Promise<void> {
  // TV/data with a brand but no concrete item → resolve the package.
  if ((draft.category === "tv" || draft.category === "data") && !draft.item_code) {
    const matches = await matchPackages(draft.brand ?? "", draft.package_query ?? "");
    if (matches.length === 1) {
      applyBiller(draft, matches[0]);
    } else if (matches.length > 1) {
      await setConversation(user.id, { state: "collecting", draft, expires_at: ttl(TTL_MIN.collecting) });
      return sendList(
        user.wa_phone,
        draft.package_query
          ? `A few ${draft.brand} options match "${draft.package_query}" — pick one:`
          : `Which ${draft.brand} package?`,
        "Choose package",
        matches.map((m) => ({
          id: m.key,
          title: m.label.replace(new RegExp(`^${draft.brand}\\s*`, "i"), "").trim() || m.label,
          description: m.amount ? `₦${m.amount.toLocaleString()}` : undefined,
        }))
      );
    } else {
      await setConversation(user.id, { state: "collecting", draft, expires_at: ttl(TTL_MIN.collecting) });
      return sendText(
        user.wa_phone,
        `I couldn't find a ${draft.brand} package matching "${draft.package_query}". ` +
          `Try the package name (e.g. *Compact*, *Jolli*) or say just *${draft.brand}* to see options.`
      );
    }
  }

  const missing: string[] = [];
  if (!draft.biller_code) missing.push("product");
  if (!draft.identifier) missing.push("identifier");
  if (["electricity", "airtime"].includes(draft.category ?? "electricity") && !draft.amount_ngn) missing.push("amount");

  if (missing.length) {
    await setConversation(user.id, { state: "collecting", draft, expires_at: ttl(TTL_MIN.collecting) });
    return sendText(user.wa_phone, await questionFor(missing[0], draft));
  }

  // Category-specific identifier sanity before hitting FLW
  if (draft.category === "data" || draft.category === "airtime") {
    const d = draft.identifier!;
    const ok = (d.length === 11 && d.startsWith("0")) || (d.length === 13 && d.startsWith("234"));
    if (!ok) {
      await setConversation(user.id, {
        state: "collecting",
        draft: { ...draft, identifier: undefined },
        expires_at: ttl(TTL_MIN.collecting),
      });
      return sendText(user.wa_phone, "That doesn't look like a Nigerian phone number — send it like *08031234567*.");
    }
  }

  return validateAndQuote(user, draft);
}

async function questionFor(field: string, draft: Draft): Promise<string> {
  switch (field) {
    case "product":
      return `What would you like to pay for?\n${await billersForHelp()}`;
    case "identifier": {
      const label = draft.identifier_label ?? "number";
      if (draft.category === "tv") return `What's the smartcard number? (on the decoder or an old receipt)`;
      if (draft.category === "data") return `Which phone number should get the data? e.g. *08031234567*`;
      return `What's the ${label.toLowerCase()}? (digits only)`;
    }
    case "amount":
      return draft.category === "airtime"
        ? "How much airtime in naira? e.g. *500* or *1k*"
        : "How much in naira? e.g. *10k* or *10,000*";
    default:
      return "Could you give me a bit more detail?";
  }
}

// ---------------------------------------------------------------------------
async function validateAndQuote(user: WaUser, draft: Draft): Promise<void> {
  const checking =
    draft.category === "tv" ? "🔍 Checking that smartcard…"
    : draft.category === "data" || draft.category === "airtime" ? "🔍 Checking that number…"
    : "🔍 Checking that meter…";
  await sendText(user.wa_phone, checking);

  let name: string | null = null;
  let minimum: number | undefined;
  let maximum: number | undefined;
  let lastErr = "the provider couldn't validate this number";
  let validated = false;

  if (draft.category === "electricity" || !draft.category) {
    // Try every catalogue entry for the disco (prepaid/postpaid variants).
    const chosen = await billerByCodes(draft.biller_code!, draft.item_code!);
    const candidates = chosen ? await billersSameDisco(chosen) : [];
    const tryList = candidates.length ? candidates.slice(0, 6) : [];
    for (const c of tryList) {
      try {
        console.log("[wa] validating", c.biller_name, c.biller_code, c.item_code, draft.identifier);
        const v = await validateCustomer(c.item_code, c.biller_code, draft.identifier!);
        name = v.name ?? "(name not returned by provider)";
        minimum = v.minimum ?? undefined;
        maximum = v.maximum ?? undefined;
        applyBiller(draft, c);
        validated = true;
        break;
      } catch (e) {
        lastErr = e instanceof FlwError ? e.message : lastErr;
      }
    }
  } else {
    // TV: FLW validates smartcards and returns the account name.
    // Data: validation often just echoes — tolerate failure, the number
    // itself is shown prominently on the confirmation card instead.
    try {
      console.log("[wa] validating", draft.biller_name, draft.biller_code, draft.item_code, draft.identifier);
      const v = await validateCustomer(draft.item_code!, draft.biller_code!, draft.identifier!);
      name = v.name ?? null;
      validated = true;
    } catch (e) {
      lastErr = e instanceof FlwError ? e.message : lastErr;
      if (draft.category === "data" || draft.category === "airtime") {
        validated = true; // proceed — confirmation shows the number for the user to verify
        name = null;
      }
    }
  }

  if (!validated) {
    await setConversation(user.id, {
      state: "collecting",
      draft: { ...draft, identifier: undefined },
      expires_at: ttl(TTL_MIN.collecting),
    });
    const what = draft.category === "tv" ? "smartcard number" : draft.category === "data" ? "phone number" : "meter number";
    return sendText(user.wa_phone, `❌ ${lastErr}. Please double-check the ${what} and send it again (digits only).`);
  }
  draft.customer_name = name ?? undefined;

  if (draft.category === "airtime") {
    if (draft.amount_ngn! < 1000) {
      await setConversation(user.id, { state: "collecting", draft: { ...draft, amount_ngn: undefined }, expires_at: ttl(TTL_MIN.collecting) });
      return sendText(user.wa_phone, "Minimum airtime order is ₦1,000. How much would you like?");
    }
    if (draft.amount_ngn! > 50000) {
      await setConversation(user.id, { state: "collecting", draft: { ...draft, amount_ngn: undefined }, expires_at: ttl(TTL_MIN.collecting) });
      return sendText(user.wa_phone, "Maximum airtime per order is ₦50,000. How much would you like?");
    }
  }

  if (draft.category === "electricity" || !draft.category) {
    if (minimum && draft.amount_ngn! < minimum) {
      await setConversation(user.id, { state: "collecting", draft: { ...draft, amount_ngn: undefined }, expires_at: ttl(TTL_MIN.collecting) });
      return sendText(user.wa_phone, `Minimum for ${draft.biller_name} is ₦${minimum.toLocaleString()}. How much would you like?`);
    }
    if (maximum && draft.amount_ngn! > maximum) {
      await setConversation(user.id, { state: "collecting", draft: { ...draft, amount_ngn: undefined }, expires_at: ttl(TTL_MIN.collecting) });
      return sendText(user.wa_phone, `Maximum for ${draft.biller_name} is ₦${maximum.toLocaleString()}. How much would you like?`);
    }
  }

  let quote: ReturnType<typeof quoteGbp>;
  try {
    quote = quoteGbp(draft.amount_ngn!);
  } catch (e) {
    console.error("[wa] quoteGbp failed for", draft.amount_ngn, e);
    await setConversation(user.id, { state: "collecting", draft: { ...draft, amount_ngn: undefined }, expires_at: ttl(TTL_MIN.collecting) });
    return sendText(user.wa_phone, "I couldn't price that amount — the minimum order is ₦1,000. How much would you like?");
  }
  if (quote.totalPence < 50) {
    await setConversation(user.id, { state: "collecting", draft: { ...draft, amount_ngn: undefined }, expires_at: ttl(TTL_MIN.collecting) });
    return sendText(user.wa_phone, "That amount is too small to charge by card — the minimum order is about ₦1,000. How much would you like?");
  }
  draft.total_pence = quote.totalPence;
  draft.service_fee_pence = quote.serviceFeePence;
  draft.ngn_per_gbp = quote.ngnPerGbp;
  draft.quoted_at = new Date().toISOString();

  await setConversation(user.id, { state: "confirming", draft, expires_at: ttl(TTL_MIN.confirming) });

  const icon = draft.category === "tv" ? "📺" : draft.category === "data" ? "📱" : draft.category === "airtime" ? "📞" : "⚡";
  const idLine = `${draft.identifier_label ?? "Number"}: ${draft.identifier}`;
  await sendButtons(
    user.wa_phone,
    `${icon} *${draft.biller_name}*\n` +
      `${idLine}\n` +
      (draft.customer_name ? `Name: *${draft.customer_name}*\n` : "") +
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
    return sendText(user.wa_phone, "No problem — what should I change?");
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
  return handleCollecting(user, { ...convo, state: "collecting" }, text, buttonId);
}

async function createOrderAndPaymentLink(user: WaUser, convo: Conversation): Promise<void> {
  const d = convo.draft;

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
      customer_name: d.customer_name ?? null,
      recipient_whatsapp: user.wa_phone,
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
            description: `${d.identifier_label ?? "Number"} •••${d.identifier!.slice(-4)}${d.customer_name ? ` (${d.customer_name})` : ""}`,
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
      `Link valid for 20 minutes. Confirmation arrives in this chat right after payment. ⚡`
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
