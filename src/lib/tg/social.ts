// src/lib/tg/social.ts
// The "other people" parts of the bot: asking someone to pay (Pay for Me), running a giveaway for people you name,
// and a giveaway link people choose from. All three use the same server code as the website pages
// (lib/payforme.ts, lib/payforme-collect.ts) through Deps, so every check on the website applies here too.
//
// The bot never takes the money for an "ask": it makes the request and hands the customer a message to forward.
// For a giveaway the customer pays by a normal payment link. Progress messages come later from tgLinksSweep.

import { GIVEAWAY_MAX_ITEMS, PFM_MAX_ITEMS, PFC_BUDGETS, PFC_MAX_PEOPLE, pfmItemFee, pfmTitle, maskIdentifier, requestShareText, pfcShareText, pfcChoiceText, type PfmCategory } from "@/lib/payforme-shared";
import { cleanText } from "@/lib/gift";
import { getCountry } from "@/lib/countries";
import { ngnMaxOrder } from "@/lib/ngn-fee";
import { esc, type Keyboard } from "./api";
import { naira, rows, CANCEL, reply, say, save, parseAmount, catRows, askEmailFor, waShare, tgShare, type Ctx } from "./kit";
import type { Draft, Item } from "./engine";

export interface ListItem {
  billerCode: string;
  itemCode: string;
  billerName: string;
  itemName: string;
  identifier: string;
  identifierLabel: string;
  amount: number;
  name: string | null;   // who the provider says the meter / smartcard belongs to
  fee: number;
  icon: string;
}

const ICON: Record<string, string> = { el: "⚡", tv: "📺", ai: "📱", da: "🌐", ex: "🎓" };
const app = (c: Ctx) => c.d.appUrl;
const NOTE_MAX = 160;

// ───────────────────────── entry points ─────────────────────────

export async function onButton(c: Ctx, data: string) {
  const f = c.d.flags;
  if (data === "sc:ask") {
    if (!f.ask) return unavailable(c);
    await save(c, "pick_cat", { mode: "ask", list: [], sc: { flow: "ask" } });
    return reply(c, "🙏 <b>Ask someone to pay</b>\nChoose what you need paid for. I'll turn it into a link you can send to a friend or relative. They see exactly what it is and pay; you get the token or top-up. Nothing is charged until they pay.\n\nWhat do you need first?", [...catRows(f), CANCEL]);
  }
  if (data === "sc:gv") {
    if (!f.giveaway) return unavailable(c);
    await save(c, "idle", {});
    return reply(c, "🎉 <b>Giveaway</b>\nHow do you want to do it?", [
      [{ text: "👥 I pick the people", data: "sc:give" }],
      [{ text: "🔗 Let them choose (a link)", data: "sc:link" }],
      [{ text: "⬅ Back", data: "home" }],
    ]);
  }
  if (data === "sc:give") {
    if (!f.giveaway) return unavailable(c);
    await save(c, "pick_cat", { mode: "give", list: [], sc: { flow: "give" } });
    return reply(c, "👥 <b>Giveaway for people you pick</b>\nAdd what each person gets: their meter, smartcard or phone number. You pay once for everyone, then I give you each person's token or confirmation.\n\nWhat is the first one?", [...catRows(f), CANCEL]);
  }
  if (data === "sc:link") {
    if (!f.giveaway) return unavailable(c);
    await save(c, "sc_budget", { sc: { flow: "link" } });
    return reply(c, "🔗 <b>Giveaway link</b>\nYou share one link. Each person picks what they want and enters their own number. You review the list and pay once.\n\nHow much can each person get? Tap an amount or type it.", [...rows(PFC_BUDGETS.map((n) => ({ text: naira(n), data: `sc:b:${n}` })), 4), CANCEL]);
  }

  const st = c.user.state, dr = c.user.draft;
  if (data === "sc:more" && st === "sc_list") {
    await save(c, "pick_cat", { mode: dr.mode, list: dr.list, sc: dr.sc });
    return reply(c, "What is next?", [...catRows(f), CANCEL]);
  }
  if (data === "sc:rm" && st === "sc_list") {
    const list = (dr.list ?? []).slice(0, -1);
    if (!list.length) {
      await save(c, "pick_cat", { mode: dr.mode, list: [], sc: dr.sc });
      return reply(c, "The list is empty. What do you want to add?", [...catRows(f), CANCEL]);
    }
    return showList(c, { ...dr, list });
  }
  if (data === "sc:done" && st === "sc_list") return next(c, dr);
  if (data === "sc:nm:me" && st === "sc_name") return setName(c, dr, cleanText(c.user.first_name ?? "", 60));
  if (data === "sc:ns" && st === "sc_note") return setNote(c, dr, "");
  if (data === "sc:ok" && st === "sc_confirm") return create(c, dr);

  // giveaway link choices
  let m = /^sc:b:(\d+)$/.exec(data);
  if (m && st === "sc_budget") return setBudget(c, dr, Number(m[1]));
  m = /^sc:p:(\d+)$/.exec(data);
  if (m && st === "sc_people") return setPeople(c, dr, Number(m[1]));
  m = /^sc:t:([a-z]+)$/.exec(data);
  if (m && st === "sc_cats") return toggleCat(c, dr, m[1]);
  if (data === "sc:cd" && st === "sc_cats") {
    if (!(dr.sc?.cats ?? []).length) return say(c, "Pick at least one thing people can choose.");
    return next(c, dr);
  }
  return reply(c, "That button has expired. Tap /start to begin again.", [[{ text: "🏠 Menu", data: "home" }]]);
}

