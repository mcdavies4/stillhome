// src/lib/tg/v3.ts
// Round 3 of the bot, the parts that live in the conversation: saved meters and phones, reminders the customer picks,
// the owner's commands, announcements (and /stop), the "talk to us" chat, and the language switch.
// Like the rest of the engine it touches nothing outside `Deps`, so it is tested without a network.

import { maskIdentifier } from "@/lib/payforme-shared";
import { cleanText } from "@/lib/gift";
import { cleanRepCode } from "@/lib/rep-client";
import { esc, type Keyboard } from "./api";
import { CANCEL, reply, say, save, type Ctx } from "./kit";
import { LANGS, T, isLang } from "./i18n";
import { fmtFailures, fmtStats, type FailureRow, type StatsData } from "./stats";
import type { Cat } from "./engine";
import * as billslink from "./billslink";

// ───────────────────────── what the outside world has to provide ─────────────────────────

export interface SavedItem { id: string; label: string; cat: string; title: string | null; bc: string; ic: string; identifier: string; name: string | null }
export interface OrderSource { bc: string; ic: string; identifier: string; name: string | null; biller_name: string }
export interface ReminderRow { id: string; saved_id: string; due_at: string; repeat_days: number | null }

export interface V3 {
  admins: number[];
  /** Is this an active sales rep code? (Checked before it is remembered on a customer.) */
  repOk(code: string): Promise<boolean>;
  /** Counts a rep link click / meter check / pay tap towards the rep's numbers (the same counters the website uses). */
  track(code: string, chatId: number, what: "view" | "lookup_ok" | "checkout_click"): Promise<void>;
  saved: {
    list(chatId: number): Promise<SavedItem[]>;
    get(chatId: number, id: string): Promise<SavedItem | null>;
    add(chatId: number, s: Omit<SavedItem, "id">): Promise<{ ok: true; item: SavedItem } | { ok: false; error: string }>;
    remove(chatId: number, id: string): Promise<void>;
    /** The details of one of this chat's own delivered orders, for the Save button. */
    fromOrder(chatId: number, orderId: string): Promise<OrderSource | null>;
  };
  reminders: {
    list(chatId: number): Promise<ReminderRow[]>;
    /** One reminder per saved item: setting a new one replaces the old. */
    set(chatId: number, savedId: string, dueAt: Date, repeatDays: number | null): Promise<void>;
    clear(chatId: number, savedId: string): Promise<void>;
  };
  admin: {
    stats(): Promise<StatsData>;
    failures(): Promise<FailureRow[]>;
    audience(): Promise<number>;
  };
  broadcast: {
    draft(adminChat: number, body: string): Promise<{ id: string; audience: number }>;
    start(adminChat: number, id: string): Promise<{ ok: boolean; error?: string; sent?: number; audience?: number }>;
    cancel(adminChat: number, id: string): Promise<void>;
  };
  /** "My bills link": the standing link friends and family pay (see billslink.ts and lib/paylink.ts). */
  bills: billslink.Bills;
  support: {
    forward(i: { chatId: number; name: string; username: string | null; email: string | null; text: string }): Promise<{ ok: boolean; error?: string }>;
    lookup(adminChat: number, adminMsgId: number): Promise<number | null>;
  };
}

export interface Hooks {
  menu(c: Ctx): Promise<void>;
  rebuy(c: Ctx, ref: { bc: string; ic: string; id: string; nm: string | null }): Promise<void>;
  catOf(i: { biller_name: string; name: string; biller_code: string }): Cat | null;
  stale(c: Ctx): Promise<unknown>;
}

const MAX_SAVED = 10;
const LABEL_MAX = 24;
const CAT_ICON: Record<string, string> = { el: "⚡", tv: "📺", ai: "📱", da: "🌐" };
const SUGGEST: Record<string, string[]> = { el: ["Home", "Shop", "Mum's place"], tv: ["Home", "Mum's TV"], ai: ["My line", "Mum", "Dad"], da: ["My line", "Mum", "Dad"] };

