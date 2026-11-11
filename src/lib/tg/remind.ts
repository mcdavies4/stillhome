// src/lib/tg/remind.ts
// When the top-up reminder email goes out (lib/reminders.ts), a customer who also uses the Telegram bot with the
// same email gets it in the chat too, with a one-tap "buy again". Same rules as the email (it is only called after
// the email was sent, so opt-outs, timing and the one-per-payment limit already apply). Never throws.

import { supabaseAdmin } from "@/lib/supabase";
import { pfmTitle } from "@/lib/payforme-shared";
import { esc, sendMessage, telegramConfigured, TgError } from "./api";

const naira = (n: number | string) => `₦${Math.round(Number(n)).toLocaleString("en-NG")}`;

type Due = { order: { email: string; identifier: string; biller_code?: string | null; item_code?: string | null; biller_name?: string | null; amount_ngn: number | string }; kind: "electricity" | "tv"; gapDays: number; basis: string; ageDays: number };

export async function tgRemind(d: Due, token: string): Promise<number> {
  try {
    if (!telegramConfigured()) return 0;
    const db = supabaseAdmin();
    const { data: chats } = await db.from("tg_users").select("chat_id,blocked").eq("email", d.order.email).eq("blocked", false);
    let sent = 0;
    for (const c of (chats ?? []) as any[]) {
      const o = d.order;
      const tail = o.identifier.length > 4 ? `…${o.identifier.slice(-4)}` : o.identifier;
      const days = Math.max(1, Math.round(d.ageDays));
      const what = d.kind === "tv" ? `your ${esc(pfmTitle(String(o.biller_name ?? "TV")))} subscription (card ${esc(tail)})` : `light on meter ${esc(tail)}`;
      const guess = d.basis === "own history" ? ` You usually top up about every ${d.gapDays} days.` : "";
      const text = `⏳ <b>${d.kind === "tv" ? "Time to renew your TV?" : "Running low on light?"}</b>\nIt's been ${days} days since you paid ${naira(o.amount_ngn)} for ${what}.${guess}`;
      const app = (process.env.NEXT_PUBLIC_APP_URL ?? "https://www.nolgic.com").replace(/\/+$/, "");
      // The button reuses "buy again": remember what it stands for on the chat's row, then it is one tap.
      await db.from("tg_users").update({ state: "idle", draft: { menu: [{ bc: o.biller_code, ic: o.item_code, id: o.identifier, nm: null, amt: Number(o.amount_ngn) }] } }).eq("chat_id", c.chat_id);
      try {
        await sendMessage(Number(c.chat_id), text, [
          [{ text: d.kind === "tv" ? "🔁 Renew now" : "🔁 Top up now", data: "ag:0" }],
          [{ text: "Stop these reminders", url: `${app}/reminders/${token}` }],
        ]);
        sent++;
      } catch (e: any) {
        if (e instanceof TgError && e.blocked) await db.from("tg_users").update({ blocked: true }).eq("chat_id", c.chat_id);
      }
    }
    return sent;
  } catch (e: any) {
    console.error("[telegram] reminder failed", e?.message ?? e);
    return 0;
  }
}
