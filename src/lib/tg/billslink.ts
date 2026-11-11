// src/lib/tg/billslink.ts
// "🔗 My bills link" in the bot: one standing link a person shares so friends and family can pay their light, TV,
// airtime or data. The link itself, its public page and the payments all live in lib/paylink.ts (shared with the
// website); this file is only the conversation: pick from Saved, name it, share it, and look after it.
// Like the rest of the engine it touches nothing outside `Deps`.

import { maskIdentifier } from "@/lib/payforme-shared";
import { cleanText } from "@/lib/gift";
import { esc, type Keyboard } from "./api";
import { CANCEL, reply, say, save, waShare, tgShare, type Ctx } from "./kit";
import type { Hooks, SavedItem } from "./v3";

export interface LinkRow { slug: string; ownerName: string; active: boolean; items: number; lastPaidAt: string | null }
export interface LinkView { slug: string; ownerName: string; active: boolean; note: string | null; items: { label: string; title: string; masked: string; fixed: number | null }[]; payments: { name: string | null; amount: number; status: string; at: string }[] }
export interface LinkItemIn { billerCode: string; itemCode: string; billerName: string; itemName: string; identifier: string; identifierLabel: string; label: string; amount: number | null }

export interface Bills {
  /** Is the feature switched on and its tables in place? */
  ready(): Promise<boolean>;
  list(chatId: number): Promise<LinkRow[]>;
  view(chatId: number, slug: string): Promise<LinkView | null>;
  create(chatId: number, i: { name: string; email: string | null; note: string | null; items: LinkItemIn[] }): Promise<{ ok: true; slug: string } | { ok: false; error: string }>;
  setActive(chatId: number, slug: string, active: boolean): Promise<boolean>;
  remove(chatId: number, slug: string): Promise<boolean>;
}

const MAX_ITEMS = 3;
const MAX_LINKS = 3;
const CAT_ICON: Record<string, string> = { el: "⚡", tv: "📺", ai: "📱", da: "🌐" };
const naira = (n: number) => `₦${Math.round(n).toLocaleString("en-NG")}`;
const urlOf = (c: Ctx, slug: string) => `${c.d.appUrl}/for/${slug}`;
const shareText = (name: string, link: string, note?: string | null) => [`Hi! You can pay my light, TV, airtime or data bills here, any time, in naira:`, link, note ? `\n"${note}"` : "", `\n— ${name}`].filter(Boolean).join("\n");
const SOON = "🔗 <b>Bills links</b> are opening soon. I'll be able to make yours in a few days.";

const hasHandle = (c: Ctx) => c.d.flags.ask && !!c.d.v3.bills;

/** The menu button / /billslink. */
export async function home(c: Ctx, note?: string) {
  await save(c, "idle", {});
  if (!hasHandle(c)) return reply(c, SOON, [[{ text: "🏠 Menu", data: "home" }]]);
  if (!(await c.d.v3.bills.ready())) return reply(c, SOON, [[{ text: "🏠 Menu", data: "home" }]]);
  const links = await c.d.v3.bills.list(c.chatId);
  if (!links.length) return intro(c, note);
  const kb: Keyboard = links.map((l) => [{ text: `🔗 ${l.ownerName} · ${l.active ? "on" : "paused"}`.slice(0, 60), data: `bl:v:${l.slug}` }]);
  if (links.length < MAX_LINKS) kb.push([{ text: "➕ Make another", data: "bl:n" }]);
  kb.push([{ text: "🏠 Menu", data: "home" }]);
  await reply(c, `🔗 <b>My bills links</b>${note ? `\n${note}` : ""}\nTap one to share it, pause it or see who paid.`, kb);
}

async function intro(c: Ctx, note?: string) {
  await reply(c, [
    "🔗 <b>Your bills link</b>",
    ...(note ? [note] : []),
    "One link you share with family and friends. They open it, choose what to pay and how much, and pay in naira. I deliver it to you and tell you here when someone pays.",
    "",
    "They see only the name you choose and the last 4 digits. Never the full number or the name on the account.",
  ].join("\n"), [[{ text: "➕ Make my link", data: "bl:n" }], [{ text: "🏠 Menu", data: "home" }]]);
}