// ───────────────────────── first touch: where did this customer come from ─────────────────────────

/** /start rep_chika remembers the rep (first touch only); /start hero (or footer, header...) remembers which Nolgic button they used. */
export async function captureStart(c: Ctx, payload: string | undefined) {
  const p = String(payload ?? "").trim().toLowerCase();
  if (!p) return;
  try {
    const m = /^rep_([a-z0-9]{3,20})$/.exec(p);
    if (m) {
      const code = cleanRepCode(m[1]);
      if (!code || !(await c.d.v3.repOk(code))) return;
      if (!c.user.ref) {
        c.user.ref = code;
        await c.d.saveUser(c.chatId, { ref: code });
      }
      await c.d.v3.track(code, c.chatId, "view");
      return;
    }
    if (/^[a-z0-9_-]{1,24}$/.test(p) && !c.user.src) {
      c.user.src = p;
      await c.d.saveUser(c.chatId, { src: p });
    }
  } catch (e: any) {
    console.error("[telegram] start capture failed (has migration 0030 been run?)", e?.message ?? e); // never block the menu
  }
}

// ───────────────────────── saved meters and phones ─────────────────────────

const when = (iso: string | Date) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Africa/Lagos" });

/** 8am Nigeria time, `days` days from now (a reminder at 3am is not a reminder). */
export function dueAt(days: number, now = Date.now()): Date {
  const lagos = new Date(now + 3600_000);
  return new Date(Date.UTC(lagos.getUTCFullYear(), lagos.getUTCMonth(), lagos.getUTCDate() + Math.max(1, Math.floor(days)), 7, 0, 0));
}

const describe = (s: SavedItem) => `${CAT_ICON[s.cat] ?? "•"} ${esc(s.title ?? "")}${s.title ? " · " : ""}${esc(maskIdentifier(s.identifier))}${s.name ? ` (${esc(s.name)})` : ""}`;
const everyWord = (d: number) => (d === 7 ? "week" : d === 14 ? "2 weeks" : d === 30 ? "month" : d === 60 ? "2 months" : `${d} days`);

export async function savedList(c: Ctx) {
  const list = await c.d.v3.saved.list(c.chatId);
  await save(c, "idle", {});
  if (!list.length) {
    return reply(c, "⭐ <b>Saved</b>\nNothing saved yet. After an order is delivered, tap <b>💾 Save</b> under it, and next time it's one tap. You can also ask me to remind you when it's time to top up.", [[{ text: "🛒 Buy something", data: "buy" }]]);
  }
  const kb: Keyboard = list.map((s) => [{ text: `${CAT_ICON[s.cat] ?? "•"} ${s.label} · ${maskIdentifier(s.identifier)}`.slice(0, 60), data: `sv:v:${s.id}` }]);
  kb.push([{ text: "⬅ Back", data: "home" }]);
  await reply(c, `⭐ <b>Saved</b>\nTap one to buy again, set a reminder, or remove it.`, kb);
}

async function view(c: Ctx, id: string, hooks: Hooks, note?: string) {
  const s = await c.d.v3.saved.get(c.chatId, id);
  if (!s) return hooks.stale(c);
  const rem = (await c.d.v3.reminders.list(c.chatId)).find((r) => r.saved_id === s.id);
  const lines = [`⭐ <b>${esc(s.label)}</b>`, describe(s)];
  if (note) lines.push("", note);
  lines.push("", rem ? `⏰ Reminder: ${rem.repeat_days ? `every ${everyWord(rem.repeat_days)}, next on ${when(rem.due_at)}` : `on ${when(rem.due_at)}`}` : "⏰ No reminder set");
  const kb: Keyboard = [
    [{ text: "🔁 Buy now", data: `sv:b:${s.id}` }],
    [{ text: rem ? "⏰ Change reminder" : "⏰ Remind me", data: `sv:r:${s.id}` }, { text: "🗑 Remove", data: `sv:d:${s.id}` }],
    [{ text: "⬅ Saved", data: "sv:list" }],
  ];
  await save(c, "idle", {});
  await reply(c, lines.join("\n"), kb);
}

