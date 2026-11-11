// src/lib/tg/bulk.ts
// Bulk airtime in the bot: paste a list of numbers (and amounts), check it, pay once, and get a report when it has
// been sent. The batch itself is the website's bulk pipeline (lib/bulk.ts): one payment, one Paybeta batch, a partial
// refund of only the numbers that failed. The bot only collects the list and shows the outcome.

import { parseBulkText, checkRows, bulkFee, maskPhone, NETWORKS, BULK_MAX_RECIPIENTS, BULK_MIN_EACH, BULK_MAX_EACH, type DraftRow } from "@/lib/bulk-shared";
import { esc, type Keyboard } from "./api";
import { naira, rows, CANCEL, reply, say, save, parseAmount, askEmailFor, type Ctx } from "./kit";
import type { Draft } from "./engine";

const label = (n: string) => NETWORKS.find((x) => x.code === n)?.label ?? n;

export async function onButton(c: Ctx, data: string) {
  const st = c.user.state, dr = c.user.draft;
  if (data === "bk:go") {
    if (!c.d.flags.bulk) return reply(c, "Bulk airtime isn't open yet. Please check back soon.", [[{ text: "⬅ Back", data: "home" }]]);
    await save(c, "bk_paste", {});
    return reply(c, [
      "📦 <b>Bulk airtime</b>",
      `Send the numbers, one per line, with the amount:`,
      "<code>08031234567 500\n0803 123 4568 1000\n09012345678 200 airtel</code>",
      `Up to ${BULK_MAX_RECIPIENTS} numbers, ${naira(BULK_MIN_EACH)} to ${naira(BULK_MAX_EACH)} each. I work out the network from the number; add the network name to a line to change it. You can paste a list straight from a spreadsheet.`,
    ].join("\n\n"), [CANCEL]);
  }
  if (data === "bk:ok" && st === "bk_confirm") return pay(c, dr);
  if (data === "bk:em" && st === "bk_confirm") return askEmailFor(c, dr, "bk");
  let m = /^bk:a:(\d+)$/.exec(data);
  if (m && st === "bk_amount") return setDefaultAmount(c, dr, Number(m[1]));
  m = /^bk:chk:([0-9a-f-]{36})$/.exec(data);
  if (m) return check(c, m[1]);
  return reply(c, "That button has expired. Tap /start to begin again.", [[{ text: "🏠 Menu", data: "home" }]]);
}

export async function onText(c: Ctx, text: string) {
  const st = c.user.state, dr = c.user.draft;
  if (st === "bk_paste") return onList(c, text);
  if (st === "bk_amount") {
    const n = parseAmount(text);
    if (n === null) return say(c, "Type the amount in naira, for example <code>500</code>.", [CANCEL]);
    return setDefaultAmount(c, dr, n);
  }
  return say(c, "Use the buttons above, or tap Cancel to start again.", [CANCEL]);
}

async function onList(c: Ctx, text: string) {
  const { rows: parsed, skipped } = parseBulkText(text, 0);
  if (!parsed.length) {
    return say(c, "I couldn't find any phone numbers in that. Send them one per line, for example <code>08031234567 500</code>.", [CANCEL]);
  }
  const bk = { rows: parsed, skipped: skipped.slice(0, 5), skippedCount: skipped.length };
  if (parsed.some((r) => !r.amount)) {
    await save(c, "bk_amount", { bk });
    const missing = parsed.filter((r) => !r.amount).length;
    return reply(c, `${missing} of ${parsed.length} numbers have no amount. How much airtime should each of those get?`, [...rows([100, 200, 500, 1000].map((n) => ({ text: naira(n), data: `bk:a:${n}` })), 4), CANCEL]);
  }
  return review(c, { bk });
}

async function setDefaultAmount(c: Ctx, dr: Draft, n: number) {
  const list: DraftRow[] = (dr.bk?.rows ?? []).map((r: DraftRow) => ({ ...r, amount: r.amount || n }));
  return review(c, { bk: { ...dr.bk, rows: list } });
}

