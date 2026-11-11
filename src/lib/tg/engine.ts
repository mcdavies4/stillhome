// src/lib/tg/engine.ts
// The Telegram bot's conversation. One customer = one chat; where they are in a purchase is kept on their
// tg_users row (state + draft), so any server instance can carry on the conversation.
//
// The bot never touches money itself. It collects what to buy, checks the meter / smartcard, quotes the
// total and creates an ordinary Nolgic order, then hands the customer a Paystack link. Payment confirmation,
// delivery and refunds are the same server-verified pipeline the website uses; when that finishes it calls
// tgNotifyOrder (lib/tg/notify.ts) and the result arrives in the chat.
//
// Everything outside (Telegram, the database, the bills provider, order creation) comes in through `Deps`,
// so the whole conversation can be tested without a network.

import { PFM_TABS, pfmTitle, maskIdentifier, pfmItemFee, type PfmBiller } from "@/lib/payforme-shared";
import { examService } from "@/lib/exams-shared";
import { OCCASIONS, cleanText, NOTE_MAX } from "@/lib/gift";
import { localPhone, guessNetwork } from "@/lib/bulk-shared";
import { ngnMaxOrder } from "@/lib/ngn-fee";
import { getCountry } from "@/lib/countries";
import { normaliseEmail } from "@/lib/security";
import { statusWord } from "@/lib/find-order";
import { esc, type Keyboard } from "./api";
import { naira, rows, CANCEL, reply, say, save, parseAmount, safeMessage, catRows, askEmailFor, type Ctx } from "./kit";
import * as bulk from "./bulk";
import * as social from "./social";
import * as v3 from "./v3";
import { T } from "./i18n";

export type Cat = "el" | "tv" | "ai" | "da" | "ex";
export type Item = PfmBiller;

export interface Draft {
  cat?: Cat;
  bc?: string;                        // biller_code (disco / network / cable company)
  ic?: string;                        // item_code (prepaid / plan code / "airtime")
  id?: string;                        // meter / smartcard / phone number
  nm?: string | null;                 // name the provider returned for that number
  min?: number;                       // provider's minimum for this meter
  amt?: number;                       // bill amount in naira
  menu?: Record<string, any>[];       // what the buttons currently on screen stand for
  pg?: number;
  after?: "confirm" | "list" | "bk";  // where to go once the email is saved
  order?: { id: string; url: string; total: number };
  mode?: "gift" | "ask" | "give";     // what this buy flow is for (absent = a normal purchase)
  gift?: { note: string; from: string };
  list?: social.ListItem[];           // things collected for "ask someone to pay" / a giveaway
  sc?: Record<string, any>;           // scratch for social.ts (names, notes, giveaway link choices)
  bk?: Record<string, any>;           // scratch for bulk.ts (the numbers, the batch being paid)
  sv?: Record<string, any>;           // scratch for v3.ts (the item being saved, the item a reminder is for)
}

export interface TgUser {
  chat_id: number;
  first_name?: string | null;
  username?: string | null;
  email?: string | null;
  ref?: string | null;                // sales rep who first brought them here
  src?: string | null;                // which Nolgic button they came from
  lang?: string | null;
  optout?: boolean | null;
  state: string;
  draft: Draft;
  order_count?: number;
}

export interface RecentOrder {
  id: string;
  status: string;
  biller_code: string;
  item_code: string;
  biller_name: string;
  identifier: string;
  customer_name: string | null;
  amount_ngn: number;
  flw_token: string | null;
  identifier_label?: string | null;
}

export type CreateResult = { ok: true; url: string; orderId: string; total: number } | { ok: false; error: string };
export type BulkRow = { phone: string; amount: number; network: string };
export type BulkResult = { ok: true; url: string; bulkId: string; total: number } | { ok: false; error: string };
export type AskResult = { ok: true; id: string; key: string; total: number; count: number } | { ok: false; error: string };
export type GiveResult = { ok: true; id: string; key: string; total: number; count: number; url: string } | { ok: false; error: string };
export type LinkResult = { ok: true; id: string; key: string } | { ok: false; error: string };
export interface Flags { bulk: boolean; ask: boolean; giveaway: boolean; exams: boolean; accounts: boolean }

