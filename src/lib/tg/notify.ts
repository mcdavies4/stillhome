// src/lib/tg/notify.ts
// Tells a Telegram customer what happened to their order: delivered (with the token), refunded, or being checked.
// Called by the shared vend pipeline (lib/fulfil-order.ts) the moment an order reaches an outcome, and by the sweep
// for anything that resolves later (a token that arrives late, an order a person fixes in the admin).
//
// Safe to call any number of times: tg_orders.notified remembers the last outcome sent, so each outcome is sent once.
// It never throws into the payment pipeline.

import { supabaseAdmin } from "@/lib/supabase";
import { pfmTitle, maskIdentifier } from "@/lib/payforme-shared";
import { expectsToken, tryRecoverToken } from "@/lib/fulfilment";
import { isExamBiller, splitPins } from "@/lib/exams-shared";
import { esc, sendMessage, telegramConfigured, TgError, type Keyboard } from "./api";
import { catOf } from "./engine";
import { waShare } from "./kit";
import { tgLinksSweep } from "./links";
import { T } from "./i18n";
import { broadcastSweep, remindersSweep } from "./store";

const naira = (n: number) => `₦${Math.round(Number(n)).toLocaleString("en-NG")}`;
const refOf = (id: string) => `NLG-${id.replace(/-/g, "").slice(0, 6).toUpperCase()}`;
const app = () => (process.env.NEXT_PUBLIC_APP_URL ?? "https://www.nolgic.com").replace(/\/+$/, "");
const supportEmail = () => process.env.SUPPORT_EMAIL ?? "nolgichq@gmail.com";

/** What the customer should hear about this order right now, or null if nothing yet. */
export function outcomeKey(o: { status: string; flw_token?: string | null; biller_name?: string | null; identifier_label?: string | null }): "done" | "pending_token" | "review" | "review_refund" | null {
  if (o.status === "fulfilled") return !o.flw_token && (expectsToken(o) || isExamBiller(o.biller_name)) ? "pending_token" : "done";
  if (o.status === "failed_refunded") return "done";
  if (o.status === "needs_review") return "review";
  if (o.status === "refund_failed") return "review_refund";
  return null; // pending_payment / paid: the order is still moving
}

/** The note a gift buyer forwards to the person they paid for: their own message, plus what was delivered. */
export function giftNote(o: any, cat: string | null, gift: { note?: string; from?: string }): string {
  const what =
    cat === "el" ? `I've paid for your light.${o.flw_token ? `\nMeter ${o.identifier}\nToken: ${o.flw_token}` : ""}`
    : cat === "tv" ? "I've renewed your TV subscription."
    : cat === "da" ? `I've sent ${naira(o.amount_ngn)} of data to your phone.`
    : cat === "ex" ? `Here is your PIN.${o.flw_token ? `\n${splitPins(o.flw_token).map((p) => `${p.label}: ${p.value}`).join("\n")}` : ""}`
    : `I've topped up your phone with ${naira(o.amount_ngn)} airtime.`;
  return [gift.note || "A little something for you 🎁", what, gift.from ? `— ${gift.from}` : ""].filter(Boolean).join("\n");
}