/** Checks the list with the website's own rules and shows it back before any payment exists. */
async function review(c: Ctx, dr: Draft) {
  const checked = checkRows(dr.bk!.rows);
  if (!checked.ok) {
    await save(c, "bk_paste", {});
    return say(c, `${esc(checked.error)}\n\nFix that and send the whole list again.`, [CANCEL]);
  }
  const fee = bulkFee(checked.total);
  const bk = { ...dr.bk, rows: checked.rows, total: checked.total, fee };
  if (!c.user.email) {
    return askEmailFor(c, { bk }, "bk", "Almost there. Where should we send your receipt? Type your email address (asked only once).");
  }
  return confirm(c, { bk });
}

export const afterEmail = (c: Ctx, dr: Draft) => confirm(c, dr);

async function confirm(c: Ctx, dr: Draft) {
  const bk = dr.bk!;
  await save(c, "bk_confirm", { bk });
  const by = new Map<string, { n: number; sum: number }>();
  for (const r of bk.rows) { const v = by.get(r.network) ?? { n: 0, sum: 0 }; v.n++; v.sum += r.amount; by.set(r.network, v); }
  const lines = [
    "<b>Please check your batch</b>",
    `${bk.rows.length} ${bk.rows.length === 1 ? "number" : "numbers"}`,
    ...Array.from(by.entries()).map(([n, v]) => `  ${esc(label(n))}: ${v.n} · ${naira(v.sum)}`),
    "",
    ...bk.rows.slice(0, 8).map((r: any) => `<code>${esc(maskPhone(r.phone))}</code> ${esc(label(r.network))} ${naira(r.amount)}`),
    ...(bk.rows.length > 8 ? [`…and ${bk.rows.length - 8} more`] : []),
    "",
    `Airtime: ${naira(bk.total)}`, `Service fee: ${naira(bk.fee)}`, `<b>Total: ${naira(bk.total + bk.fee)}</b>`, `Receipt to: ${esc(c.user.email)}`,
  ];
  if (bk.skippedCount) lines.push("", `⚠️ ${bk.skippedCount} line${bk.skippedCount === 1 ? "" : "s"} had no valid phone number and ${bk.skippedCount === 1 ? "was" : "were"} left out.`);
  lines.push("", "Numbers that fail are refunded automatically.");
  await reply(c, lines.join("\n"), [[{ text: `✅ Pay ${naira(bk.total + bk.fee)}`, data: "bk:ok" }], [{ text: "✉️ Change email", data: "bk:em" }, CANCEL[0]]]);
}

async function pay(c: Ctx, dr: Draft) {
  const bk = dr.bk;
  if (!bk?.rows || !c.user.email) return reply(c, "That has expired. Tap /start to begin again.", [[{ text: "🏠 Menu", data: "home" }]]);
  await c.d.typing(c.chatId);
  const r = await c.d.createBulk({ chatId: c.chatId, email: c.user.email, rows: bk.rows });
  if (!r.ok) return say(c, `${esc(r.error)}`, [[{ text: "✅ Try again", data: "bk:ok" }, CANCEL[0]]]);
  await save(c, "bk_waiting", { bk: { ...bk, order: { id: r.bulkId, url: r.url, total: r.total } } });
  return say(c, `Tap below to pay <b>${naira(r.total)}</b> securely with card, bank transfer or USSD.\n\nOnce the payment is confirmed I'll send all ${bk.rows.length} top-ups and tell you here how many arrived.`, [
    [{ text: `💳 Pay ${naira(r.total)}`, url: r.url }],
    [{ text: "✅ I've paid", data: `bk:chk:${r.bulkId}` }, CANCEL[0]],
  ]);
}

async function check(c: Ctx, bulkId: string) {
  await c.d.typing(c.chatId);
  const status = await c.d.checkBulk(c.chatId, bulkId);
  if (status === "unknown") return say(c, "I can't find that batch.", [[{ text: "🏠 Menu", data: "home" }]]);
  if (status === "pending_payment") {
    const o = c.user.draft.bk?.order;
    const kb: Keyboard = [];
    if (o && o.id === bulkId) kb.push([{ text: `💳 Pay ${naira(o.total)}`, url: o.url }]);
    kb.push([{ text: "✅ I've paid", data: `bk:chk:${bulkId}` }]);
    return say(c, "I can't see the payment yet. If you've just paid, give it a minute and tap again. Banks can be slow.", kb);
  }
  if (["paid", "processing", "settling"].includes(status)) return say(c, "✅ Payment received. I'm sending the top-ups now. I'll message you here with the result.");
  // finished: checkBulk has already put the outcome in the chat
}