export interface Deps {
  send(chatId: number, html: string, kb?: Keyboard): Promise<void>;
  edit(chatId: number, messageId: number, html: string, kb?: Keyboard): Promise<void>;
  answer(callbackId: string, text?: string): Promise<void>;
  typing(chatId: number): Promise<void>;
  seen(updateId: number): Promise<boolean>;
  getUser(from: { id: number; first_name?: string; username?: string }): Promise<TgUser>;
  saveUser(chatId: number, patch: { email?: string; state?: string; draft?: Draft; ref?: string; src?: string; lang?: string; optout?: boolean }): Promise<void>;
  catalogue(): Promise<Item[]>;
  validate(item: Item, identifier: string): Promise<{ name: string | null; minimum: number }>;
  createOrder(i: { chatId: number; email: string; item: Item; identifier: string; amount: number; gift?: { note: string; from: string }; rep?: string | null }): Promise<CreateResult>;
  /** Which optional parts of Nolgic are switched on (the same switches the website uses). */
  flags: Flags;
  createBulk(i: { chatId: number; email: string; rows: BulkRow[] }): Promise<BulkResult>;
  /** Asks the payment provider about this batch and, if it has finished, makes sure the chat has the outcome. */
  checkBulk(chatId: number, bulkId: string): Promise<string>;
  createAsk(i: { chatId: number; name: string; email: string | null; note: string | null; items: social.ListItem[] }): Promise<AskResult>;
  createGiveaway(i: { chatId: number; name: string; email: string; note: string | null; items: social.ListItem[] }): Promise<GiveResult>;
  createLink(i: { chatId: number; name: string; email: string; note: string | null; budget: number; categories: string[]; maxPeople: number }): Promise<LinkResult>;
  /**
   * Asks the payment provider about this order (the same safety net the order page uses) and returns its status.
   * When the order is already finished, this also makes sure the customer has been sent the outcome
   * (the delivery / refund message), resending it if they asked again.
   */
  checkOrder(chatId: number, orderId: string): Promise<string>;
  recentOrders(chatId: number): Promise<RecentOrder[]>;
  /** Saved items, reminders, rep counters, the owner's numbers, announcements and support (see v3.ts). */
  v3: v3.V3;
  appUrl: string;
  supportEmail: string;
  supportWhatsapp: string | null;
}

// ───────────────────────── small helpers ─────────────────────────

const NG = () => getCountry("NG");

const CATS: Record<Cat, { tab: string; icon: string; word: string; noun: string; example: (c: ReturnType<typeof NG>) => string }> = {
  el: { tab: "electricity", icon: "⚡", word: "light", noun: "meter number", example: (c) => c.identifierExamples.electricity },
  tv: { tab: "cable", icon: "📺", word: "TV", noun: "smartcard number", example: (c) => c.identifierExamples.tv },
  ai: { tab: "airtime", icon: "📱", word: "airtime", noun: "phone number", example: (c) => c.identifierExamples.phone },
  da: { tab: "data", icon: "🌐", word: "data", noun: "phone number", example: (c) => c.identifierExamples.phone },
  ex: { tab: "exam", icon: "🎓", word: "exam PIN", noun: "phone number", example: (c) => c.identifierExamples.phone },
};
const CAT_BY_TAB: Record<string, Cat> = { electricity: "el", cable: "tv", airtime: "ai", data: "da", exam: "ex" };

/** What the customer must type for this one (a JAMB profile code is not a phone number). */
function nounFor(cat: Cat, bc?: string): string {
  if (cat === "ex" && bc) { const l = examService(bc).idLabel; return /^[A-Z]{2,}/.test(l) ? l : l[0].toLowerCase() + l.slice(1); } // keep "JAMB" in capitals
  return CATS[cat].noun;
}
function exampleFor(cat: Cat, bc?: string): string {
  if (cat === "ex" && bc && /^jamb/i.test(bc)) return "A1B2C3D4";
  return CATS[cat].example(NG());
}
/** The things that go along with a buy flow that is not a plain purchase. */
const carry = (dr: Draft): Draft => ({ ...(dr.mode ? { mode: dr.mode } : {}), ...(dr.gift ? { gift: dr.gift } : {}), ...(dr.list ? { list: dr.list } : {}), ...(dr.sc ? { sc: dr.sc } : {}) });

export function catOf(i: Pick<Item, "biller_name" | "name"> & Partial<Item>): Cat | null {
  const x = { biller_code: "", item_code: "", short_name: "", amount: 0, is_airtime: false, label_name: "", ...i } as Item;
  const tab = PFM_TABS.find((t) => t.match(x))?.key;
  return tab ? CAT_BY_TAB[tab] ?? null : null;
}

const inCat = (all: Item[], cat: Cat) => all.filter((i) => catOf(i) === cat);

function uniqueBy<T>(list: T[], key: (x: T) => string): T[] {
  const seen = new Set<string>();
  return list.filter((x) => { const k = key(x); if (seen.has(k)) return false; seen.add(k); return true; });
}

const brandLabel = (i: Item, cat: Cat) =>
  cat === "ex" ? examService(i.biller_code).title
  : cat === "ai" ? i.biller_name.replace(/\s*Airtime(\s*VTU)?$/i, "").trim() || i.biller_name
  : cat === "da" ? i.biller_name.replace(/\s*Data$/i, "").trim() || i.biller_name
  : i.biller_name;

export const planLabel = (i: Item) => `${String(i.name).replace(/\s+/g, " ").slice(0, 34)} · ${naira(i.amount)}`;

// Light protection against a chat that floods the bot (per instance; the order limits below are the real guard).
const hits = new Map<number, number[]>();
function throttled(chatId: number, now = Date.now()): boolean {
  const list = (hits.get(chatId) ?? []).filter((t) => now - t < 60_000);
  list.push(now);
  hits.set(chatId, list);
  if (hits.size > 2000) hits.clear();
  return list.length > 25;
}
export const _resetThrottle = () => hits.clear();