async function picker(c: Ctx, sel: string[], saved: SavedItem[], note?: string) {
  await save(c, "idle", { ...c.user.draft, bl: { ...(c.user.draft.bl ?? {}), sel } });
  const kb: Keyboard = saved.map((s) => [{ text: `${sel.includes(s.id) ? "✅" : "⬜"} ${CAT_ICON[s.cat] ?? "•"} ${s.label} · ${maskIdentifier(s.identifier)}`.slice(0, 60), data: `bl:t:${s.id}` }]);
  if (sel.length) kb.push([{ text: `Continue with ${sel.length}`, data: "bl:ok" }]);
  kb.push([{ text: "⬅ Back", data: "bl:go" }]);
  await reply(c, `🔗 <b>What can people pay for?</b>\nTap up to ${MAX_ITEMS} from your Saved list.${note ? `\n\n${note}` : ""}`, kb);
}

async function start(c: Ctx, hooks: Hooks) {
  if (!hasHandle(c) || !(await c.d.v3.bills.ready())) return home(c);
  const links = await c.d.v3.bills.list(c.chatId);
  if (links.length >= MAX_LINKS) return home(c, `You already have ${MAX_LINKS} links. Delete one to make another.`);
  const saved = (await c.d.v3.saved.list(c.chatId)).filter((s) => s.cat !== "ex");
  if (!saved.length) {
    await save(c, "idle", {});
    return reply(c, "🔗 <b>First, save what you want covered.</b>\nPay for your meter, smartcard or number once, then tap <b>💾 Save</b> under the delivered order. Your link is built from your Saved list, so nobody ever types a number wrongly.", [[{ text: "🛒 Buy something", data: "buy" }], [{ text: "🏠 Menu", data: "home" }]]);
  }
  await save(c, "idle", { bl: { sel: [] } });
  return picker(c, [], saved);
}

async function askName(c: Ctx) {
  const first = cleanText(c.user.first_name ?? "", 40);
  await save(c, "bl_name", { bl: c.user.draft.bl });
  const kb: Keyboard = [];
  if (first.length >= 2) kb.push([{ text: `Use “${first}”`.slice(0, 60), data: "bl:nm" }]);
  kb.push(CANCEL);
  await reply(c, "What name should people see? For example <b>Ada</b>. They'll see “Pay Ada's bills”.", kb);
}

async function askNote(c: Ctx, name: string) {
  await save(c, "bl_note", { bl: { ...(c.user.draft.bl ?? {}), name } });
  await reply(c, "Add a short message if you like, for example <i>Thank you for always looking out for me</i>. Or skip.", [[{ text: "Skip", data: "bl:ns" }], CANCEL]);
}

async function make(c: Ctx, note: string | null) {
  const d = c.user.draft.bl ?? {};
  const sel: string[] = Array.isArray(d.sel) ? d.sel : [];
  const name = cleanText(d.name ?? "", 40);
  if (!sel.length || name.length < 2) return home(c);
  const all = await c.d.catalogue();
  const items: LinkItemIn[] = [];
  for (const id of sel) {
    const s = await c.d.v3.saved.get(c.chatId, id);
    const it = s && all.find((i) => i.biller_code === s.bc && i.item_code === s.ic);
    if (!s || !it) continue;
    items.push({ billerCode: it.biller_code, itemCode: it.item_code, billerName: it.biller_name, itemName: it.name, identifier: s.identifier, identifierLabel: it.label_name || "Account number", label: s.label, amount: it.amount > 0 ? Math.round(it.amount) : null });
  }
  if (!items.length) {
    await save(c, "idle", {});
    return reply(c, "None of those are available right now. Pick again from Saved.", [[{ text: "🔗 Try again", data: "bl:n" }]]);
  }
  await c.d.typing(c.chatId).catch(() => undefined);
  const r = await c.d.v3.bills.create(c.chatId, { name, email: c.user.email ?? null, note, items });
  await save(c, "idle", {});
  if (!r.ok) return reply(c, `I couldn't make your link: ${esc(r.error)}`, [[{ text: "🔗 Try again", data: "bl:n" }, { text: "🏠 Menu", data: "home" }]]);
  const link = urlOf(c, r.slug);
  const text = shareText(name, link, note);
  await reply(c, [`🎉 <b>Your link is ready</b>`, link, "", "Send it to family and friends. When someone pays, I'll message you here, and again when it's delivered, with the token if it's light.", "", "To stop people paying, open <b>🔗 My bills link</b> and tap Pause."].join("\n"), [
    [{ text: "💬 Send on WhatsApp", url: waShare(text) }, { text: "✈️ Send on Telegram", url: tgShare(text) }],
    [{ text: "🔗 My bills link", data: `bl:v:${r.slug}` }],
  ]);
}

