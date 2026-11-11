// src/lib/tg/store.ts
// The real database behind round 3 (saved items, reminders, announcements, support, rep counters, the owner's numbers),
// and the two sweeps that finish what the customer asked for later (reminders that are due, an announcement still going out).

import { supabaseAdmin } from "@/lib/supabase";
import { visitorId } from "@/lib/analytics";
import { esc, sendMessage, sendMessageId, adminChatIds, TgError } from "./api";
import { createPayLink, payLinkReady, listChatLinks, chatOwnerView, setChatLinkActive, deleteChatLink } from "@/lib/paylink";
import { BROADCAST_FOOTER, dueAt, type SavedItem, type V3 } from "./v3";
import { computeStats, countSources, startOfLagosDay, type FailureRow, type StatOrder } from "./stats";

const MAX_SAVED = 10;
const SUPPORT_PER_HOUR = 5;
const refOf = (id: string) => `NLG-${id.replace(/-/g, "").slice(0, 6).toUpperCase()}`;
/** A tg_saved row as the conversation sees it (the table says biller_code / item_code, the conversation says bc / ic). */
const toSaved = (r: any): SavedItem => ({ id: r.id, label: r.label, cat: r.cat, title: r.title ?? null, bc: r.biller_code, ic: r.item_code, identifier: r.identifier, name: r.name ?? null });
const markBlocked = (chatId: number) => supabaseAdmin().from("tg_users").update({ blocked: true }).eq("chat_id", chatId);