async function reminderOptions(c: Ctx, s: SavedItem, intro: string) {
  const id = s.id;
  const kb: Keyboard = [
    [{ text: "In 14 days", data: `rm:${id}:14:0` }, { text: "In 25 days", data: `rm:${id}:25:0` }, { text: "In 30 days", data: `rm:${id}:30:0` }],
    [{ text: "Every 2 weeks", data: `rm:${id}:14:1` }, { text: "Every month", data: `rm:${id}:30:1` }],
    [{ text: "✏️ I'll type the days", data: `rm:t:${id}` }],
    [{ text: "No reminder", data: `sv:v:${id}` }],
  ];
  await reply(c, `${intro}\n\n⏰ <b>Remind you to top up ${esc(s.label)}?</b>\nI'll message you at 8am with a Buy button.`, kb);
}

/** The Save button under a delivered order: asks what to call it. */
async function offerSave(c: Ctx, orderId: string, hooks: Hooks) {
  const src = await c.d.v3.saved.fromOrder(c.chatId, orderId);
  if (!src) return say(c, "I can't find that order. Tap 🧾 My orders to see yours.", [[{ text: "🧾 My orders", data: "ord" }]]);
  const cat = hooks.catOf({ biller_name: src.biller_name, name: src.biller_name, biller_code: src.bc });
  if (!cat || cat === "ex") return say(c, "Exam PINs can't be saved, but meters, smartcards and phone numbers can.");
  const list = await c.d.v3.saved.list(c.chatId);
  const dup = list.find((s) => s.bc === src.bc && s.ic === src.ic && s.identifier === src.identifier);
  if (dup) return view(c, dup.id, hooks, "Already saved ✅");
  if (list.length >= MAX_SAVED) {
    return say(c, `You already have ${MAX_SAVED} saved. Remove one to make room.`, [[{ text: "⭐ Open Saved", data: "sv:list" }]]);
  }
  const sug = [...(src.name ? [cleanText(src.name, LABEL_MAX)] : []), ...SUGGEST[cat]].filter(Boolean).slice(0, 4);
  await save(c, "sv_label", { sv: { bc: src.bc, ic: src.ic, id: src.identifier, nm: src.name, cat, title: src.biller_name, sug } });
  const kb: Keyboard = sug.map((s, i) => [{ text: s, data: `sv:l:${i}` }]);
  kb.push([{ text: "Skip, use a default", data: "sv:l:skip" }], CANCEL);
  await say(c, `💾 <b>Save ${esc(maskIdentifier(src.identifier))}?</b>\nWhat should I call it? Tap one or type a name (up to ${LABEL_MAX} characters).`, kb);
}

async function finishSave(c: Ctx, label: string, hooks: Hooks) {
  const sv = c.user.draft.sv;
  if (!sv) return hooks.stale(c);
  const fallback = `${{ el: "Light", tv: "TV", ai: "Airtime", da: "Data" }[String(sv.cat)] ?? "Saved"} ${maskIdentifier(String(sv.id)).slice(-6)}`;
  const r = await c.d.v3.saved.add(c.chatId, { label: cleanText(label, LABEL_MAX) || fallback, cat: String(sv.cat), title: sv.title ?? null, bc: String(sv.bc), ic: String(sv.ic), identifier: String(sv.id), name: sv.nm ?? null });
  if (!r.ok) { await save(c, "idle", {}); return say(c, r.error, [[{ text: "⭐ Open Saved", data: "sv:list" }]]); }
  await save(c, "idle", {});
  await reminderOptions(c, r.item, `⭐ Saved as <b>${esc(r.item.label)}</b>.`);
}