export async function onText(c: Ctx, text: string) {
  const st = c.user.state, dr = c.user.draft;
  if (st === "sc_name") {
    const name = cleanText(text, 60);
    if (name.length < 2) return say(c, "Type your name (at least 2 letters), so they know who it's from.", nameKb(c));
    return setName(c, dr, name);
  }
  if (st === "sc_note") return setNote(c, dr, cleanText(text, NOTE_MAX));
  if (st === "sc_budget") {
    const n = parseAmount(text);
    if (n === null) return say(c, "Type the amount in naira, for example <code>2000</code>.", [CANCEL]);
    return setBudget(c, dr, n);
  }
  if (st === "sc_people") {
    const n = Number(text.replace(/\D/g, ""));
    if (!Number.isFinite(n) || n < 1) return say(c, `Type how many people, from 1 to ${PFC_MAX_PEOPLE}.`, [CANCEL]);
    return setPeople(c, dr, n);
  }
  return say(c, "Use the buttons above, or tap Cancel to start again.", [CANCEL]);
}

const unavailable = (c: Ctx) => reply(c, "That isn't open yet. Please check back soon.", [[{ text: "⬅ Back", data: "home" }]]);

// ───────────────────────── the list (ask / give) ─────────────────────────

/** Called by the buy flow when a thing has been chosen and checked: it goes on the list instead of to the shop. */
export async function listAdd(c: Ctx, draft: Draft, item: Item) {
  const mode = draft.mode === "give" ? "give" : "ask";
  const list = draft.list ?? [];
  const max = mode === "give" ? GIVEAWAY_MAX_ITEMS : PFM_MAX_ITEMS;
  if (list.length >= max) {
    return reply(c, `The list is full (${max} is the most). Tap Done to continue.`, [[{ text: "✅ Done", data: "sc:done" }, CANCEL[0]]]);
  }
  const li: ListItem = {
    billerCode: item.biller_code, itemCode: item.item_code,
    billerName: item.biller_name, itemName: item.name,
    identifier: draft.id!, identifierLabel: item.label_name || "Account number",
    amount: draft.amt!, name: draft.nm ?? null, fee: pfmItemFee(item, draft.amt!), icon: ICON[draft.cat ?? "el"] ?? "•",
  };
  return showList(c, { mode, list: [...list, li], sc: draft.sc });
}

async function showList(c: Ctx, draft: Draft) {
  const list = draft.list ?? [];
  await save(c, "sc_list", { mode: draft.mode, list, sc: draft.sc });
  const total = list.reduce((s, i) => s + i.amount + i.fee, 0);
  const lines = [draft.mode === "give" ? `<b>Your giveaway (${list.length})</b>` : `<b>Your list (${list.length})</b>`];
  list.forEach((i, k) => lines.push(`${k + 1}. ${i.icon} ${esc(pfmTitle(i.billerName, i.itemName))}\n    ${esc(maskIdentifier(i.identifier))}${i.name ? ` · ${esc(i.name)}` : ""} · ${naira(i.amount)}`));
  lines.push("", `<b>Total: ${naira(total)}</b> (fees included)`);
  await reply(c, lines.join("\n"), [
    [{ text: "➕ Add another", data: "sc:more" }, { text: "✅ Done", data: "sc:done" }],
    [{ text: "↩ Remove last", data: "sc:rm" }, CANCEL[0]],
  ]);
}

// ───────────────────────── name, email, message, review ─────────────────────────

const nameKb = (c: Ctx): Keyboard => {
  const kb: Keyboard = [];
  const n = cleanText(c.user.first_name ?? "", 60);
  if (n.length >= 2) kb.push([{ text: `Use "${n}"`.slice(0, 40), data: "sc:nm:me" }]);
  kb.push(CANCEL);
  return kb;
};