export function realV3(): V3 {
  const db = supabaseAdmin();
  return {
    get admins() { return adminChatIds(); },

    async repOk(code) {
      const { data } = await db.from("reps").select("code").eq("code", code).eq("active", true).maybeSingle();
      return !!data;
    },

    async track(code, chatId, what) {
      try {
        // The same counters the website writes for ?rep= links, so the weekly rep numbers include Telegram visits.
        const base = { path: "/telegram", vid: visitorId(`telegram:${chatId}`, "telegram"), src: "rep", campaign: code, device: "mobile", browser: "Telegram", country: "NG" };
        const row = what === "view" ? { ...base, kind: "view", name: "/telegram" } : { ...base, kind: "event", name: what };
        await db.from("site_events").insert(row);
      } catch (e: any) {
        console.error("[telegram] rep track failed", e?.message ?? e);
      }
    },

    bills: {
      ready: () => payLinkReady().catch(() => false),
      list: (chatId) => listChatLinks(chatId).catch(() => []),
      view: (chatId, slug) => chatOwnerView(chatId, slug).catch(() => null),
      async create(chatId, i) {
        try {
          const r = await createPayLink({ name: i.name, email: i.email ?? undefined, note: i.note ?? undefined, items: i.items }, { ownerChat: chatId });
          return r.ok ? { ok: true, slug: r.slug } : { ok: false, error: r.error };
        } catch (e: any) {
          console.error("[telegram] bills link failed", e?.message ?? e);
          return { ok: false, error: "Something went wrong. Nothing was charged. Please try again." };
        }
      },
      setActive: (chatId, slug, active) => setChatLinkActive(chatId, slug, active).catch(() => false),
      remove: (chatId, slug) => deleteChatLink(chatId, slug).catch(() => false),
    },

    saved: {
      async list(chatId) {
        const { data } = await db.from("tg_saved").select("*").eq("chat_id", chatId).order("created_at", { ascending: true }).limit(MAX_SAVED + 5);
        return ((data ?? []) as any[]).map(toSaved);
      },
      async get(chatId, id) {
        if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
        const { data } = await db.from("tg_saved").select("*").eq("id", id).eq("chat_id", chatId).maybeSingle();
        return data ? toSaved(data) : null;
      },
      async add(chatId, s) {
        const { count } = await db.from("tg_saved").select("id", { count: "exact", head: true }).eq("chat_id", chatId);
        if ((count ?? 0) >= MAX_SAVED) return { ok: false, error: `You already have ${MAX_SAVED} saved. Remove one to make room.` };
        const { data, error } = await db.from("tg_saved").insert({ chat_id: chatId, label: s.label, cat: s.cat, title: s.title, biller_code: s.bc, item_code: s.ic, identifier: s.identifier, name: s.name }).select("*").single();
        if (error || !data) {
          if ((error as any)?.code === "23505") {
            const { data: ex } = await db.from("tg_saved").select("*").eq("chat_id", chatId).eq("biller_code", s.bc).eq("item_code", s.ic).eq("identifier", s.identifier).maybeSingle();
            if (ex) return { ok: true, item: toSaved(ex) };
          }
          console.error("[telegram] save failed (has migration 0030 been run?)", error?.message);
          return { ok: false, error: "I couldn't save that just now. Please try again." };
        }
        return { ok: true, item: toSaved(data) };
      },
      async remove(chatId, id) {
        if (!/^[0-9a-f-]{36}$/i.test(id)) return;
        await db.from("tg_saved").delete().eq("id", id).eq("chat_id", chatId);
      },
      async fromOrder(chatId, orderId) {
        const { data: link } = await db.from("tg_orders").select("order_id").eq("order_id", orderId).eq("chat_id", chatId).maybeSingle();
        if (!link) return null;
        const { data: o } = await db.from("orders").select("biller_code,item_code,identifier,customer_name,biller_name,status").eq("id", orderId).maybeSingle();
        if (!o || o.status !== "fulfilled") return null;
        return { bc: o.biller_code, ic: o.item_code, identifier: o.identifier, name: o.customer_name ?? null, biller_name: o.biller_name };
      },
    },

    reminders: {
      async list(chatId) {
        const { data } = await db.from("tg_reminders").select("id,saved_id,due_at,repeat_days").eq("chat_id", chatId).eq("active", true).limit(30);
        return (data ?? []) as any[];
      },
      async set(chatId, savedId, at, repeatDays) {
        await db.from("tg_reminders").delete().eq("chat_id", chatId).eq("saved_id", savedId);
        const { error } = await db.from("tg_reminders").insert({ chat_id: chatId, saved_id: savedId, due_at: at.toISOString(), repeat_days: repeatDays, active: true });
        if (error) throw error;
      },
      async clear(chatId, savedId) {
        await db.from("tg_reminders").delete().eq("chat_id", chatId).eq("saved_id", savedId);
      },
    },

    admin: {
      async stats() {
        const since = new Date(Date.now() - 8 * 86400_000).toISOString();
        const { data } = await db.from("orders").select("status,amount_ngn,source,created_at,rep,is_test").gte("created_at", since).limit(5000);
        const todayIso = new Date(startOfLagosDay()).toISOString();
        const count = async (f: (q: any) => any) => (await f(db.from("tg_users").select("chat_id", { count: "exact", head: true }))).count ?? 0;
        const [total, blocked, optedOut, newToday] = await Promise.all([
          count((q) => q.eq("blocked", false)),
          count((q) => q.eq("blocked", true)),
          count((q) => q.eq("optout", true)),
          count((q) => q.gte("created_at", todayIso)),
        ]);
        const { data: joined } = await db.from("tg_users").select("src,ref,created_at").gte("created_at", since).limit(5000);
        return { ...computeStats((data ?? []) as StatOrder[], { total, newToday, blocked, optedOut }), sources: countSources((joined ?? []) as any[]) };
      },
      async failures(): Promise<FailureRow[]> {
        const since = new Date(Date.now() - 3 * 86400_000).toISOString();
        const { data } = await db.from("orders").select("id,status,biller_name,amount_ngn,source,created_at,is_test").in("status", ["needs_review", "refund_failed", "failed_refunded", "paid"]).gte("created_at", since).order("created_at", { ascending: false }).limit(60);
        const now = Date.now();
        return ((data ?? []) as any[])
          .filter((o) => !o.is_test)
          // "paid" is normal for a minute or two; only flag it when it has sat there.
          .filter((o) => o.status !== "paid" || now - new Date(o.created_at).getTime() > 10 * 60_000)
          .map((o) => ({ ref: refOf(o.id), status: o.status, biller: String(o.biller_name ?? ""), amount: Number(o.amount_ngn) || 0, ageMin: (now - new Date(o.created_at).getTime()) / 60_000, source: String(o.source ?? "") }));
      },
      async audience() { return audience(); },
    },

    broadcast: {
      async draft(adminChat, body) {
        const n = await audience();
        const { data, error } = await db.from("tg_broadcasts").insert({ admin_chat: adminChat, body, status: "draft", audience: n, cursor: 0, sent: 0, failed: 0 }).select("id").single();
        if (error || !data) throw error ?? new Error("broadcast insert failed (has migration 0030 been run?)");
        return { id: data.id, audience: n };
      },
      async start(adminChat, id) {
        const { data: running } = await db.from("tg_broadcasts").select("id").eq("status", "sending").limit(1);
        if ((running ?? []).length) return { ok: false, error: "Another announcement is still going out. Wait for it to finish." };
        const { data: won } = await db.from("tg_broadcasts").update({ status: "sending" }).eq("id", id).eq("admin_chat", adminChat).eq("status", "draft").select("id,audience");
        if (!won || !won.length) return { ok: false, error: "That announcement was already sent or cancelled." };
        const r = await broadcastStep(id, 60);
        return { ok: true, sent: r.sent, audience: won[0].audience };
      },
      async cancel(adminChat, id) {
        await db.from("tg_broadcasts").update({ status: "cancelled" }).eq("id", id).eq("admin_chat", adminChat).in("status", ["draft", "sending"]);
      },
    },

    support: {
      async forward(i) {
        const admins = adminChatIds();
        if (!admins.length) return { ok: false, error: "Support chat isn't set up. Please email us instead." };
        const since = new Date(Date.now() - 3600_000).toISOString();
        const { data: recent } = await db.from("tg_support").select("batch").eq("chat_id", i.chatId).gte("created_at", since).limit(100);
        if (new Set((recent ?? []).map((r: any) => r.batch)).size >= SUPPORT_PER_HOUR) return { ok: false, error: "You've sent a few messages already. We'll reply here soon. Please wait a little before sending more." };
        const { data: last } = await db.from("tg_orders").select("order_id").eq("chat_id", i.chatId).order("created_at", { ascending: false }).limit(1);
        let lastOrder = "";
        if (last?.[0]) {
          const { data: o } = await db.from("orders").select("id,status,biller_name,amount_ngn").eq("id", last[0].order_id).maybeSingle();
          if (o) lastOrder = `\nLast order: ${refOf(o.id)} · ${esc(o.biller_name)} · ₦${Math.round(Number(o.amount_ngn)).toLocaleString("en-NG")} · ${esc(o.status)}`;
        }
        const batch = crypto.randomUUID();
        const text = `💬 <b>Support</b> from ${esc(i.name || "customer")}${i.username ? ` (@${esc(i.username)})` : ""}\nChat: <code>${i.chatId}</code>${i.email ? `\nEmail: ${esc(i.email)}` : ""}${lastOrder}\n\n${esc(i.text.slice(0, 1500))}\n\n<i>Reply to this message to answer.</i>`;
        let delivered = 0;
        for (const a of admins) {
          try {
            const mid = await sendMessageId(a, text);
            if (mid) { await db.from("tg_support").insert({ batch, chat_id: i.chatId, admin_chat: a, admin_msg_id: mid }); delivered++; }
          } catch (e: any) {
            console.error("[telegram] support forward failed", a, e?.message ?? e);
          }
        }
        return delivered ? { ok: true } : { ok: false, error: "I couldn't reach the team just now. Please email us instead." };
      },
      async lookup(adminChat, adminMsgId) {
        const { data } = await db.from("tg_support").select("chat_id").eq("admin_chat", adminChat).eq("admin_msg_id", adminMsgId).maybeSingle();
        return data ? Number(data.chat_id) : null;
      },
    },
  };
}