// ───────────────────────── entry point ─────────────────────────

export async function handleUpdate(d: Deps, upd: any): Promise<void> {
  const msg = upd?.message, cb = upd?.callback_query;
  const chat = msg?.chat ?? cb?.message?.chat;
  const from = msg?.from ?? cb?.from;
  if (!chat || !from || chat.type !== "private" || from.is_bot) {
    if (cb?.id) await d.answer(cb.id);
    return;
  }
  if (typeof upd.update_id === "number" && (await d.seen(upd.update_id))) return;
  const chatId = Number(chat.id);
  if (throttled(chatId)) {
    if (cb?.id) await d.answer(cb.id, "One moment, you're going a bit fast 🙂");
    return;
  }
  const user = await d.getUser({ id: chatId, first_name: from.first_name, username: from.username });
  const c: Ctx = { d, chatId, user, cbId: cb?.id, msgId: cb?.message?.message_id };
  try {
    if (cb) {
      await d.answer(cb.id);
      await onButton(c, String(cb.data ?? "").slice(0, 64));
    } else if (typeof msg?.text === "string") {
      const text = msg.text.trim().slice(0, 4000);
      // The owner replying to a forwarded customer message: the answer goes to that customer.
      const replyTo = Number(msg.reply_to_message?.message_id);
      if (replyTo && !text.startsWith("/") && (await v3.adminReply(c, replyTo, text))) return;
      await onText(c, text);
    } else {
      await say(c, "I understand text and buttons only. Tap /start to open the menu.");
    }
  } catch (e: any) {
    console.error("[telegram] handler failed", chatId, e?.message ?? e);
    c.msgId = undefined;
    await say(c, "Something went wrong on our side. Nothing has been charged. Tap /start to try again.").catch(() => undefined);
  }
}

// ───────────────────────── commands & buttons ─────────────────────────

async function onText(c: Ctx, text: string) {
  // Only a pasted list of numbers (bulk) or the owner's announcement may be long.
  if (!c.user.state.startsWith("bk_") && !/^\/broadcast\b/i.test(text)) text = text.slice(0, 300);
  if (text.startsWith("/")) {
    const cmd = text.split(/[\s@]/)[0].toLowerCase();
    const arg = text.replace(/^\S+\s*/, "");
    if (cmd === "/start") { await v3.captureStart(c, arg.split(/\s/)[0]); return menu(c, true); }
    if (cmd === "/menu") return menu(c, true);
    if (cmd === "/buy") return categories(c);
    if (cmd === "/orders") return orders(c);
    if (cmd === "/saved") return v3.savedList(c);
    if (cmd === "/language") return v3.languageMenu(c);
    if (cmd === "/stop") return v3.stopAnnouncements(c, false);
    if (cmd === "/subscribe") return v3.stopAnnouncements(c, true);
    if (cmd === "/support") return v3.supportStart(c);
    if (cmd === "/help") return help(c);
    if (cmd === "/cancel") return cancel(c);
    if (cmd === "/email") return askEmail(c, undefined);
    if (await v3.adminCommand(c, cmd, arg)) return;
    return help(c);
  }
  switch (c.user.state) {
    case "ask_id": return onIdentifier(c, text);
    case "ask_amount": return onAmount(c, text);
    case "ask_email": return onEmail(c, text);
    case "gf_note": return onGiftNote(c, text);
    default:
      if (await v3.onText(c, text, hooks)) return;
      if (c.user.state.startsWith("bk_")) return bulk.onText(c, text);
      if (c.user.state.startsWith("sc_")) return social.onText(c, text);
      return menu(c, false);
  }
}

async function onButton(c: Ctx, data: string) {
  if (data === "home") return menu(c, false);
  if (data === "buy") return categories(c);
  if (data === "x") return cancel(c);
  if (data === "ord") return orders(c);
  if (data === "help") return help(c);
  if (data === "go") return pay(c);
  if (data === "chk") return check(c, c.user.draft.order?.id);
  if (data.startsWith("chk:")) return check(c, data.slice(4));
  if (data === "em") return askEmail(c, "confirm");
  if (data.startsWith("c:")) return startCategory(c, data.slice(2) as Cat);
  if (data.startsWith("m:")) return pickMenu(c, Number(data.slice(2)));
  if (data.startsWith("pg:")) return showPlans(c, Number(data.slice(3)));
  if (data.startsWith("a:")) return onAmountValue(c, Number(data.slice(2)));
  if (data.startsWith("ag:")) return buyAgain(c, Number(data.slice(3)));
  if (data.startsWith("bk:")) return bulk.onButton(c, data);
  if (data.startsWith("sc:")) return social.onButton(c, data);
  if (data.startsWith("gf:")) return gift(c, data);
  if (await v3.onButton(c, data, hooks)) return;
  return stale(c);
}

const hooks: v3.Hooks = {
  menu: (c) => menu(c, false),
  rebuy: (c, ref) => rebuy(c, ref),
  catOf: (i) => catOf(i as any),
  stale: (c) => stale(c),
};