async function show(c: Ctx, slug: string, hooks: Hooks, note?: string) {
  const v = await c.d.v3.bills.view(c.chatId, slug);
  if (!v) return hooks.stale(c);
  await save(c, "idle", {});
  const link = urlOf(c, v.slug);
  const lines = [`🔗 <b>${esc(v.ownerName)}'s bills link</b> · ${v.active ? "✅ on" : "⏸ paused"}`, link];
  if (note) lines.push("", note);
  lines.push("", ...v.items.map((i) => `${i.label}: ${esc(i.title)} · ${esc(i.masked)}${i.fixed ? ` · ${naira(i.fixed)}` : ""}`));
  const paid = v.payments;
  lines.push("", paid.length ? `<b>Recent payments</b>\n${paid.slice(0, 5).map((p) => `${esc(p.name || "Someone")} · ${naira(p.amount)}`).join("\n")}` : "Nobody has paid yet. Share your link.");
  const text = shareText(v.ownerName, link, v.note);
  await reply(c, lines.join("\n"), [
    [{ text: "💬 WhatsApp", url: waShare(text) }, { text: "✈️ Telegram", url: tgShare(text) }],
    [{ text: v.active ? "⏸ Pause" : "▶️ Turn back on", data: `bl:${v.active ? "p" : "r"}:${v.slug}` }, { text: "🗑 Delete", data: `bl:d:${v.slug}` }],
    [{ text: "⬅ Back", data: "bl:go" }],
  ]);
}

/** Buttons: bl:*. Returns false if it isn't one of ours. */
export async function onButton(c: Ctx, data: string, hooks: Hooks): Promise<boolean> {
  if (!data.startsWith("bl:")) return false;
  const [, a, b] = data.split(":");
  if (a === "go") { await home(c); return true; }
  if (!hasHandle(c) || !(await c.d.v3.bills.ready())) { await home(c); return true; }
  if (a === "n") { await start(c, hooks); return true; }
  if (a === "t" && b) {
    const saved = (await c.d.v3.saved.list(c.chatId)).filter((s) => s.cat !== "ex");
    const cur: string[] = Array.isArray(c.user.draft.bl?.sel) ? c.user.draft.bl.sel.filter((id: string) => saved.some((s) => s.id === id)) : [];
    if (!saved.some((s) => s.id === b)) { await hooks.stale(c); return true; }
    if (cur.includes(b)) { await picker(c, cur.filter((x) => x !== b), saved); return true; }
    if (cur.length >= MAX_ITEMS) { await picker(c, cur, saved, `A link covers up to ${MAX_ITEMS}. Untick one to swap.`); return true; }
    await picker(c, [...cur, b], saved);
    return true;
  }
  if (a === "ok") {
    if (!Array.isArray(c.user.draft.bl?.sel) || !c.user.draft.bl.sel.length) { await hooks.stale(c); return true; }
    await askName(c);
    return true;
  }
  if (a === "nm") {
    const first = cleanText(c.user.first_name ?? "", 40);
    if (c.user.state !== "bl_name" || first.length < 2) { await hooks.stale(c); return true; }
    await askNote(c, first);
    return true;
  }
  if (a === "ns") {
    if (c.user.state !== "bl_note") { await hooks.stale(c); return true; }
    await make(c, null);
    return true;
  }
  if (a === "v" && b) { await show(c, b, hooks); return true; }
  if ((a === "p" || a === "r") && b) {
    const ok = await c.d.v3.bills.setActive(c.chatId, b, a === "r");
    if (!ok) { await hooks.stale(c); return true; }
    await show(c, b, hooks, a === "p" ? "⏸ Paused. Nobody can pay it until you turn it back on." : "▶️ It's on again.");
    return true;
  }
  if (a === "d" && b) {
    await reply(c, "Delete this link for good? Anyone who has it will see that it's gone. Payments already made are not affected.", [[{ text: "🗑 Yes, delete", data: `bl:y:${b}` }, { text: "Keep it", data: `bl:v:${b}` }]]);
    return true;
  }
  if (a === "y" && b) {
    const ok = await c.d.v3.bills.remove(c.chatId, b);
    if (!ok) { await hooks.stale(c); return true; }
    await home(c, "Deleted.");
    return true;
  }
  await hooks.stale(c);
  return true;
}

/** Typed text in one of our states. Returns false if the state isn't ours. */
export async function onText(c: Ctx, text: string): Promise<boolean> {
  if (c.user.state === "bl_name") {
    const name = cleanText(text, 40);
    if (name.length < 2) { await say(c, "Please type the name people should see, like Ada.", [CANCEL]); return true; }
    await askNote(c, name);
    return true;
  }
  if (c.user.state === "bl_note") {
    await make(c, cleanText(text, 100) || null);
    return true;
  }
  return false;
}