// ───────────────────────── announcements ─────────────────────────

async function audience(): Promise<number> {
  const { count } = await supabaseAdmin().from("tg_users").select("chat_id", { count: "exact", head: true }).eq("blocked", false).neq("optout", true);
  return count ?? 0;
}

/**
 * Sends the next batch of an announcement. The cursor is claimed before sending, so two runs at once never send the
 * same people twice; if a run dies half way, the people in that batch miss it rather than getting it twice.
 */
export async function broadcastStep(id: string, batch = 100): Promise<{ sent: number; done: boolean }> {
  const db = supabaseAdmin();
  const { data: b } = await db.from("tg_broadcasts").select("*").eq("id", id).maybeSingle();
  if (!b || b.status !== "sending") return { sent: 0, done: true };
  const prevCursor = Number(b.cursor) || 0;
  const { data: users } = await db.from("tg_users").select("chat_id").eq("blocked", false).neq("optout", true).gt("chat_id", prevCursor).order("chat_id", { ascending: true }).limit(batch);
  const list = ((users ?? []) as any[]).map((u) => Number(u.chat_id));
  if (!list.length) {
    await db.from("tg_broadcasts").update({ status: "done", finished_at: new Date().toISOString() }).eq("id", id).eq("status", "sending");
    await sendMessage(Number(b.admin_chat), `📣 Announcement finished: ${b.sent} delivered, ${b.failed} could not be reached.`).catch(() => undefined);
    return { sent: 0, done: true };
  }
  const { data: claimed } = await db.from("tg_broadcasts").update({ cursor: list[list.length - 1] }).eq("id", id).eq("cursor", prevCursor).select("id");
  if (!claimed || !claimed.length) return { sent: 0, done: false };
  let sent = 0, failed = 0;
  for (const chat of list) {
    try {
      await sendMessage(chat, `${esc(b.body)}${BROADCAST_FOOTER}`);
      sent++;
    } catch (e: any) {
      failed++;
      if (e instanceof TgError && e.blocked) await markBlocked(chat);
    }
  }
  await db.from("tg_broadcasts").update({ sent: Number(b.sent) + sent, failed: Number(b.failed) + failed }).eq("id", id);
  return { sent, done: false };
}