async function onLabel(c: Ctx, text: string, hooks: Hooks) {
  const label = cleanText(text, LABEL_MAX);
  if (!label) return say(c, "Type a short name, or tap Skip.", [[{ text: "Skip, use a default", data: "sv:l:skip" }], CANCEL]);
  return finishSave(c, label, hooks);
}

async function onDays(c: Ctx, text: string, hooks: Hooks) {
  const id = c.user.draft.sv?.id;
  const n = Number(String(text).replace(/\D/g, ""));
  if (!id) return hooks.stale(c);
  if (!Number.isInteger(n) || n < 1 || n > 365) return say(c, "Type a number of days between 1 and 365, for example <code>25</code>.", [CANCEL]);
  return setReminder(c, String(id), n, false, hooks);
}

async function setReminder(c: Ctx, id: string, days: number, repeat: boolean, hooks: Hooks) {
  const s = await c.d.v3.saved.get(c.chatId, id);
  if (!s) return hooks.stale(c);
  if (!Number.isInteger(days) || days < 1 || days > 365) return hooks.stale(c);
  const at = dueAt(days);
  await c.d.v3.reminders.set(c.chatId, s.id, at, repeat ? days : null);
  return view(c, s.id, hooks, `✅ I'll remind you ${repeat ? `every ${everyWord(days)}, starting` : ""} on ${when(at)} at 8am.`);
}

/** Buttons: sv:* (saved), rm:* (reminders), lg:* (language), sp:* (talk to us). Returns false if it isn't one of ours. */
export async function onButton(c: Ctx, data: string, hooks: Hooks): Promise<boolean> {
  if (data.startsWith("bl:")) return billslink.onButton(c, data, hooks);
  const [p] = data.split(":");
  if (p === "sv") {
    const [, a, b] = data.split(":");
    if (a === "list") { await savedList(c); return true; }
    if (a === "o" && b) { await offerSave(c, b, hooks); return true; }
    if (a === "v" && b) { await view(c, b, hooks); return true; }
    if (a === "b" && b) {
      const s = await c.d.v3.saved.get(c.chatId, b);
      if (!s) { await hooks.stale(c); return true; }
      await hooks.rebuy(c, { bc: s.bc, ic: s.ic, id: s.identifier, nm: s.name });
      return true;
    }
    if (a === "r" && b) {
      const s = await c.d.v3.saved.get(c.chatId, b);
      if (!s) { await hooks.stale(c); return true; }
      await reminderOptions(c, s, `⭐ <b>${esc(s.label)}</b>`);
      return true;
    }
    if (a === "d" && b) {
      const s = await c.d.v3.saved.get(c.chatId, b);
      if (!s) { await hooks.stale(c); return true; }
      await reply(c, `Remove <b>${esc(s.label)}</b> from Saved? Its reminder goes too.`, [[{ text: "🗑 Yes, remove", data: `sv:y:${s.id}` }, { text: "Keep it", data: `sv:v:${s.id}` }]]);
      return true;
    }
    if (a === "y" && b) {
      await c.d.v3.saved.remove(c.chatId, b);
      await reply(c, "Removed.", [[{ text: "⭐ Saved", data: "sv:list" }, { text: "🏠 Menu", data: "home" }]]);
      return true;
    }
    if (a === "l" && c.user.state === "sv_label") {
      if (b === "skip") { await finishSave(c, "", hooks); return true; }
      const label = c.user.draft.sv?.sug?.[Number(b)];
      if (typeof label !== "string") { await hooks.stale(c); return true; }
      await finishSave(c, label, hooks);
      return true;
    }
    await hooks.stale(c);
    return true;
  }
  if (p === "rm") {
    const [, a, b, d] = data.split(":");
    if (a === "t" && b) {
      const s = await c.d.v3.saved.get(c.chatId, b);
      if (!s) { await hooks.stale(c); return true; }
      await save(c, "rm_days", { sv: { id: s.id } });
      await reply(c, `In how many days should I remind you about <b>${esc(s.label)}</b>? Type a number, for example <code>25</code>.`, [CANCEL]);
      return true;
    }
    if (a === "x" && b) {
      await c.d.v3.reminders.clear(c.chatId, b);
      await view(c, b, hooks, "Reminder turned off.");
      return true;
    }
    if (a && Number(b) > 0) { await setReminder(c, a, Number(b), d === "1", hooks); return true; }
    await hooks.stale(c);
    return true;
  }
  if (p === "lg") {
    const code = data.split(":")[1];
    if (code === "menu") { await languageMenu(c); return true; }
    if (!isLang(code)) { await hooks.stale(c); return true; }
    c.user.lang = code;
    await c.d.saveUser(c.chatId, { lang: code });
    await say(c, T(code).langSet);
    await hooks.menu(c);
    return true;
  }
  if (p === "sp") { await supportStart(c); return true; }
  if (p === "bc") {
    const [, a, b] = data.split(":");
    if (!isAdmin(c) || !b) { await hooks.stale(c); return true; }
    if (a === "go") {
      const r = await c.d.v3.broadcast.start(c.chatId, b);
      await reply(c, r.ok ? `📣 Sending now to ${r.audience ?? "everyone"}. The rest goes out in the background. I'll tell you when it's done.` : `Couldn't start: ${esc(r.error ?? "unknown")}`);
      return true;
    }
    await c.d.v3.broadcast.cancel(c.chatId, b);
    await reply(c, "Cancelled. Nothing was sent.");
    return true;
  }
  return false;
}