export function outcomeMessage(o: any, key: ReturnType<typeof outcomeKey>, gift?: { note?: string; from?: string } | null, lang?: string | null): { text: string; kb: Keyboard } | null {
  if (!key) return null;
  const ref = refOf(o.id);
  const cat = catOf({ biller_name: String(o.biller_name ?? ""), name: String(o.biller_name ?? ""), biller_code: String(o.biller_code ?? "") });
  const title = esc(pfmTitle(String(o.biller_name ?? "")));
  const id = esc(o.identifier);
  const who = o.customer_name ? ` (${esc(o.customer_name)})` : "";
  const amt = naira(o.amount_ngn);
  const t = T(lang);
  const receipt: Keyboard[number] = [{ text: "🧾 Receipt", url: `${app()}/order/${o.id}` }, { text: "🔁 Buy another", data: "buy" }];
  // Meters, smartcards and phones can be kept for next time (exam PINs can't).
  const keep = (k: Keyboard): Keyboard => (o.status === "fulfilled" && cat && cat !== "ex" ? [...k, [{ text: "💾 Save this", data: `sv:o:${o.id}` }]] : k);

  if (key === "pending_token") {
    return {
      text: cat === "ex"
        ? `${t.received} Your ${title} is being issued.\nIt can take a few minutes. I'll send the PIN here the moment it lands.\n\nRef: ${ref}`
        : `${t.received} Your ${title} units are on the way.\nThe token can take a few minutes. I'll send it here the moment it lands.\n\nRef: ${ref}`,
      kb: [receipt],
    };
  }
  if (key === "review") {
    return {
      text: `⏳ Your payment went through, but the provider is slow to confirm delivery. We're checking now.\nYou'll get your order here shortly, or a full refund if it can't be completed. You don't need to do anything.\n\nRef: ${ref}`,
      kb: [[{ text: "🧾 Order page", url: `${app()}/order/${o.id}` }]],
    };
  }
  if (key === "review_refund") {
    return {
      text: `⚠️ We couldn't complete your order, and your automatic refund needs a manual step. We've been alerted and will sort it out.\nIf you'd like an update, email ${esc(supportEmail())} with ref <b>${ref}</b>.`,
      kb: [[{ text: "🧾 Order page", url: `${app()}/order/${o.id}` }]],
    };
  }
  // key === "done": either delivered or refunded
  if (o.status === "failed_refunded") {
    return {
      text: `↩️ We couldn't complete your ${title} order (${amt}), so you've been <b>refunded in full</b>.\nIt returns to the card or account you paid with. Banks can take a few working days to show it. Nothing is lost, and you're welcome to try again.\n\nRef: ${ref}`,
      kb: [[{ text: "🔁 Try again", data: "buy" }]],
    };
  }
  const withGift = (m: { text: string; kb: Keyboard }) => {
    if (!gift || o.status !== "fulfilled") return m;
    const note = giftNote(o, cat, gift);
    return {
      text: `${m.text}\n\n🎁 <b>Send this to them:</b>\n<pre>${esc(note)}</pre>`,
      kb: [[{ text: "💬 Send on WhatsApp", url: waShare(note) }], ...m.kb],
    };
  };
  if (cat === "ex") {
    const pins = splitPins(o.flw_token).map((p) => `${esc(p.label)}: <code>${esc(p.value)}</code>`).join("\n");
    return withGift({ text: `${t.done}\n🎓 ${title} for ${id}\nAmount ${amt}${pins ? `\n\n🔑 ${pins}\n<i>Tap a code to copy it.</i>` : "\nYour PIN is on your receipt page."}\n\nRef: ${ref}`, kb: keep([receipt]) });
  }
  if (cat === "el") {
    const tok = o.flw_token ? `\n\n🔑 Token: <code>${esc(o.flw_token)}</code>\n<i>Tap the token to copy it. Forward this message to the meter owner if it isn't you.</i>` : "";
    return withGift({ text: `${t.done}\n⚡ ${title}\nMeter ${id}${who}\nAmount ${amt}${tok}\n\nRef: ${ref}`, kb: keep([receipt]) });
  }
  if (cat === "tv") {
    return withGift({ text: `${t.done}\n📺 ${title} paid for smartcard ${id}${who}\nAmount ${amt}\nIt can take a few minutes to show on your decoder.\n\nRef: ${ref}`, kb: keep([receipt]) });
  }
  if (cat === "da") {
    return withGift({ text: `${t.done}\n🌐 ${title}: ${amt} sent to ${esc(maskIdentifier(String(o.identifier)))}\nIt can take a minute to show on the line.\n\nRef: ${ref}`, kb: keep([receipt]) });
  }
  return withGift({ text: `${t.done}\n📱 ${amt} airtime sent to ${esc(maskIdentifier(String(o.identifier)))}\n\nRef: ${ref}`, kb: keep([receipt]) });
}

/**
 * Sends this order's outcome to its chat, once. Returns true if a message went out.
 * `force` sends the current outcome again (the customer asked "I've paid" after it was already sent).
 */
