// Founder alerts via Resend (mail.nolgic.com verified domain).
// Non-fatal: alerting must never break the payment pipeline.

import { adminChatIds, esc, sendMessage, telegramConfigured } from "@/lib/tg/api";

// The owner's Telegram chats get the same alert, so a stuck order doesn't wait for someone to open their email.
const recent = new Map<string, number>();
async function alertTelegram(subject: string, text: string) {
  try {
    const ids = adminChatIds();
    if (!ids.length || !telegramConfigured()) return;
    const k = subject;
    const now = Date.now();
    if (now - (recent.get(k) ?? 0) < 60_000) return; // a burst of the same alert is one message
    recent.set(k, now);
    if (recent.size > 200) recent.clear();
    const body = `🚨 <b>${esc(subject)}</b>\n${esc(text).slice(0, 3400)}`;
    await Promise.all(ids.map((id) => sendMessage(id, body).catch(() => undefined)));
  } catch (e) {
    console.error("[alerts] telegram failed", e);
  }
}

export async function alertFounder(subject: string, text: string) {
  await Promise.all([alertEmail(subject, text), alertTelegram(subject, text)]);
}

async function alertEmail(subject: string, text: string) {
  const key = process.env.RESEND_API_KEY;
  const to = process.env.ALERT_EMAIL;
  if (!key || !to) {
    console.error(`[ALERT-NOEMAIL] ${subject}: ${text}`);
    return;
  }
  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: process.env.ALERT_FROM ?? "Nolgic <alerts@mail.nolgic.com>",
        to: [to],
        subject: `[Nolgic] ${subject}`,
        text,
      }),
    });
  } catch (e) {
    console.error("[alerts] failed", e);
  }
}