/** Keeps any announcement that is still going out moving (called from the sweep). */
export async function broadcastSweep(budgetMs = 35_000): Promise<number> {
  const db = supabaseAdmin();
  const { data } = await db.from("tg_broadcasts").select("id").eq("status", "sending").limit(3);
  const t0 = Date.now();
  let sent = 0;
  for (const b of (data ?? []) as any[]) {
    for (let k = 0; k < 8 && Date.now() - t0 < budgetMs; k++) {
      const r = await broadcastStep(b.id, 100);
      sent += r.sent;
      if (r.done) break;
    }
  }
  return sent;
}

// ───────────────────────── reminders the customer chose ─────────────────────────

/** Sends every reminder that is due. Once-only reminders switch off; repeating ones move on to their next date. */
export async function remindersSweep(): Promise<{ checked: number; sent: number }> {
  const db = supabaseAdmin();
  const nowIso = new Date().toISOString();
  const { data: due } = await db.from("tg_reminders").select("*").eq("active", true).lt("due_at", nowIso).limit(100);
  let sent = 0;
  for (const r of (due ?? []) as any[]) {
    const prevDue: string = r.due_at;
    const next = r.repeat_days ? dueAt(Number(r.repeat_days)).toISOString() : null;
    // Claim it first: a second sweep at the same moment finds due_at already moved (or active off) and skips it.
    const claim = db.from("tg_reminders").update(next ? { due_at: next, last_sent_at: nowIso } : { active: false, last_sent_at: nowIso }).eq("id", r.id).eq("due_at", prevDue).eq("active", true);
    const { data: won } = await claim.select("id");
    if (!won || !won.length) continue;
    try {
      const { data: s } = await db.from("tg_saved").select("*").eq("id", r.saved_id).maybeSingle();
      const { data: u } = await db.from("tg_users").select("blocked").eq("chat_id", r.chat_id).maybeSingle();
      if (!s || u?.blocked) { await db.from("tg_reminders").update({ active: false }).eq("id", r.id); continue; }
      const what = s.cat === "el" ? "top up your light" : s.cat === "tv" ? "renew your TV" : s.cat === "da" ? "buy data" : "top up airtime";
      await sendMessage(Number(r.chat_id), `⏰ <b>Reminder: ${esc(s.label)}</b>\nIt's time to ${what}.${s.name ? `\n${esc(s.name)}` : ""}`, [
        [{ text: "🔁 Buy now", data: `sv:b:${s.id}` }],
        [{ text: "⏰ Change reminder", data: `sv:r:${s.id}` }, { text: "🔕 Turn off", data: `rm:x:${s.id}` }],
      ]);
      sent++;
    } catch (e: any) {
      // Telegram refused: put it back so the next sweep tries again (unless they blocked the bot).
      if (e instanceof TgError && e.blocked) { await markBlocked(Number(r.chat_id)); await db.from("tg_reminders").update({ active: false }).eq("id", r.id); }
      else await db.from("tg_reminders").update({ due_at: prevDue, active: true }).eq("id", r.id);
      console.error("[telegram] reminder send failed", r.id, e?.message ?? e);
    }
  }
  return { checked: (due ?? []).length, sent };
}
