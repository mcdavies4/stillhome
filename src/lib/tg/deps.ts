// src/lib/tg/deps.ts
// The real connections behind the bot's conversation (engine.ts): Telegram, the database, the bills provider and
// order creation. The engine only knows the shapes in `Deps`.

import { supabaseAdmin } from "@/lib/supabase";
import { getBillCategories, validateCustomer } from "@/lib/bills";
import { confirmPaystackPayment } from "@/lib/paystack-process";
import { confirmFlutterwavePayment } from "@/lib/flwpay-process";
import { supportNumber } from "@/lib/support-contact";
import { answerCallback, editMessage, sendMessage, sendTyping } from "./api";
import { createTelegramOrder } from "./order";
import { tgNotifyOrder } from "./notify";
import type { Deps, Item, RecentOrder, TgUser } from "./engine";

// The catalogue is cached by the bills provider for an hour; keep one copy per warm instance for a minute on top.
let memo: { at: number; items: Item[] } | null = null;
async function catalogue(): Promise<Item[]> {
  if (memo && Date.now() - memo.at < 60_000) return memo.items;
  const items = (await getBillCategories("NG")) as unknown as Item[];
  if (items.length) memo = { at: Date.now(), items };
  return items;
}

export function realDeps(): Deps {
  const db = supabaseAdmin();
  return {
    send: sendMessage,
    edit: editMessage,
    answer: answerCallback,
    typing: sendTyping,
    catalogue,
    appUrl: (process.env.NEXT_PUBLIC_APP_URL ?? "https://www.nolgic.com").replace(/\/+$/, ""),
    supportEmail: process.env.SUPPORT_EMAIL ?? "nolgichq@gmail.com",
    supportWhatsapp: supportNumber(),

    async seen(updateId) {
      const { error } = await db.from("tg_updates").insert({ update_id: updateId });
      if (!error) return false;
      if ((error as any).code === "23505") return true;
      console.error("[telegram] dedupe insert failed", error.message);
      return false; // never drop a customer's message because bookkeeping failed
    },

    async getUser(from) {
      const { data, error } = await db
        .from("tg_users")
        .upsert({ chat_id: from.id, first_name: from.first_name ?? null, username: from.username ?? null, last_seen_at: new Date().toISOString(), blocked: false }, { onConflict: "chat_id" })
        .select("*")
        .single();
      if (error || !data) throw error ?? new Error("tg_users upsert failed");
      return { ...(data as any), draft: (data as any).draft ?? {} } as TgUser;
    },

    async saveUser(chatId, patch) {
      const { error } = await db.from("tg_users").update(patch).eq("chat_id", chatId);
      if (error) throw error;
    },

    async validate(item, identifier) {
      const v = await validateCustomer(item.item_code, item.biller_code, identifier);
      return { name: v.name ?? null, minimum: Number(v.minimum) || 0 };
    },

    createOrder: createTelegramOrder,

    async checkOrder(chatId, orderId) {
      // Only the chat that placed the order can ask about it.
      const { data: link } = await db.from("tg_orders").select("order_id").eq("order_id", orderId).eq("chat_id", chatId).maybeSingle();
      if (!link) return "unknown";
      const { data: o } = await db.from("orders").select("id,status,payment_provider").eq("id", orderId).maybeSingle();
      if (!o) return "unknown";
      const before = o.status as string;
      let status = before;
      if (before === "pending_payment") {
        try {
          if (o.payment_provider === "paystack") await confirmPaystackPayment(orderId);
          else if (o.payment_provider === "flutterwave") await confirmFlutterwavePayment(orderId);
        } catch (e: any) {
          console.error("[telegram] confirm check failed", orderId, e?.message ?? e);
        }
        const { data: again } = await db.from("orders").select("status").eq("id", orderId).maybeSingle();
        status = again?.status ?? status;
      }
      if (status !== "pending_payment" && status !== "paid") {
        // Finished. If it only finished just now, the payment pipeline has already messaged the chat (this just
        // covers a race with another process, and never doubles up). If it was finished before the customer asked,
        // they want to see the outcome again, so send it again.
        const justNow = before === "pending_payment" || before === "paid";
        await tgNotifyOrder(orderId, { force: !justNow });
      }
      return status;
    },

    async recentOrders(chatId): Promise<RecentOrder[]> {
      const { data: links } = await db.from("tg_orders").select("order_id").eq("chat_id", chatId).order("created_at", { ascending: false }).limit(12);
      const ids = (links ?? []).map((l: any) => l.order_id);
      if (!ids.length) return [];
      const { data: rows } = await db
        .from("orders")
        .select("id,status,biller_code,item_code,biller_name,identifier,customer_name,amount_ngn,flw_token,identifier_label,created_at")
        .in("id", ids);
      const byId = new Map((rows ?? []).map((r: any) => [r.id, r]));
      const stale = Date.now() - 2 * 3600_000;
      return ids
        .map((id: string) => byId.get(id))
        .filter((r: any) => r && !(r.status === "pending_payment" && new Date(r.created_at).getTime() < stale)) // old unpaid ones are just clutter
        .slice(0, 5) as RecentOrder[];
    },
  };
}