/** Counts a meter check / pay tap towards the rep who brought this customer (never blocks the conversation). */
function trackRep(c: Ctx, what: "lookup_ok" | "checkout_click") {
  if (c.user.ref) c.d.v3.track(c.user.ref, c.chatId, what).catch(() => undefined);
}

const stale = (c: Ctx) => reply(c, "That button has expired. Tap /buy to start again.", [[{ text: "🛒 Buy something", data: "buy" }]]);

async function menu(c: Ctx, greet: boolean) {
  await save(c, "idle", {});
  const name = c.user.first_name ? ` ${esc(c.user.first_name)}` : "";
  const t = T(c.user.lang);
  await say(c, greet ? t.welcome(name) : t.menu, mainMenu(c));
}

function mainMenu(c: Ctx): Keyboard {
  const f = c.d.flags;
  const t = T(c.user.lang);
  const kb: Keyboard = [
    [{ text: t.light, data: "c:el" }, { text: t.tv, data: "c:tv" }],
    [{ text: t.airtime, data: "c:ai" }, { text: t.data, data: "c:da" }],
    [f.exams ? { text: t.exam, data: "c:ex" } : { text: t.exam, url: `${c.d.appUrl}/exams` }],
  ];
  if (f.bulk) kb[2].push({ text: t.bulk, data: "bk:go" });
  const extra: Keyboard[number] = [{ text: t.gift, data: "gf:go" }];
  if (f.ask) extra.push({ text: t.ask, data: "sc:ask" });
  kb.push(extra);
  if (f.giveaway) kb.push([{ text: t.giveaway, data: "sc:gv" }]);
  kb.push([{ text: t.orders, data: "ord" }, { text: t.saved, data: "sv:list" }]);
  const tail: Keyboard[number] = [];
  if (f.accounts) tail.push({ text: t.account, url: `${c.d.appUrl}/account` });
  tail.push({ text: t.help, data: "help" });
  kb.push(tail);
  return kb;
}

async function categories(c: Ctx) {
  await save(c, "idle", {});
  await reply(c, "What do you want to pay for?", mainMenu(c));
}

/** Gift: the same buy flow, with a short message for the person, and a forwardable note once it is delivered. */
async function gift(c: Ctx, data: string) {
  if (data === "gf:go") {
    await save(c, "pick_cat", { mode: "gift" });
    return reply(c, "🎁 <b>Send a gift</b>\nI'll pay for someone else's light, TV, airtime or data, and give you a note to send them. What would you like to give?", [...catRows(c.d.flags), CANCEL]);
  }
  if (data === "gf:skip" && c.user.state === "gf_note") return toConfirm(c, { ...c.user.draft, gift: { note: "", from: giftFrom(c) } });
  const m = /^gf:o:(\d+)$/.exec(data);
  if (m && c.user.state === "gf_note") {
    const o = OCCASIONS[Number(m[1])];
    if (!o) return stale(c);
    return toConfirm(c, { ...c.user.draft, gift: { note: o.note, from: giftFrom(c) } });
  }
  return stale(c);
}
const giftFrom = (c: Ctx) => cleanText(c.user.first_name ?? "", 30);

async function askGiftNote(c: Ctx, draft: Draft) {
  await save(c, "gf_note", draft);
  const kb: Keyboard = OCCASIONS.map((o, i) => [{ text: `${o.label}: ${o.note}`.slice(0, 40), data: `gf:o:${i}` }]);
  kb.push([{ text: "Skip the message", data: "gf:skip" }], CANCEL);
  await reply(c, "Add a short message for them? Tap one, or type your own (up to 140 characters).", kb);
}

async function onGiftNote(c: Ctx, text: string) {
  const note = cleanText(text, NOTE_MAX);
  if (!note) return say(c, "Type your message, or tap Skip.", [[{ text: "Skip the message", data: "gf:skip" }], CANCEL]);
  return toConfirm(c, { ...c.user.draft, gift: { note, from: giftFrom(c) } });
}

async function cancel(c: Ctx) {
  await save(c, "idle", {});
  await reply(c, "Cancelled. Nothing was charged.", [[{ text: "🛒 Buy something", data: "buy" }]]);
}

async function help(c: Ctx) {
  const lines = [
    "<b>How it works</b>",
    "1. Pick what you want and send the meter, smartcard or phone number.",
    "2. I check the name, then give you a secure payment link (card, bank transfer or USSD).",
    "3. Once the payment is confirmed, your token or top-up arrives here.",
    "",
    "If a delivery fails you are refunded in full, automatically.",
    `See our live delivery numbers: ${esc(c.d.appUrl.replace(/^https?:\/\//, ""))}/proof`,
    "",
    `Need a person? Email ${esc(c.d.supportEmail)}`,
  ];
  const kb: Keyboard = [];
  if (c.d.supportWhatsapp) kb.push([{ text: "💬 WhatsApp a person", url: `https://wa.me/${c.d.supportWhatsapp}` }]);
  if (c.d.v3.admins.length) kb.push([{ text: "💬 Talk to us", data: "sp:go" }]);
  kb.push([{ text: "🌍 Language", data: "lg:menu" }, { text: "⭐ Saved", data: "sv:list" }]);
  kb.push([{ text: "🛒 Buy something", data: "buy" }, { text: "🧾 My orders", data: "ord" }]);
  await reply(c, lines.join("\n"), kb);
}