/** Typed text in one of our states. Returns false if the state isn't ours. */
export async function onText(c: Ctx, text: string, hooks: Hooks): Promise<boolean> {
  if (c.user.state === "sv_label") { await onLabel(c, text, hooks); return true; }
  if (c.user.state === "rm_days") { await onDays(c, text, hooks); return true; }
  if (c.user.state === "sp_msg") { await onSupportText(c, text); return true; }
  if (c.user.state.startsWith("bl_")) return billslink.onText(c, text);
  return false;
}

// ───────────────────────── language ─────────────────────────

export async function languageMenu(c: Ctx) {
  const kb: Keyboard = [LANGS.slice(0, 3).map((l) => ({ text: l.label, data: `lg:${l.code}` })), LANGS.slice(3).map((l) => ({ text: l.label, data: `lg:${l.code}` })), [{ text: "⬅ Back", data: "home" }]];
  await reply(c, "🌍 <b>Language</b>\nChoose the language for the greeting, menu and delivery messages. Payment details always stay in English so nothing is misread.", kb);
}

// ───────────────────────── announcements opt-out ─────────────────────────

export async function stopAnnouncements(c: Ctx, on: boolean) {
  c.user.optout = !on;
  await c.d.saveUser(c.chatId, { optout: !on });
  await say(c, on
    ? "Announcements are back on. Send /stop any time to turn them off."
    : "Done. I won't send you announcements any more. Your order messages and any reminders you set still arrive. Send /subscribe to turn announcements back on.");
}

// ───────────────────────── talk to us ─────────────────────────

export async function supportStart(c: Ctx) {
  if (!c.d.v3.admins.length) {
    const kb: Keyboard = [];
    if (c.d.supportWhatsapp) kb.push([{ text: "💬 WhatsApp a person", url: `https://wa.me/${c.d.supportWhatsapp}` }]);
    kb.push([{ text: "⬅ Back", data: "help" }]);
    return reply(c, `You can reach a person by email at ${esc(c.d.supportEmail)}.`, kb);
  }
  await save(c, "sp_msg", {});
  await reply(c, "💬 <b>Talk to us</b>\nType your message and I'll pass it to a person. If it's about an order, include the ref (like NLG-AB12CD). Replies come back here.", [CANCEL]);
}