export async function tgNotifyOrder(orderId: string, opts: { force?: boolean } = {}): Promise<boolean> {
  try {
    if (!telegramConfigured()) return false;
    const db = supabaseAdmin();
    const { data: link } = await db.from("tg_orders").select("*").eq("order_id", orderId).maybeSingle();
    if (!link) return false; // not a Telegram order
    const { data: order } = await db.from("orders").select("*").eq("id", orderId).maybeSingle();
    if (!order) return false;

    const key = outcomeKey(order);
    const { data: who } = await db.from("tg_users").select("lang").eq("chat_id", link.chat_id).maybeSingle(); // empty before migration 0030: English
    const msg = outcomeMessage(order, key, link.gift ?? null, who?.lang ?? null);
    if (!key || !msg) return false;
    const prev: string | null = link.notified ?? null;
    if (!opts.force && prev === key) return false;

    // Claim this outcome before sending, so two callers at once don't both message the customer.
    if (!opts.force) {
      const q = db.from("tg_orders").update({ notified: key }).eq("order_id", orderId);
      const { data: won } = await (prev ? q.eq("notified", prev) : q.is("notified", null)).select("order_id");
      if (!won || !won.length) return false;
    }

    try {
      await sendMessage(Number(link.chat_id), msg.text, msg.kb);
    } catch (e: any) {
      if (!opts.force) await db.from("tg_orders").update({ notified: prev }).eq("order_id", orderId); // let the sweep retry
      if (e instanceof TgError && e.blocked) await db.from("tg_users").update({ blocked: true }).eq("chat_id", link.chat_id);
      console.error("[telegram] notify failed", orderId, e?.message ?? e);
      return false;
    }

    if (key === "done" || key === "pending_token") {
      const { data: u } = await db.from("tg_users").select("order_count,draft").eq("chat_id", link.chat_id).maybeSingle();
      const patch: Record<string, unknown> = {};
      if (key === "done" && order.status === "fulfilled" && prev !== "done" && !opts.force) patch.order_count = Number(u?.order_count ?? 0) + 1;
      if (u?.draft?.order?.id === orderId) { patch.state = "idle"; patch.draft = {}; }
      if (Object.keys(patch).length) await db.from("tg_users").update(patch).eq("chat_id", link.chat_id);
    }
    return true;
  } catch (e: any) {
    console.error("[telegram] notify error", orderId, e?.message ?? e);
    return false;
  }
}

// ───────────────────────── bulk airtime ─────────────────────────

const bulkKey = (status: string): "settled" | "review" | "refund_failed" | null =>
  status === "settled" ? "settled" : status === "needs_review" ? "review" : status === "refund_failed" ? "refund_failed" : null;

export function bulkMessage(b: any, key: ReturnType<typeof bulkKey>, counts?: { delivered: number; failed: number }): { text: string; kb: Keyboard } | null {
  if (!key) return null;
  const ref = `NLG-${String(b.id).replace(/-/g, "").slice(0, 6).toUpperCase()}`;
  const page: Keyboard = [[{ text: "🧾 Batch details", url: `${app()}/bulk/${b.id}` }, { text: "📦 Another batch", data: "bk:go" }]];
  const n = Number(b.recipients_count);
  const delivered = counts?.delivered ?? Number(b.delivered_count ?? 0);
  const failed = counts?.failed ?? Number(b.failed_count ?? 0);
  if (key === "review") {
    return { text: `⏳ Your bulk payment went through, but the provider is slow to confirm the top-ups. We're checking now.\nYou'll get the result here, or a refund for anything that can't be sent. You don't need to do anything.\n\nRef: ${ref}`, kb: [[{ text: "🧾 Batch details", url: `${app()}/bulk/${b.id}` }]] };
  }
  if (key === "refund_failed") {
    return { text: `⚠️ ${delivered} of ${n} top-ups were sent, but the refund for the rest needs a manual step. We've been alerted and will sort it out.\nEmail ${esc(supportEmail())} with ref <b>${ref}</b> for an update.`, kb: [[{ text: "🧾 Batch details", url: `${app()}/bulk/${b.id}` }]] };
  }
  if (delivered === 0) {
    return { text: `↩️ None of the ${n} top-ups could be sent, so you've been <b>refunded in full</b> (${naira(Number(b.refunded_ngn))}).\nIt returns to the card or account you paid with. Banks can take a few working days to show it.\n\nRef: ${ref}`, kb: page };
  }
  const lines = [`✅ <b>Bulk airtime done!</b>`, `${delivered} of ${n} sent · ${naira(Number(b.delivered_ngn))} delivered`];
  if (failed > 0) lines.push(`${failed} failed and ${failed === 1 ? "was" : "were"} refunded (${naira(Number(b.refunded_ngn))}). Banks can take a few working days to show it.`);
  lines.push("", `Ref: ${ref}`);
  return { text: lines.join("\n"), kb: page };
}