// ───────────────────────── choosing what to buy ─────────────────────────

async function loadCatalogue(c: Ctx): Promise<Item[] | null> {
  try {
    const all = await c.d.catalogue();
    if (all.length) return all;
  } catch (e: any) {
    console.error("[telegram] catalogue failed", e?.message ?? e);
  }
  await reply(c, "I can't load the list just now. Please try again in a minute. Nothing was charged.", [[{ text: "🔄 Try again", data: "buy" }]]);
  return null;
}

async function startCategory(c: Ctx, cat: Cat) {
  if (!CATS[cat]) return stale(c);
  const all = await loadCatalogue(c);
  if (!all) return;
  const items = inCat(all, cat);
  const brands = uniqueBy(items, (i) => i.biller_code);
  if (!brands.length) {
    return reply(c, `${CATS[cat].icon} ${CATS[cat].word[0].toUpperCase()}${CATS[cat].word.slice(1)} isn't available right now. Please check back soon.`, [[{ text: "⬅ Back", data: "home" }]]);
  }
  const menuRefs = brands.map((b) => ({ bc: b.biller_code }));
  await save(c, "pick_brand", { ...carry(c.user.draft), cat, menu: menuRefs });
  const ask = cat === "el" ? "Which electricity company?" : cat === "tv" ? "Which TV provider?" : cat === "ex" ? "Which exam?" : "Which network?";
  const kb = rows(brands.map((b, i) => ({ text: brandLabel(b, cat), data: `m:${i}` })));
  kb.push([{ text: "⬅ Back", data: "home" }]);
  await reply(c, `${CATS[cat].icon} ${ask}`, kb);
}

async function pickMenu(c: Ctx, idx: number) {
  const st = c.user.state, dr = c.user.draft;
  const ref = dr.menu?.[idx];
  if (!ref || !dr.cat) return stale(c);
  const all = await loadCatalogue(c);
  if (!all) return;
  const items = inCat(all, dr.cat);

  if (st === "pick_brand") {
    const mine = uniqueBy(items.filter((i) => i.biller_code === ref.bc), (i) => i.item_code);
    if (!mine.length) return stale(c);
    if (dr.cat === "el" && mine.length > 1) {
      await save(c, "pick_type", { ...carry(dr), cat: dr.cat, bc: ref.bc, menu: mine.map((i) => ({ ic: i.item_code })) });
      const kb = rows(mine.map((i, k) => ({ text: /post/i.test(i.item_code) ? "Postpaid" : "Prepaid", data: `m:${k}` })));
      kb.push([{ text: "⬅ Back", data: "buy" }]);
      return reply(c, "Prepaid or postpaid meter?", kb);
    }
    // electricity (single type) and airtime use the one item; TV and data pick a plan after the number is checked.
    const ic = dr.cat === "el" || dr.cat === "ai" ? mine[0].item_code : undefined;
    return askId(c, { ...carry(dr), cat: dr.cat, bc: ref.bc, ic });
  }
  if (st === "pick_type") {
    const ok = items.some((i) => i.biller_code === dr.bc && i.item_code === ref.ic);
    if (!ok) return stale(c);
    return askId(c, { ...carry(dr), cat: dr.cat, bc: dr.bc, ic: ref.ic });
  }
  if (st === "pick_plan") {
    const plan = items.find((i) => i.biller_code === ref.bc && i.item_code === ref.ic);
    if (!plan || !(plan.amount > 0)) return stale(c);
    return toConfirm(c, { ...dr, bc: plan.biller_code, ic: plan.item_code, amt: Math.round(plan.amount), menu: undefined });
  }
  return stale(c);
}

async function askId(c: Ctx, draft: Draft) {
  await save(c, "ask_id", draft);
  const cat = draft.cat!;
  const eg = exampleFor(cat, draft.bc);
  const extra = cat === "ex" && /^jamb/i.test(draft.bc ?? "") ? "\nUse the profile code the candidate got when they registered. A wrong code gives a PIN that can't be used, so check it twice." : "";
  await reply(c, `${CATS[cat].icon} Send the <b>${nounFor(cat, draft.bc)}</b>, for example <code>${esc(eg)}</code>.${extra}`, [CANCEL]);
}

// ───────────────────────── the number ─────────────────────────

function cleanIdentifier(cat: Cat, raw: string, bc?: string): string | null {
  if (cat === "ai" || cat === "da") return localPhone(raw);
  if (cat === "ex") {
    const v = raw.replace(/\s+/g, "");
    return bc && examService(bc).idPattern.test(v) ? v : null;
  }
  const digits = raw.replace(/[\s-]/g, "");
  if (cat === "tv") return /^\d{8,14}$/.test(digits) ? digits : null;
  return /^\d{6,20}$/.test(digits) ? digits : null;
}