/** What is still missing? Ask for it, or show the review. */
async function next(c: Ctx, draft: Draft) {
  const sc = draft.sc ?? {};
  const flow = sc.flow as "ask" | "give" | "link";
  if (!sc.name) {
    await save(c, "sc_name", draft);
    return reply(c, flow === "ask" ? "What is your name? The person paying sees it, so they know who is asking." : "What is your name? People see it, so they know who the gift is from.", nameKb(c));
  }
  if ((flow === "give" || flow === "link") && !c.user.email) {
    return askEmailFor(c, draft, "list", "Where should we send your receipt and the tokens? Type your email address (asked only once).");
  }
  if (!sc.noteDone) {
    await save(c, "sc_note", draft);
    return reply(c, "Add a short message? (optional, up to 160 characters)", [[{ text: "Skip", data: "sc:ns" }], CANCEL]);
  }
  return review(c, draft);
}

export const afterEmail = (c: Ctx, draft: Draft) => next(c, draft);

async function setName(c: Ctx, draft: Draft, name: string) {
  if (name.length < 2) return say(c, "Type your name (at least 2 letters).", nameKb(c));
  return next(c, { ...draft, sc: { ...(draft.sc ?? {}), name } });
}
async function setNote(c: Ctx, draft: Draft, note: string) {
  return next(c, { ...draft, sc: { ...(draft.sc ?? {}), note, noteDone: true } });
}

async function review(c: Ctx, draft: Draft) {
  const sc = draft.sc ?? {};
  await save(c, "sc_confirm", draft);
  const lines: string[] = [];
  let go = "✅ Create my link";
  if (sc.flow === "link") {
    lines.push("<b>Please check your giveaway link</b>",
      `Each person can get up to ${naira(sc.budget)} of ${esc(pfcChoiceText(sc.cats as PfmCategory[]))}.`,
      `Up to ${sc.people} ${sc.people === 1 ? "person" : "people"}.`);
  } else {
    const list = draft.list ?? [];
    const total = list.reduce((s, i) => s + i.amount + i.fee, 0);
    if (sc.flow === "give") { lines.push(`<b>Please check your giveaway</b>`, `${list.length} ${list.length === 1 ? "person" : "people"} · <b>${naira(total)}</b> in all.`); go = `✅ Continue to pay ${naira(total)}`; }
    else lines.push("<b>Please check your request</b>", `${list.length} ${list.length === 1 ? "thing" : "things"} · <b>${naira(total)}</b> in all.`);
  }
  lines.push(`From: <b>${esc(sc.name)}</b>`);
  if (sc.note) lines.push(`Message: <i>${esc(sc.note)}</i>`);
  if (sc.flow === "link") lines.push("", "Nothing is charged until you close the link and pay.");
  else if (sc.flow === "ask") lines.push("", "Nothing is charged now. The person you send it to pays on a secure page.");
  else lines.push("", "Nothing is charged until you tap Pay on the next screen.");
  await reply(c, lines.join("\n"), [[{ text: go, data: "sc:ok" }], CANCEL]);
}

// ───────────────────────── giveaway link choices ─────────────────────────

function budgetLimits() {
  const ng = getCountry("NG");
  return { min: ng.minDomestic ?? ng.minLocal, max: ngnMaxOrder(ng.maxLocal) };
}

async function setBudget(c: Ctx, draft: Draft, n: number) {
  const { min, max } = budgetLimits();
  if (!Number.isFinite(n) || n < min || n > max) return say(c, `Each person can get between ${naira(min)} and ${naira(max)}.`, [CANCEL]);
  await save(c, "sc_people", { sc: { ...(draft.sc ?? {}), budget: Math.round(n) } });
  return reply(c, `Up to ${naira(n)} each. How many people can join? (1 to ${PFC_MAX_PEOPLE})`, [...rows([3, 5, 10, PFC_MAX_PEOPLE].map((k) => ({ text: String(k), data: `sc:p:${k}` })), 4), CANCEL]);
}

const CAT_CHOICES: { key: PfmCategory; label: string }[] = [
  { key: "electricity", label: "⚡ Light" }, { key: "cable", label: "📺 TV" }, { key: "airtime", label: "📱 Airtime" }, { key: "data", label: "🌐 Data" }, { key: "exam", label: "🎓 Exam PIN" },
];
const catsFor = (c: Ctx) => CAT_CHOICES.filter((x) => x.key !== "exam" || c.d.flags.exams);

async function setPeople(c: Ctx, draft: Draft, n: number) {
  if (!Number.isFinite(n) || n < 1 || n > PFC_MAX_PEOPLE) return say(c, `Choose from 1 to ${PFC_MAX_PEOPLE} people.`, [CANCEL]);
  return askCats(c, { sc: { ...(draft.sc ?? {}), people: Math.round(n), cats: draft.sc?.cats ?? [] } });
}