/** Tells the chat how a bulk batch ended, once. Safe to call repeatedly; never throws into the bulk pipeline. */
export async function tgNotifyBulk(bulkId: string, opts: { force?: boolean } = {}): Promise<boolean> {
  try {
    if (!telegramConfigured()) return false;
    const db = supabaseAdmin();
    const { data: link } = await db.from("tg_bulk").select("bulk_id,chat_id,notified").eq("bulk_id", bulkId).maybeSingle();
    if (!link) return false; // not a Telegram batch
    const { data: b } = await db.from("bulk_orders").select("*").eq("id", bulkId).maybeSingle();
    if (!b) return false;
    const key = bulkKey(b.status);
    const msg = bulkMessage(b, key);
    if (!key || !msg) return false;
    const prev: string | null = link.notified ?? null;
    if (!opts.force && prev === key) return false;
    if (!opts.force) {
      const q = db.from("tg_bulk").update({ notified: key }).eq("bulk_id", bulkId);
      const { data: won } = await (prev ? q.eq("notified", prev) : q.is("notified", null)).select("bulk_id");
      if (!won || !won.length) return false;
    }
    try {
      await sendMessage(Number(link.chat_id), msg.text, msg.kb);
    } catch (e: any) {
      if (!opts.force) await db.from("tg_bulk").update({ notified: prev }).eq("bulk_id", bulkId);
      if (e instanceof TgError && e.blocked) await db.from("tg_users").update({ blocked: true }).eq("chat_id", link.chat_id);
      console.error("[telegram] bulk notify failed", bulkId, e?.message ?? e);
      return false;
    }
    if (key === "settled") {
      const { data: u } = await db.from("tg_users").select("draft").eq("chat_id", link.chat_id).maybeSingle();
      if (u?.draft?.bk?.order?.id === bulkId) await db.from("tg_users").update({ state: "idle", draft: {} }).eq("chat_id", link.chat_id);
    }
    return true;
  } catch (e: any) {
    console.error("[telegram] bulk notify error", bulkId, e?.message ?? e);
    return false;
  }
}

/**
 * Catches everything the live notifications couldn't: a token that arrived late, an order someone resolved in the
 * admin, a message Telegram refused once. Cheap to run often. Also prunes old update ids.
 */
export async function tgSweep(budgetMs = 22_000): Promise<{ checked: number; sent: number }> {
  if (!telegramConfigured()) return { checked: 0, sent: 0 };
  // cron-job.org gives up on a request after 30 s, so the sweep stops starting new work at ~22 s and finishes the rest on
  // the next run (everything here is safe to repeat).
  const deadline = Date.now() + budgetMs;
  const db = supabaseAdmin();
  const since = new Date(Date.now() - 3 * 86400_000).toISOString();
  const { data: rows } = await db.from("tg_orders").select("order_id,notified").gte("created_at", since).limit(200);
  const open = (rows ?? []).filter((r: any) => r.notified !== "done").slice(0, 60);
  let sent = 0;
  for (let i = 0; i < open.length && Date.now() < deadline; i += 6) {
    await Promise.all(open.slice(i, i + 6).map(async (r: any) => {
      try {
        const { data: o } = await db.from("orders").select("*").eq("id", r.order_id).maybeSingle();
        if (!o) return;
        if (o.status === "fulfilled" && !o.flw_token && expectsToken(o)) await tryRecoverToken(db, o);
        if (await tgNotifyOrder(r.order_id)) sent++;
      } catch (e: any) {
        console.error("[telegram] sweep item failed", r.order_id, e?.message ?? e);
      }
    }));
  }
  // Bulk batches that settled (or got stuck) while no one was looking.
  try {
    const { data: bl } = await db.from("tg_bulk").select("bulk_id,notified").gte("created_at", since).limit(100);
    for (const r of ((bl ?? []) as any[]).filter((x) => x.notified !== "settled").slice(0, 40)) {
      if (Date.now() >= deadline) break;
      if (await tgNotifyBulk(r.bulk_id)) sent++;
    }
  } catch (e: any) {
    console.error("[telegram] bulk sweep failed", e?.message ?? e);
  }
  const links = await tgLinksSweep(deadline);
  sent += links.sent;
  // The customer's own reminders, and any announcement still going out. Each is isolated: one failing never stops the rest.
  try { const r = await remindersSweep(deadline); sent += r.sent; } catch (e: any) { console.error("[telegram] reminders sweep failed", e?.message ?? e); }
  try { const left = deadline - Date.now(); if (left > 3000) sent += await broadcastSweep(Math.min(6000, left - 1000)); } catch (e: any) { console.error("[telegram] broadcast sweep failed", e?.message ?? e); }
  await db.from("tg_updates").delete().lt("created_at", new Date(Date.now() - 3 * 86400_000).toISOString());
  return { checked: open.length + links.checked, sent };
}