async function onSupportText(c: Ctx, text: string) {
  const r = await c.d.v3.support.forward({ chatId: c.chatId, name: c.user.first_name ?? "", username: c.user.username ?? null, email: c.user.email ?? null, text });
  await save(c, "idle", {});
  if (!r.ok) return say(c, esc(r.error ?? "I couldn't send that just now."), [[{ text: "💬 Try again", data: "sp:go" }]]);
  await say(c, "✅ Sent. A person will reply here, usually within a few hours.", [[{ text: "🏠 Menu", data: "home" }]]);
}

// ───────────────────────── the owner ─────────────────────────

export const isAdmin = (c: Ctx) => c.d.v3.admins.includes(c.chatId);

const ADMIN_HELP = [
  "<b>Owner commands</b>",
  "/stats: today and the last 7 days, reps, bot customers",
  "/failed: orders that need a look",
  "/broadcast your message: announce to everyone (you confirm first)",
  "/reply chat_id message: answer a customer. Or just reply to their forwarded message.",
].join("\n");

export const BROADCAST_FOOTER = "\n\n<i>Send /stop to stop announcements.</i>";
export const BROADCAST_MAX = 1500;

/** Owner-only commands. Returns false when it isn't one (or the sender isn't the owner), so the normal bot answers. */
export async function adminCommand(c: Ctx, cmd: string, arg: string): Promise<boolean> {
  if (!isAdmin(c)) return false;
  if (cmd === "/admin") { await say(c, ADMIN_HELP); return true; }
  if (cmd === "/stats") { await c.d.typing(c.chatId); await say(c, fmtStats(await c.d.v3.admin.stats())); return true; }
  if (cmd === "/failed") { await c.d.typing(c.chatId); await say(c, fmtFailures(await c.d.v3.admin.failures())); return true; }
  if (cmd === "/broadcast") {
    const body = arg.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, " ").trim().slice(0, BROADCAST_MAX);
    if (!body) { await say(c, "Type it after the command, for example:\n<code>/broadcast Light bills are now 1 tap away. Try /buy</code>"); return true; }
    const d = await c.d.v3.broadcast.draft(c.chatId, body);
    await say(c, `📣 <b>Preview</b>\n\n${esc(body)}${BROADCAST_FOOTER}\n\nThis goes to <b>${d.audience}</b> people.`, [[{ text: `✅ Send to ${d.audience}`, data: `bc:go:${d.id}` }, { text: "✖ Cancel", data: `bc:no:${d.id}` }]]);
    return true;
  }
  if (cmd === "/reply") {
    const m = /^(\d{1,15})\s+([\s\S]+)$/.exec(arg.trim());
    if (!m) { await say(c, "Use: <code>/reply chat_id your message</code>, or reply to the forwarded message."); return true; }
    await sendSupportReply(c, Number(m[1]), m[2]);
    return true;
  }
  return false;
}

async function sendSupportReply(c: Ctx, customer: number, text: string) {
  const body = cleanText(text, 1500);
  if (!body) return;
  try {
    await c.d.send(customer, `💬 <b>Nolgic support</b>\n${esc(body)}`, [[{ text: "💬 Reply", data: "sp:go" }]]);
    await say(c, "✅ Sent to the customer.");
  } catch (e: any) {
    await say(c, `Couldn't deliver that: ${esc(String(e?.message ?? e).slice(0, 120))}`);
  }
}

/** The owner replied to a forwarded customer message: send their answer to that customer. */
export async function adminReply(c: Ctx, replyTo: number, text: string): Promise<boolean> {
  if (!isAdmin(c)) return false;
  const customer = await c.d.v3.support.lookup(c.chatId, replyTo);
  if (!customer) return false;
  await sendSupportReply(c, customer, text);
  return true;
}
