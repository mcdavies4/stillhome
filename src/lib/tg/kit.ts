// src/lib/tg/kit.ts
// The small shared pieces every part of the bot's conversation uses: the per-message context, replying, saving
// where the customer is, and a few formatters. Kept apart from engine.ts so bulk.ts and social.ts can use them
// without importing the engine (which imports them).

import type { Deps, Draft, Flags, TgUser } from "./engine";
import { esc, type Keyboard } from "./api";

export const naira = (n: number) => `₦${Math.round(n).toLocaleString("en-NG")}`;

export interface Ctx { d: Deps; chatId: number; user: TgUser; cbId?: string; msgId?: number }

export const rows = (btns: { text: string; data: string }[], per = 2): Keyboard => {
  const out: Keyboard = [];
  for (let k = 0; k < btns.length; k += per) out.push(btns.slice(k, k + per));
  return out;
};

export const CANCEL: Keyboard[number] = [{ text: "✖ Cancel", data: "x" }];

export async function reply(c: Ctx, html: string, kb?: Keyboard) {
  // A tapped button edits the message it was on, so the chat doesn't fill up with old menus.
  if (c.msgId) return c.d.edit(c.chatId, c.msgId, html, kb);
  return c.d.send(c.chatId, html, kb);
}
export async function say(c: Ctx, html: string, kb?: Keyboard) { return c.d.send(c.chatId, html, kb); }

export async function save(c: Ctx, state: string, draft: Draft) {
  c.user.state = state;
  c.user.draft = draft;
  await c.d.saveUser(c.chatId, { state, draft });
}

export function parseAmount(text: string): number | null {
  const t = text.toLowerCase().replace(/[₦,\s]|ngn|naira/g, "");
  const k = t.match(/^(\d+(?:\.\d+)?)k$/);
  const n = k ? Number(k[1]) * 1000 : /^\d+(?:\.\d+)?$/.test(t) ? Number(t) : NaN;
  return Number.isFinite(n) ? Math.round(n) : null;
}

export const safeMessage = (e: any) => {
  const m = String(e?.message ?? "");
  return m && !/^(Flutterwave|VTpass|Paybeta|Telegram|Paystack) /i.test(m) && m.length < 220 ? m : "I couldn't check that number right now. Please try again in a moment.";
};

/** Share a message on WhatsApp / Telegram. */
export const waShare = (text: string) => `https://wa.me/?text=${encodeURIComponent(text)}`;
export const tgShare = (text: string) => `https://t.me/share/url?url=${encodeURIComponent(" ")}&text=${encodeURIComponent(text)}`;

/** The four everyday categories (plus exam PINs when they are switched on) as button rows, for the "what to give" pickers. */
export function catRows(f: Flags): Keyboard {
  const kb: Keyboard = [
    [{ text: "⚡ Light", data: "c:el" }, { text: "📺 TV", data: "c:tv" }],
    [{ text: "📱 Airtime", data: "c:ai" }, { text: "🌐 Data", data: "c:da" }],
  ];
  if (f.exams) kb[1].push({ text: "🎓 Exam PIN", data: "c:ex" });
  return kb;
}

/** Asks for the email (receipts, tokens), then carries on with `after`. The draft is kept so nothing is lost. */
export async function askEmailFor(c: Ctx, draft: Draft, after: "confirm" | "list" | "bk" | undefined, prompt?: string) {
  await save(c, "ask_email", { ...draft, after });
  await reply(c, prompt ?? (c.user.email
    ? `Your receipts go to <b>${esc(c.user.email)}</b>. Type a new email to change it, or cancel.`
    : "Where should we send your receipt? Type your email address (asked only once)."), [CANCEL]);
}