async function onIdentifier(c: Ctx, text: string) {
  const dr = c.user.draft;
  if (!dr.cat || !dr.bc) return menu(c, false);
  const id = cleanIdentifier(dr.cat, text, dr.bc);
  if (!id) {
    const eg = exampleFor(dr.cat, dr.bc);
    return say(c, `That doesn't look like a valid ${nounFor(dr.cat, dr.bc)}. Check it and send it again, for example <code>${esc(eg)}</code>.`, [CANCEL]);
  }
  const next: Draft = { ...dr, id, nm: null };

  if (dr.cat === "ai") { trackRep(c, "lookup_ok"); return askAmount(c, next); }
  if (dr.cat === "da" || dr.cat === "ex") { trackRep(c, "lookup_ok"); return showPlans(c, 0, next); } // no name lookup for these

  const all = await loadCatalogue(c);
  if (!all) return;
  const mine = inCat(all, dr.cat).filter((i) => i.biller_code === dr.bc && (dr.cat === "tv" || i.item_code === dr.ic));
  if (!mine.length) return stale(c);
  await c.d.typing(c.chatId);
  try {
    const v = await c.d.validate(mine[0], id);
    next.nm = v.name;
    next.min = v.minimum || 0;
    trackRep(c, "lookup_ok");
  } catch (e: any) {
    return say(c, `${esc(safeMessage(e))}\n\nSend the ${nounFor(dr.cat, dr.bc)} again, or cancel.`, [CANCEL]);
  }
  if (dr.cat === "tv") return showPlans(c, 0, next);
  return askAmount(c, next);
}

// ───────────────────────── plan list (TV, data) ─────────────────────────

const PAGE = 8;

async function showPlans(c: Ctx, page: number, draft?: Draft) {
  const dr = draft ?? c.user.draft;
  if (!dr.cat || !dr.bc || (c.user.state !== "pick_plan" && !draft)) return stale(c);
  const all = await loadCatalogue(c);
  if (!all) return;
  const plans = uniqueBy(inCat(all, dr.cat).filter((i) => i.biller_code === dr.bc && i.amount > 0), (i) => i.item_code).sort((a, b) => a.amount - b.amount);
  if (!plans.length) return reply(c, "No plans are available for this one right now. Please try another.", [[{ text: "⬅ Back", data: "buy" }]]);
  const pages = Math.ceil(plans.length / PAGE);
  const pg = Math.min(Math.max(0, page | 0), pages - 1);
  const slice = plans.slice(pg * PAGE, pg * PAGE + PAGE);
  await save(c, "pick_plan", { ...dr, pg, menu: slice.map((p) => ({ bc: p.biller_code, ic: p.item_code })) });
  const kb: Keyboard = slice.map((p, i) => [{ text: planLabel(p), data: `m:${i}` }]);
  const nav: Keyboard[number] = [];
  if (pg > 0) nav.push({ text: "◀ Cheaper", data: `pg:${pg - 1}` });
  if (pg < pages - 1) nav.push({ text: "More ▶", data: `pg:${pg + 1}` });
  if (nav.length) kb.push(nav);
  kb.push(CANCEL);
  const who = dr.nm ? `<b>${esc(dr.nm)}</b> · ${esc(dr.id)}` : esc(dr.id);
  await reply(c, `${CATS[dr.cat].icon} ${who}\nChoose a ${dr.cat === "tv" ? "package" : dr.cat === "ex" ? "PIN" : "bundle"}:${pages > 1 ? ` (page ${pg + 1} of ${pages})` : ""}`, kb);
}

// ───────────────────────── the amount ─────────────────────────

function limits(draft: Draft) {
  const ng = NG();
  const min = Math.max(ng.minDomestic ?? ng.minLocal, draft.min ?? 0);
  return { min, max: ngnMaxOrder(ng.maxLocal) };
}

async function askAmount(c: Ctx, draft: Draft) {
  await save(c, "ask_amount", draft);
  const { min, max } = limits(draft);
  const quick = draft.cat === "ai" ? [100, 200, 500, 1000] : [1000, 2000, 3000, 5000];
  const kb = rows(quick.filter((n) => n >= min && n <= max).map((n) => ({ text: naira(n), data: `a:${n}` })), 4);
  kb.push(CANCEL);
  const who = draft.nm ? `<b>${esc(draft.nm)}</b> · ${esc(draft.id)}\n` : draft.id ? `${esc(draft.id)}\n` : "";
  await reply(c, `${who}How much? Tap an amount or type it (${naira(min)} to ${naira(max)}).`, kb);
}

async function onAmount(c: Ctx, text: string) {
  const n = parseAmount(text);
  if (n === null) return say(c, "Type the amount in naira, for example <code>2000</code> or <code>2k</code>.", [CANCEL]);
  return onAmountValue(c, n);
}

