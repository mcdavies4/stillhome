// src/lib/tg/api.ts
// Telegram Bot API client. Plain fetch, no SDK. Messages use HTML parse mode, so everything that came
// from a customer or a provider goes through esc() first.

import { safeEqual } from "@/lib/security";

const token = () => (process.env.TELEGRAM_BOT_TOKEN ?? "").trim();
export const telegramConfigured = () => !!token();
export const botUsername = () => (process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME ?? "").replace(/^@/, "").trim();

export class TgError extends Error {
  constructor(msg: string, public code = 0, public blocked = false) { super(msg); this.name = "TgError"; }
}

export const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export type Button = { text: string; data?: string; url?: string };
export type Keyboard = Button[][];

const markup = (kb?: Keyboard) =>
  kb && kb.length
    ? { inline_keyboard: kb.map((row) => row.map((b) => (b.url ? { text: b.text, url: b.url } : { text: b.text, callback_data: b.data ?? "x" }))) }
    : undefined;

async function call<T = any>(method: string, body: Record<string, unknown>): Promise<T> {
  const t = token();
  if (!t) throw new TgError("TELEGRAM_BOT_TOKEN is not set");
  // A 20 second limit, so a stalled Telegram call returns an error instead of hanging the request.
  const res = await fetch(`https://api.telegram.org/bot${t}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  const j: any = await res.json().catch(() => null);
  if (!res.ok || !j?.ok) {
    const desc = String(j?.description ?? `HTTP ${res.status}`);
    // 403 = the customer blocked the bot or deleted the chat; there is nobody to message.
    throw new TgError(`Telegram ${method}: ${desc}`, res.status, res.status === 403);
  }
  return j.result as T;
}

export async function sendMessage(chatId: number, html: string, kb?: Keyboard): Promise<void> {
  await call("sendMessage", { chat_id: chatId, text: html.slice(0, 4000), parse_mode: "HTML", disable_web_page_preview: true, reply_markup: markup(kb) });
}

/** Same as sendMessage, but returns the message id (needed to match an owner's reply to a forwarded customer message). */
export async function sendMessageId(chatId: number, html: string, kb?: Keyboard): Promise<number | null> {
  const r = await call<any>("sendMessage", { chat_id: chatId, text: html.slice(0, 4000), parse_mode: "HTML", disable_web_page_preview: true, reply_markup: markup(kb) });
  return Number(r?.message_id) || null;
}

/** The owner's chat ids (TELEGRAM_ADMIN_CHAT_IDS, comma separated). They get /stats, announcements, support messages and alerts. */
export const adminChatIds = (): number[] =>
  (process.env.TELEGRAM_ADMIN_CHAT_IDS ?? "").split(",").map((s) => Number(s.trim())).filter((n) => Number.isInteger(n) && n > 0);

/** Replaces a message's text + buttons in place (used when a button is tapped, so the chat does not fill with menus). */
export async function editMessage(chatId: number, messageId: number, html: string, kb?: Keyboard): Promise<void> {
  try {
    await call("editMessageText", { chat_id: chatId, message_id: messageId, text: html.slice(0, 4000), parse_mode: "HTML", disable_web_page_preview: true, reply_markup: markup(kb) ?? { inline_keyboard: [] } });
  } catch (e: any) {
    // "message is not modified" or the message is too old to edit: send a fresh one instead.
    if (e instanceof TgError && e.code === 400) return sendMessage(chatId, html, kb);
    throw e;
  }
}

export async function answerCallback(id: string, text?: string): Promise<void> {
  await call("answerCallbackQuery", { callback_query_id: id, text: text?.slice(0, 190) }).catch(() => undefined);
}

export async function sendTyping(chatId: number): Promise<void> {
  await call("sendChatAction", { chat_id: chatId, action: "typing" }).catch(() => undefined);
}

export const COMMANDS = [
  { command: "start", description: "Open the menu" },
  { command: "buy", description: "Buy light, TV, airtime or data" },
  { command: "saved", description: "My saved meters and phones" },
  { command: "orders", description: "My recent orders" },
  { command: "language", description: "Change language" },
  { command: "help", description: "Help and support" },
  { command: "cancel", description: "Cancel what I'm doing" },
];

export async function registerBot(webhookUrl: string, secret: string) {
  await call("setWebhook", { url: webhookUrl, secret_token: secret, allowed_updates: ["message", "callback_query"], drop_pending_updates: false });
  await call("setMyCommands", { commands: COMMANDS });
  const info = await call<any>("getWebhookInfo", {});
  const me = await call<any>("getMe", {});
  return { username: me?.username as string, webhook: info?.url as string, pending: info?.pending_update_count as number, lastError: (info?.last_error_message as string) ?? null };
}

/** The webhook only accepts calls that carry the secret we gave Telegram when we registered it. */
export function secretOk(req: Request): boolean {
  return safeEqual(req.headers.get("x-telegram-bot-api-secret-token"), process.env.TELEGRAM_WEBHOOK_SECRET ?? "");
}