async function askCats(c: Ctx, draft: Draft) {
  await save(c, "sc_cats", draft);
  const picked: string[] = draft.sc?.cats ?? [];
  const kb: Keyboard = rows(catsFor(c).map((x) => ({ text: `${picked.includes(x.key) ? "✅ " : ""}${x.label}`, data: `sc:t:${x.key}` })), 2);
  kb.push([{ text: "Done", data: "sc:cd" }], CANCEL);
  await reply(c, "What can people choose from? Tap to switch on or off, then tap Done.", kb);
}

async function toggleCat(c: Ctx, draft: Draft, key: string) {
  if (!catsFor(c).some((x) => x.key === key)) return say(c, "That one isn't available.");
  const cur: string[] = draft.sc?.cats ?? [];
  const cats = cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key];
  return askCats(c, { sc: { ...(draft.sc ?? {}), cats } });
}

// ───────────────────────── creating it ─────────────────────────

async function create(c: Ctx, dr: Draft) {
  const sc = dr.sc ?? {};
  await c.d.typing(c.chatId);
  const note = sc.note ? String(sc.note) : null;

  if (sc.flow === "ask") {
    const r = await c.d.createAsk({ chatId: c.chatId, name: sc.name, email: c.user.email ?? null, note, items: dr.list ?? [] });
    if (!r.ok) return retry(c, r.error);
    const link = `${app(c)}/r/${r.id}`;
    const mine = `${link}?k=${r.key}`;
    const text = requestShareText({ receiverName: sc.name, total: r.total, count: r.count, link, note });
    await save(c, "idle", {});
    return say(c, `✅ <b>Your link is ready.</b> ${naira(r.total)} for ${r.count} ${r.count === 1 ? "thing" : "things"}.\n\nSend this to the person who will pay:\n\n<pre>${esc(text)}</pre>\nI'll message you here when they pay and when it's delivered. Your tokens appear on <b>your page</b> (keep that link private).`, [
      [{ text: "💬 Send on WhatsApp", url: waShare(text) }, { text: "✈️ Send on Telegram", url: tgShare(text) }],
      [{ text: "📄 My page", url: mine }],
      [{ text: "🏠 Menu", data: "home" }],
    ]);
  }

  if (sc.flow === "give") {
    if (!c.user.email) return next(c, dr);
    const r = await c.d.createGiveaway({ chatId: c.chatId, name: sc.name, email: c.user.email, note, items: dr.list ?? [] });
    if (!r.ok) return retry(c, r.error);
    const mine = `${app(c)}/r/${r.id}?k=${r.key}`;
    await save(c, "idle", {});
    return say(c, `✅ <b>Your giveaway is ready.</b> ${r.count} ${r.count === 1 ? "person" : "people"} · ${naira(r.total)}.\n\nTap Pay to fund it. Once the payment is confirmed I'll send each gift out and message you here. Each person's token or confirmation is on <b>your page</b> (keep that link private).`, [
      [{ text: `💳 Pay ${naira(r.total)}`, url: r.url }],
      [{ text: "📄 My page", url: mine }],
      [{ text: "🏠 Menu", data: "home" }],
    ]);
  }

  if (sc.flow === "link") {
    if (!c.user.email) return next(c, dr);
    const r = await c.d.createLink({ chatId: c.chatId, name: sc.name, email: c.user.email, note, budget: sc.budget, categories: sc.cats, maxPeople: sc.people });
    if (!r.ok) return retry(c, r.error);
    const link = `${app(c)}/c/${r.id}`;
    const mine = `${link}?k=${r.key}`;
    const text = pfcShareText({ makerName: sc.name, budget: sc.budget, categories: sc.cats, link, note });
    await save(c, "idle", {});
    return say(c, `✅ <b>Your giveaway link is ready.</b>\n\nShare this with the people you're giving to:\n\n<pre>${esc(text)}</pre>\nNothing is charged until you close the link and pay. Use <b>your page</b> to see who joined and to pay (keep that link private). I'll message you when the link is full.`, [
      [{ text: "💬 Send on WhatsApp", url: waShare(text) }, { text: "✈️ Send on Telegram", url: tgShare(text) }],
      [{ text: "📄 My page", url: mine }],
      [{ text: "🏠 Menu", data: "home" }],
    ]);
  }
  return reply(c, "That has expired. Tap /start to begin again.", [[{ text: "🏠 Menu", data: "home" }]]);
}

const retry = (c: Ctx, error: string) => say(c, `${esc(error)}\n\nNothing was charged.`, [[{ text: "🔄 Try again", data: "sc:ok" }, CANCEL[0]]]);
