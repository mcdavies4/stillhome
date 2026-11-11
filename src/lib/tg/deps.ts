// src/lib/tg/deps.ts
// The real connections behind the bot's conversation (engine.ts): Telegram, the database, the bills provider and
// order creation. The engine only knows the shapes in `Deps`.

import { supabaseAdmin } from "@/lib/supabase";
import { getBillCategories, validateCustomer } from "@/lib/bills";
import { confirmPaystackPayment } from "@/lib/paystack-process";
import { confirmFlutterwavePayment } from "@/lib/flwpay-process";
import { supportNumber } from "@/lib/support-contact";
import { answerCallback, editMessage, sendMessage, sendTyping } from "./api";
import { pbExamCatalogue } from "@/lib/paybeta";
import { examService } from "@/lib/exams-shared";
import { examAsBillers, payForMeEnabled } from "@/lib/payforme-shared";
import { createPayRequest, startPayRequestPayment, examsOn } from "@/lib/payforme";
import { createCollect } from "@/lib/payforme-collect";
import { bulkEnabled, syncBulk } from "@/lib/bulk";
import { createTelegramOrder } from "./order";
import { createTelegramBulk } from "./bulk-order";
import { tgNotifyOrder, tgNotifyBulk } from "./notify";
import { tgTrackLink } from "./links";
import type { Deps, Item, RecentOrder, TgUser } from "./engine";

// The catalogue is cached by the bills provider for an hour; keep one copy per warm instance for a minute on top.
let memo: { at: number; items: Item[] } | null = null;
async function catalogue(): Promise<Item[]> {
  if (memo && Date.now() - memo.at < 60_000) return memo.items;
  const items = (await getBillCategories("NG")) as unknown as Item[];
  // Exam PINs live in their own Paybeta list; when they're switched on they join the catalogue as one more category.
  if (items.length && examsOn()) {
    try {
      const by = new Map<string, { service: string; title: string; idLabel: string; items: { code: string; name: string; price: number }[] }>();
      for (const i of await pbExamCatalogue()) {
        const sv = examService(i.service, i.serviceName);
        if (!by.has(i.service)) by.set(i.service, { service: i.service, title: sv.title, idLabel: sv.idLabel, items: [] });
        by.get(i.service)!.items.push({ code: i.code, name: i.name, price: i.price });
      }
      items.push(...(examAsBillers(Array.from(by.values())) as unknown as Item[]));
    } catch (e: any) {
      console.error("[telegram] exam catalogue failed", e?.message ?? e);
    }
  }
  if (items.length) memo = { at: Date.now(), items };
  return items;
}

const ASKS_PER_HOUR = 6;
/** One chat can't flood the site with requests / giveaways (the website rate-limits these per IP; the bot has no IP). */
async function tooMany(chatId: number): Promise<boolean> {
  const since = new Date(Date.now() - 3600_000).toISOString();
  const { count } = await supabaseAdmin().from("tg_links").select("id", { count: "exact", head: true }).eq("chat_id", chatId).gte("created_at", since);
  return (count ?? 0) >= ASKS_PER_HOUR;
}
const TOO_MANY = "You've made a few of these in a short time. Please wait a while and try again.";
const toItems = (items: any[]) => items.map((e) => ({ billerCode: e.billerCode, itemCode: e.itemCode, billerName: e.billerName, itemName: e.itemName, identifier: e.identifier, identifierLabel: e.identifierLabel, amount: e.amount }));

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
    get flags() {
      return {
        bulk: bulkEnabled() && process.env.NEXT_PUBLIC_BULK_ENABLED === "1",
        ask: payForMeEnabled(),
        giveaway: payForMeEnabled(),
        exams: examsOn(),
        accounts: process.env.NEXT_PUBLIC_ACCOUNTS_ENABLED === "1",
      };
    },

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
    createBulk: createTelegramBulk,

    async checkBulk(chatId, bulkId) {
      // Only the chat that placed the batch can ask about it.
      const { data: link } = await db.from("tg_bulk").select("bulk_id").eq("bulk_id", bulkId).eq("chat_id", chatId).maybeSingle();
      if (!link) return "unknown";
      const { data: b0 } = await db.from("bulk_orders").select("status").eq("id", bulkId).maybeSingle();
      if (!b0) return "unknown";
      const before = b0.status as string;
      await syncBulk(bulkId); // re-checks the payment with the gateway and moves the batch on (the website page does the same)
      const { data: b1 } = await db.from("bulk_orders").select("status").eq("id", bulkId).maybeSingle();
      const status = (b1?.status ?? before) as string;
      if (["settled", "needs_review", "refund_failed"].includes(status)) await tgNotifyBulk(bulkId, { force: before === status });
      return status;
    },

    async createAsk(i) {
      try {
        if (await tooMany(i.chatId)) return { ok: false, error: TOO_MANY };
        const r = await createPayRequest({ receiverName: i.name, receiverEmail: i.email ?? undefined, note: i.note ?? undefined, items: toItems(i.items) }, `telegram:${i.chatId}`);
        if (!r.ok) return { ok: false, error: r.error };
        await tgTrackLink(i.chatId, "ask", r.id, r.key);
        return { ok: true, id: r.id, key: r.key, total: r.total, count: r.count };
      } catch (e: any) {
        console.error("[telegram] ask failed", e?.message ?? e);
        return { ok: false, error: "Something went wrong. Nothing was charged. Please try again." };
      }
    },

    async createGiveaway(i) {
      try {
        if (await tooMany(i.chatId)) return { ok: false, error: TOO_MANY };
        const ip = `telegram:${i.chatId}`;
        const r = await createPayRequest({ receiverName: i.name, receiverEmail: i.email, note: i.note ?? undefined, giveaway: true, items: toItems(i.items) }, ip);
        if (!r.ok) return { ok: false, error: r.error };
        await tgTrackLink(i.chatId, "give", r.id, r.key);
        const app = (process.env.NEXT_PUBLIC_APP_URL ?? "https://www.nolgic.com").replace(/\/+$/, "");
        const pay = await startPayRequestPayment(r.id, { email: i.email, name: i.name }, ip);
        // If the payment link can't start right now, the giveaway is saved: its page can take the payment.
        return { ok: true, id: r.id, key: r.key, total: r.total, count: r.count, url: pay.ok ? pay.url : `${app}/r/${r.id}?k=${r.key}` };
      } catch (e: any) {
        console.error("[telegram] giveaway failed", e?.message ?? e);
        return { ok: false, error: "Something went wrong. Nothing was charged. Please try again." };
      }
    },

    async createLink(i) {
      try {
        if (await tooMany(i.chatId)) return { ok: false, error: TOO_MANY };
        const r = await createCollect({ makerName: i.name, makerEmail: i.email, note: i.note ?? undefined, budget: i.budget, categories: i.categories, maxPeople: i.maxPeople }, `telegram:${i.chatId}`);
        if (!r.ok) return { ok: false, error: r.error };
        await tgTrackLink(i.chatId, "link", r.id, r.key);
        return { ok: true, id: r.id, key: r.key };
      } catch (e: any) {
        console.error("[telegram] giveaway link failed", e?.message ?? e);
        return { ok: false, error: "Something went wrong. Nothing was charged. Please try again." };
      }
    },

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
