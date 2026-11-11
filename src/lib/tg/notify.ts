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
import { esc, sendMessage, telegramConfigured, TgError, type Keyboard } from "./api";
import { catOf } from "./engine";

const naira = (n: number) => `₦${Math.round(Number(n)).toLocaleString("en-NG")}`;
const refOf = (id: string) => `NLG-${id.replace(/-/g, "").slice(0, 6).toUpperCase()}`;
const app = () => (process.env.NEXT_PUBLIC_APP_URL ?? "https://www.nolgic.com").replace(/\/+$/, "");
const supportEmail = () => process.env.SUPPORT_EMAIL ?? "nolgichq@gmail.com";

/** What the customer should hear about this order right now, or null if nothing yet. */
export function outcomeKey(o: { status: string; flw_token?: string | null; biller_name?: string | null; identifier_label?: string | null }): "done" | "pending_token" | "review" | "review_refund" | null {
  if (o.status === "fulfilled") return !o.flw_token && expectsToken(o) ? "pending_token" : "done";
  if (o.status === "failed_refunded") return "done";
  if (o.status === "needs_review") return "review";
  if (o.status === "refund_failed") return "review_refund";
  return null; // pending_payment / paid: the order is still moving
}

export function outcomeMessage(o: any, key: ReturnType<typeof outcomeKey>): { text: string; kb: Keyboard } | null {
  if (!key) return null;
  const ref = refOf(o.id);
  const cat = catOf({ biller_name: String(o.biller_name ?? ""), name: String(o.biller_name ?? "") });
  const title = esc(pfmTitle(String(o.biller_name ?? "")));
  const id = esc(o.identifier);
  const who = o.customer_name ? ` (${esc(o.customer_name)})` : "";
  const amt = naira(o.amount_ngn);
  const receipt: Keyboard[number] = [{ text: "🧾 Receipt", url: `${app()}/order/${o.id}` }, { text: "🔁 Buy another", data: "buy" }];

  if (key === "pending_token") {
    return {
      text: `✅ <b>Payment received.</b> Your ${title} units are on the way.\nThe token can take a few minutes. I'll send it here the moment it lands.\n\nRef: ${ref}`,
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
  if (cat === "el") {
    const tok = o.flw_token ? `\n\n🔑 Token: <code>${esc(o.flw_token)}</code>\n<i>Tap the token to copy it. Forward this message to the meter owner if it isn't you.</i>` : "";
    return { text: `✅ <b>Done!</b>\n⚡ ${title}\nMeter ${id}${who}\nAmount ${amt}${tok}\n\nRef: ${ref}`, kb: [receipt] };
  }
  if (cat === "tv") {
    return { text: `✅ <b>Done!</b>\n📺 ${title} paid for smartcard ${id}${who}\nAmount ${amt}\nIt can take a few minutes to show on your decoder.\n\nRef: ${ref}`, kb: [receipt] };
  }
  if (cat === "da") {
    return { text: `✅ <b>Done!</b>\n🌐 ${title}: ${amt} sent to ${esc(maskIdentifier(String(o.identifier)))}\nIt can take a minute to show on the line.\n\nRef: ${ref}`, kb: [receipt] };
  }
  return { text: `✅ <b>Done!</b>\n📱 ${amt} airtime sent to ${esc(maskIdentifier(String(o.identifier)))}\n\nRef: ${ref}`, kb: [receipt] };
}

/**
 * Sends this order's outcome to its chat, once. Returns true if a message went out.
 * `force` sends the current outcome again (the customer asked "I've paid" after it was already sent).
 */
export async function tgNotifyOrder(orderId: string, opts: { force?: boolean } = {}): Promise<boolean> {
  try {
    if (!telegramConfigured()) return false;
    const db = supabaseAdmin();
    const { data: link } = await db.from("tg_orders").select("order_id,chat_id,notified").eq("order_id", orderId).maybeSingle();
    if (!link) return false; // not a Telegram order
    const { data: order } = await db.from("orders").select("*").eq("id", orderId).maybeSingle();
    if (!order) return false;

    const key = outcomeKey(order);
    const msg = outcomeMessage(order, key);
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

/**
 * Catches everything the live notifications couldn't: a token that arrived late, an order someone resolved in the
 * admin, a message Telegram refused once. Cheap to run often. Also prunes old update ids.
 */
export async function tgSweep(): Promise<{ checked: number; sent: number }> {
  if (!telegramConfigured()) return { checked: 0, sent: 0 };
  const db = supabaseAdmin();
  const since = new Date(Date.now() - 3 * 86400_000).toISOString();
  const { data: rows } = await db.from("tg_orders").select("order_id,notified").gte("created_at", since).limit(200);
  const open = (rows ?? []).filter((r: any) => r.notified !== "done").slice(0, 60);
  let sent = 0;
  for (const r of open) {
    try {
      const { data: o } = await db.from("orders").select("*").eq("id", r.order_id).maybeSingle();
      if (!o) continue;
      if (o.status === "fulfilled" && !o.flw_token && expectsToken(o)) await tryRecoverToken(db, o);
      if (await tgNotifyOrder(r.order_id)) sent++;
    } catch (e: any) {
      console.error("[telegram] sweep item failed", r.order_id, e?.message ?? e);
    }
  }
  await db.from("tg_updates").delete().lt("created_at", new Date(Date.now() - 3 * 86400_000).toISOString());
  return { checked: open.length, sent };
}