async function onAmountValue(c: Ctx, n: number) {
  if (c.user.state !== "ask_amount") return stale(c);
  const { min, max } = limits(c.user.draft);
  if (!Number.isFinite(n) || n < min || n > max) {
    return say(c, `The amount must be between ${naira(min)} and ${naira(max)}.`, [CANCEL]);
  }
  return toConfirm(c, { ...c.user.draft, amt: Math.round(n) });
}

// ───────────────────────── email, then the confirm card ─────────────────────────

async function askEmail(c: Ctx, after: "confirm" | undefined) {
  await askEmailFor(c, after ? c.user.draft : {}, after);
}

async function onEmail(c: Ctx, text: string) {
  const email = normaliseEmail(text);
  if (!email) return say(c, "That doesn't look like an email address. Type it again, for example <code>name@gmail.com</code>.", [CANCEL]);
  await c.d.saveUser(c.chatId, { email });
  c.user.email = email;
  const after = c.user.draft.after;
  if (after === "confirm") return toConfirm(c, { ...c.user.draft, after: undefined });
  if (after === "list") return social.afterEmail(c, { ...c.user.draft, after: undefined });
  if (after === "bk") return bulk.afterEmail(c, { ...c.user.draft, after: undefined });
  await save(c, "idle", {});
  await say(c, `Saved ✅ Receipts will go to <b>${esc(email)}</b>.`, [[{ text: "🛒 Buy something", data: "buy" }]]);
}

async function currentItem(c: Ctx, dr: Draft): Promise<Item | null> {
  const all = await c.d.catalogue();
  return all.find((i) => i.biller_code === dr.bc && i.item_code === dr.ic) ?? null;
}

async function toConfirm(c: Ctx, draft: Draft) {
  // "Ask someone to pay" and giveaways collect a list first: nobody pays for anything yet, so no email is needed here.
  if (draft.mode === "ask" || draft.mode === "give") {
    const it = await currentItem(c, draft).catch(() => null);
    if (!it || !draft.id || !draft.amt || !draft.cat) return stale(c);
    return social.listAdd(c, draft, it);
  }
  if (!c.user.email) {
    await save(c, "ask_email", { ...draft, after: "confirm" });
    return reply(c, "Almost there. Where should we send your receipt? Type your email address (asked only once).", [CANCEL]);
  }
  const item = await currentItem(c, draft).catch(() => null);
  if (!item || !draft.id || !draft.amt || !draft.cat) return stale(c);
  if (draft.mode === "gift" && !draft.gift) return askGiftNote(c, draft);
  const fee = pfmItemFee(item, draft.amt);
  const total = draft.amt + fee;
  await save(c, "confirm", { ...draft, menu: undefined });
  const lines = [
    `<b>Please check your ${draft.mode === "gift" ? "gift" : "order"}</b>`,
    `${CATS[draft.cat].icon} ${esc(pfmTitle(item.biller_name, item.name))}`,
    `${nounFor(draft.cat, draft.bc)[0].toUpperCase()}${nounFor(draft.cat, draft.bc).slice(1)}: <code>${esc(draft.id)}</code>`,
  ];
  if (draft.nm) lines.push(`Name: <b>${esc(draft.nm)}</b>`);
  lines.push(`Amount: ${naira(draft.amt)}`, `Service fee: ${naira(fee)}`, `<b>Total: ${naira(total)}</b>`, `Receipt to: ${esc(c.user.email)}`);
  if (draft.gift?.note) lines.push(`🎁 Your message: <i>${esc(draft.gift.note)}</i>`);
  if (draft.cat === "ai") {
    const guess = guessNetwork(draft.id);
    const picked = brandLabel(item, "ai");
    if (guess && guess.toLowerCase() !== picked.toLowerCase().replace(/\s+/g, "")) {
      lines.push("", `⚠️ This number usually belongs to ${esc(guess === "9mobile" ? "9mobile" : guess[0].toUpperCase() + guess.slice(1))}. You picked ${esc(picked)}. Numbers can switch network, so only continue if ${esc(picked)} is right.`);
    }
  }
  await reply(c, lines.join("\n"), [
    [{ text: `✅ Pay ${naira(total)}`, data: "go" }],
    [{ text: "✉️ Change email", data: "em" }, { text: "✖ Cancel", data: "x" }],
  ]);
}

// ───────────────────────── paying ─────────────────────────

async function pay(c: Ctx) {
  const dr = c.user.draft;
  if (c.user.state === "awaiting_payment" && dr.order) return sendPayLink(c, dr.order);
  if (c.user.state !== "confirm" || !dr.id || !dr.amt || !c.user.email) return stale(c);
  const item = await currentItem(c, dr).catch(() => null);
  if (!item) return stale(c);
  await c.d.typing(c.chatId);
  trackRep(c, "checkout_click");
  const r = await c.d.createOrder({ chatId: c.chatId, email: c.user.email, item, identifier: dr.id, amount: dr.amt, rep: c.user.ref ?? null, ...(dr.mode === "gift" && dr.gift ? { gift: dr.gift } : {}) });
  if (!r.ok) {
    // The draft stays on the confirm card so the customer can simply tap Pay again.
    return say(c, `${esc(r.error)}`, [[{ text: "✅ Try again", data: "go" }, { text: "✖ Cancel", data: "x" }]]);
  }
  const order = { id: r.orderId, url: r.url, total: r.total };
  await save(c, "awaiting_payment", { ...dr, order });
  await sendPayLink(c, order, true);
}

