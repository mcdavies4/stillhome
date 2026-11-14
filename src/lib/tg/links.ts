// src/lib/tg/links.ts
// Follow-up messages for the things the bot started that someone else finishes: a request waiting for a friend to pay,
// a giveaway being delivered, a giveaway link filling up. The bot remembers each one in tg_links; the sweep
// (tgLinksSweep, run by the same cron as the order sweep) tells the chat when the status moves.
// Each status is announced once (compare-and-set on tg_links.last), and nothing here can affect the payment itself.

import { supabaseAdmin } from "@/lib/supabase";
import { esc, sendMessage, telegramConfigured, TgError, type Keyboard } from "./api";

const naira = (n: number) => `₦${Math.round(Number(n)).toLocaleString("en-NG")}`;
const app = () => (process.env.NEXT_PUBLIC_APP_URL ?? "https://www.nolgic.com").replace(/\/+$/, "");

export type LinkKind = "ask" | "give" | "link" | "bill";

/** Remember a request / giveaway / giveaway link started from this chat. Never throws. */
export async function tgTrackLink(chatId: number, kind: LinkKind, ref: string, key: string): Promise<void> {
  try {
    await supabaseAdmin().from("tg_links").insert({ chat_id: chatId, kind, ref, key });
  } catch (e: any) {
    console.error("[telegram] track link failed", e?.message ?? e);
  }
}

const FINAL: Record<LinkKind, string[]> = {
  ask: ["settled", "cancelled", "expired"],
  give: ["settled", "cancelled", "expired"],
  link: ["closed", "cancelled", "expired"],
  bill: ["settled", "cancelled", "expired"],
};

/** What to say when a thing reaches this status, or null to stay quiet. */
export function linkMessage(kind: LinkKind, status: string, ref: string, key: string, total?: number, extra?: { payer?: string | null; tokens?: string[] }): { text: string; kb: Keyboard } | null {
  const mine = kind === "link" ? `${app()}/c/${ref}?k=${key}` : `${app()}/r/${ref}?k=${key}`;
  const page: Keyboard = [[{ text: "📄 My page", url: mine }]];
  const amt = total ? ` (${naira(total)})` : "";
  if (kind === "ask") {
    if (status === "paid") return { text: `🎉 <b>Someone paid for your request${amt}!</b> I'm delivering it now.`, kb: page };
    if (status === "settled") return { text: `✅ <b>Your request has been delivered.</b> Your tokens and confirmations are on your page.`, kb: page };
    if (status === "needs_review") return { text: `⏳ Your request was paid, but one item is slow to confirm. We're checking it now and will refund anything that can't be delivered.`, kb: page };
    if (status === "expired") return { text: `⌛ Your request expired after 7 days without a payment. Nothing was charged. You can make a new one any time.`, kb: [[{ text: "🙏 New request", data: "sc:ask" }]] };
  }
  if (kind === "give") {
    if (status === "paid") return { text: `✅ <b>Payment received${amt}.</b> I'm sending your giveaway out now.`, kb: page };
    if (status === "settled") return { text: `🎉 <b>Your giveaway has been delivered.</b> Each person's token or confirmation is on your page, ready to send on.`, kb: page };
    if (status === "needs_review") return { text: `⏳ Your giveaway was paid, but one gift is slow to confirm. We're checking it now and will refund anything that can't be delivered.`, kb: page };
  }
  if (kind === "bill") {
    const who = extra?.payer ? esc(extra.payer) : "Someone";
    const bill = total ? ` ${naira(total)}` : "";
    if (status === "paid") return { text: `🎉 <b>${who} paid${bill} toward your bills!</b> I'm delivering it now.`, kb: page };
    if (status === "settled") {
      const toks = extra?.tokens?.length ? `

Your token${extra.tokens.length > 1 ? "s" : ""}:
${extra.tokens.map((t) => `<code>${esc(t)}</code>`).join("\n")}` : "";
      return { text: `✅ <b>Delivered.</b> ${who}'s${bill} payment has gone through.${toks}`, kb: page };
    }
    if (status === "needs_review") return { text: `⏳ ${who} paid, but one item is slow to confirm. We're checking it now and will refund anything that can't be delivered.`, kb: page };
  }
  if (kind === "link") {
    if (status === "full") return { text: `🎉 <b>Your giveaway link is full.</b> Open your page to see who joined, then pay once for everyone.`, kb: page };
    if (status === "expired") return { text: `⌛ Your giveaway link expired. Nothing was charged.`, kb: [[{ text: "🎉 New giveaway", data: "sc:gv" }]] };
  }
  return null;
}

export async function tgLinksSweep(deadline?: number): Promise<{ checked: number; sent: number }> {
  if (!telegramConfigured()) return { checked: 0, sent: 0 };
  const db = supabaseAdmin();
  const since = new Date(Date.now() - 9 * 86400_000).toISOString();
  const { data: links } = await db.from("tg_links").select("*").gte("created_at", since).order("created_at", { ascending: false }).limit(200);
  const open = (links ?? []).filter((l: any) => !(FINAL[l.kind as LinkKind] ?? []).includes(l.last ?? "")).slice(0, 60);
  let sent = 0;
  for (const l of open as any[]) {
    if (deadline && Date.now() >= deadline) break; // the rest waits for the next sweep
    try {
      const kind = l.kind as LinkKind;
      const prev: string | null = l.last ?? null;
      const { data: row } = await db.from(kind === "link" ? "pay_collects" : "pay_requests").select("*").eq("id", l.ref).maybeSingle();
      if (!row) continue;
      const status = String(row.status);
      if (status === prev) continue;
      let extra: { payer?: string | null; tokens?: string[] } | undefined;
      if (kind === "bill") {
        extra = { payer: row.payer_name ?? null };
        if (status === "settled") {
          const { data: os } = await db.from("orders").select("flw_token,status").eq("pay_request_id", l.ref);
          extra.tokens = ((os ?? []) as any[]).filter((o) => o.status === "fulfilled" && o.flw_token).map((o) => String(o.flw_token));
        }
      }
      const msg = linkMessage(kind, status, l.ref, l.key, Number(row.amount_ngn ?? 0) + Number(row.fee_ngn ?? 0) || undefined, extra);
      // Claim this status before sending so two sweeps can't both announce it. A status we stay quiet about is still recorded.
      const q = db.from("tg_links").update({ last: status }).eq("id", l.id);
      const { data: won } = await (prev ? q.eq("last", prev) : q.is("last", null)).select("id");
      if (!won || !won.length || !msg) continue;
      try {
        await sendMessage(Number(l.chat_id), msg.text, msg.kb);
        sent++;
      } catch (e: any) {
        await db.from("tg_links").update({ last: prev }).eq("id", l.id); // retry on the next sweep
        if (e instanceof TgError && e.blocked) await db.from("tg_users").update({ blocked: true }).eq("chat_id", l.chat_id);
      }
    } catch (e: any) {
      console.error("[telegram] link sweep failed", l.id, e?.message ?? e);
    }
  }
  return { checked: open.length, sent };
}