async function sendPayLink(c: Ctx, o: { id: string; url: string; total: number }, first = false) {
  const text = first
    ? `Tap below to pay <b>${naira(o.total)}</b> securely with card, bank transfer or USSD.\n\nThe moment your payment is confirmed I'll send your order here. You don't need to do anything else.`
    : `Here is your payment link again for <b>${naira(o.total)}</b>.`;
  await say(c, text, [
    [{ text: `💳 Pay ${naira(o.total)}`, url: o.url }],
    [{ text: "✅ I've paid", data: `chk:${o.id}` }, { text: "✖ Cancel", data: "x" }],
  ]);
}

async function check(c: Ctx, orderId: string | undefined) {
  if (!orderId) return reply(c, "Tap 🧾 My orders to see your recent orders.", [[{ text: "🧾 My orders", data: "ord" }]]);
  await c.d.typing(c.chatId);
  const status = await c.d.checkOrder(c.chatId, orderId);
  if (status === "unknown") return say(c, "I can't find that order. Tap 🧾 My orders to see yours.", [[{ text: "🧾 My orders", data: "ord" }]]);
  if (status === "pending_payment") {
    const o = c.user.draft.order;
    const kb: Keyboard = [];
    if (o && o.id === orderId) kb.push([{ text: `💳 Pay ${naira(o.total)}`, url: o.url }]);
    kb.push([{ text: "✅ I've paid", data: `chk:${orderId}` }]);
    return say(c, "I can't see the payment yet. If you've just paid, give it a minute and tap again. Banks can be slow.", kb);
  }
  if (status === "paid") return say(c, "✅ Payment received. I'm delivering your order now. It will arrive here in a moment.");
  // Anything else is a finished order: checkOrder has already put its outcome message in the chat.
}

// ───────────────────────── my orders / buy again ─────────────────────────

const STATUS_ICON: Record<string, string> = { fulfilled: "✅", paid: "⏳", needs_review: "⏳", failed_refunded: "↩️", refund_failed: "⚠️", pending_payment: "🕓" };

async function orders(c: Ctx) {
  const list = await c.d.recentOrders(c.chatId);
  if (!list.length) {
    await save(c, "idle", {});
    return reply(c, "You haven't bought anything here yet.", [[{ text: "🛒 Buy something", data: "buy" }]]);
  }
  const lines = ["<b>Your recent orders</b>"];
  for (const o of list) {
    lines.push(`${STATUS_ICON[o.status] ?? "•"} ${esc(pfmTitle(o.biller_name))} · ${naira(o.amount_ngn)}\n   ${esc(maskIdentifier(o.identifier))} · ${esc(statusWord(o.status))}`);
    if (o.status === "fulfilled" && o.flw_token) lines.push(`   🔑 <code>${esc(o.flw_token)}</code>`);
  }
  const again = uniqueBy(list.filter((o) => o.status === "fulfilled"), (o) => `${o.biller_code}|${o.item_code}|${o.identifier}`).slice(0, 4);
  await save(c, "idle", { menu: again.map((o) => ({ bc: o.biller_code, ic: o.item_code, id: o.identifier, nm: o.customer_name, amt: o.amount_ngn })) });
  const kb: Keyboard = again.map((o, i) => [{ text: `🔁 ${pfmTitle(o.biller_name).slice(0, 22)} ${maskIdentifier(o.identifier)}`, data: `ag:${i}` }]);
  kb.push([{ text: "🛒 Buy something", data: "buy" }]);
  await reply(c, lines.join("\n"), kb);
}

async function buyAgain(c: Ctx, idx: number) {
  const ref = c.user.draft.menu?.[idx];
  if (!ref) return stale(c);
  return rebuy(c, ref as { bc: string; ic: string; id: string; nm: string | null });
}

/** One-tap buy of something known: a recent order, a saved item, a reminder. Fixed-price items go straight to the confirm card. */
async function rebuy(c: Ctx, ref: { bc: string; ic: string; id: string; nm: string | null }) {
  const all = await loadCatalogue(c);
  if (!all) return;
  const item = all.find((i) => i.biller_code === ref.bc && i.item_code === ref.ic);
  const cat = item ? catOf(item) : null;
  if (!item || !cat) return reply(c, "That one isn't available right now. Tap /buy to pick something else.", [[{ text: "🛒 Buy something", data: "buy" }]]);
  const base: Draft = { cat, bc: item.biller_code, ic: item.item_code, id: ref.id, nm: ref.nm ?? null };
  if (item.amount > 0) return toConfirm(c, { ...base, amt: Math.round(item.amount) });
  return askAmount(c, base);
}
