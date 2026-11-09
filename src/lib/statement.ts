// Account statements: every bill a signed-in customer paid in one calendar month, as a CSV (for Excel/Sheets) or a PDF.
// For small businesses, shops and offices that need a record for their books. Calendar months are Nigerian time (WAT, UTC+1).
// A statement lists the customer's OWN orders only (matched on the signed-in email). It never includes meter tokens or PINs.

import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from "pdf-lib";
import { statusWord } from "@/lib/find-order";
import { money, winSafe } from "@/lib/finance-pdf";

export const STATEMENT_MAX_ROWS = 2000;
const WAT_MS = 3600_000;
export { MONTH_RE, monthRange, recentMonths, STATEMENT_MONTHS_BACK } from "@/lib/statement-months";
/** What is shown on the statement as the issuer. Not a tax invoice. */
export const ISSUER = { trading: "Nolgic", company: "The 36th Solutions Ltd", address: "Abuja, Nigeria", email: "nolgichq@gmail.com" };

export type StatementOrder = {
  id: string; biller_name: string | null; identifier: string | null; customer_name: string | null;
  amount_ngn: number | string | null; service_fee_local: number | string | null; status: string; created_at: string;
  currency?: string | null; is_test?: boolean | null;
};
export type StatementRow = { at: string; date: string; time: string; orderNo: string; service: string; provider: string; number: string; name: string; bill: number; fee: number; total: number; status: string; statusText: string; statusShort: string };
export type Statement = {
  email: string; month: string; label: string; rows: StatementRow[];
  delivered: { count: number; bill: number; fee: number; total: number };
  refunded: { count: number; total: number };
  inProgress: number;
};

// ───────── building ─────────
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const watParts = (iso: string) => { const d = new Date(new Date(iso).getTime() + WAT_MS).toISOString(); return { date: d.slice(0, 10), time: d.slice(11, 16) }; };
const cleanProvider = (n: string | null) => String(n ?? "Order").replace(/\s+VTU$/i, "").trim() || "Order";
export function serviceOf(name: string | null): string {
  const n = String(name ?? "");
  if (/\b(JAMB|WAEC|NECO|NABTEB)\b/i.test(n)) return "Exam PIN";
  if (/DSTV|GOTV|STARTIMES/i.test(n)) return "TV";
  if (/DATA|BROADBAND|SURFLINE|BUNDLE/i.test(n)) return "Data";
  if (/VTU|AIRTIME|MTN|AIRTEL|GLO|9MOBILE|ETISALAT/i.test(n)) return "Airtime";
  if (/ELECTRIC|DISCO|PREPAID|POSTPAID|POWER|EKEDC|IKEDC|EEDC|AEDC|IBEDC|PHED|KEDCO|BEDC|JED|YEDC/i.test(n)) return "Electricity";
  return "Other";
}

const SHORT: Record<string, string> = { fulfilled: "Delivered", failed_refunded: "Refunded", paid: "In progress", needs_review: "In progress" };
const KEEP = new Set(["fulfilled", "failed_refunded", "paid", "needs_review"]);

export function buildStatement(email: string, month: string, label: string, orders: StatementOrder[]): Statement {
  const rows: StatementRow[] = orders
    .filter((o) => !o.is_test && (o.currency ?? "NGN") === "NGN" && KEEP.has(o.status))
    .map((o) => {
      const bill = num(o.amount_ngn), fee = num(o.service_fee_local), p = watParts(o.created_at);
      return { at: o.created_at, date: p.date, time: p.time, orderNo: o.id.slice(0, 8), service: serviceOf(o.biller_name), provider: cleanProvider(o.biller_name), number: String(o.identifier ?? ""), name: String(o.customer_name ?? ""), bill, fee, total: bill + fee, status: o.status, statusText: statusWord(o.status), statusShort: SHORT[o.status] ?? o.status };
    })
    .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  const del = rows.filter((r) => r.status === "fulfilled"), ref = rows.filter((r) => r.status === "failed_refunded");
  const sum = (a: StatementRow[], k: "bill" | "fee" | "total") => Math.round(a.reduce((s, r) => s + r[k], 0) * 100) / 100;
  return {
    email, month, label, rows,
    delivered: { count: del.length, bill: sum(del, "bill"), fee: sum(del, "fee"), total: sum(del, "total") },
    refunded: { count: ref.length, total: sum(ref, "total") },
    inProgress: rows.filter((r) => r.status === "paid" || r.status === "needs_review").length,
  };
}

// ───────── CSV ─────────
/** One CSV cell. Cells starting with = + - @ are prefixed so a spreadsheet can never run them as a formula. */
export function csvCell(v: unknown): string {
  let s = String(v ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
const plain = (n: number) => (Math.round(n * 100) / 100).toFixed(2);

export function statementCsv(s: Statement): string {
  const head = ["Date", "Time (WAT)", "Order number", "Service", "Provider", "Number", "Account name", "Bill amount (NGN)", "Service fee (NGN)", "Total paid (NGN)", "Status"];
  const lines = [head.map(csvCell).join(",")];
  for (const r of s.rows) lines.push([r.date, r.time, r.orderNo, r.service, r.provider, r.number, r.name, plain(r.bill), plain(r.fee), plain(r.total), r.statusText].map(csvCell).join(","));
  lines.push("");
  lines.push(["", "", "", "", "", "", "Delivered orders total", plain(s.delivered.bill), plain(s.delivered.fee), plain(s.delivered.total), `${s.delivered.count} orders`].map(csvCell).join(","));
  if (s.refunded.count) lines.push(["", "", "", "", "", "", "Refunded (not counted above)", "", "", plain(s.refunded.total), `${s.refunded.count} orders`].map(csvCell).join(","));
  return "﻿" + lines.join("\r\n") + "\r\n"; // BOM so Excel reads the file as UTF-8
}

// ───────── PDF ─────────
const NIGHT = rgb(0x0b / 255, 0x10 / 255, 0x26 / 255), AMBER = rgb(1, 0xb6 / 255, 0x27 / 255), PAPER = rgb(0xf5 / 255, 0xf2 / 255, 0xe9 / 255);
const INK = rgb(0.1, 0.12, 0.2), MUTE = rgb(0.4, 0.43, 0.52), LINE = rgb(0.86, 0.87, 0.9), BAD = rgb(0.75, 0.2, 0.2);
const W = 595.28, H = 841.89, M = 40;
const COLS = [
  { k: "date", t: "Date", x: M, w: 58, right: false },
  { k: "orderNo", t: "Order", x: M + 58, w: 58, right: false },
  { k: "service", t: "Service", x: M + 116, w: 150, right: false },
  { k: "number", t: "Number", x: M + 266, w: 95, right: false },
  { k: "total", t: "Total (NGN)", x: M + 361, w: 78, right: true },
  { k: "statusShort", t: "Status", x: M + 449, w: 66, right: false },
] as const;

function fit(font: PDFFont, text: string, size: number, maxW: number): string {
  let t = winSafe(text);
  if (font.widthOfTextAtSize(t, size) <= maxW) return t;
  while (t.length > 1 && font.widthOfTextAtSize(t + "...", size) > maxW) t = t.slice(0, -1);
  return t + "...";
}

export async function statementPdf(s: Statement, generatedAt = new Date()): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${ISSUER.trading} statement ${s.label}`); pdf.setAuthor(ISSUER.company);
  const reg = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let page: PDFPage = pdf.addPage([W, H]); let y = H;
  const gen = generatedAt.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Lagos" });

  const tableHead = () => {
    page.drawRectangle({ x: M, y: y - 16, width: W - 2 * M, height: 16, color: rgb(0.95, 0.95, 0.97) });
    for (const c of COLS) {
      const t = c.t, tw = bold.widthOfTextAtSize(t, 8);
      page.drawText(t, { x: c.right ? c.x + c.w - tw : c.x + 3, y: y - 11, size: 8, font: bold, color: MUTE });
    }
    y -= 20;
  };
  const firstPage = () => {
    page.drawRectangle({ x: 0, y: H - 92, width: W, height: 92, color: NIGHT });
    page.drawRectangle({ x: 0, y: H - 95, width: W, height: 3, color: AMBER });
    page.drawText(winSafe(ISSUER.trading), { x: M, y: H - 44, size: 24, font: bold, color: PAPER });
    page.drawText("Account statement", { x: M, y: H - 66, size: 11, font: reg, color: AMBER });
    const r = winSafe(`${ISSUER.company}, ${ISSUER.address}`); page.drawText(r, { x: W - M - reg.widthOfTextAtSize(r, 8), y: H - 42, size: 8, font: reg, color: PAPER });
    const e = winSafe(ISSUER.email); page.drawText(e, { x: W - M - reg.widthOfTextAtSize(e, 8), y: H - 54, size: 8, font: reg, color: PAPER });
    y = H - 122;
    page.drawText(winSafe(s.label), { x: M, y, size: 17, font: bold, color: INK }); y -= 18;
    page.drawText(fit(reg, `For ${s.email}`, 10, W - 2 * M), { x: M, y, size: 10, font: reg, color: MUTE }); y -= 13;
    page.drawText(`Prepared ${gen}. All times and months are Nigerian time (WAT).`, { x: M, y, size: 8.5, font: reg, color: MUTE }); y -= 22;
  };
  firstPage(); tableHead();

  if (!s.rows.length) { page.drawText("No orders this month.", { x: M + 3, y: y - 8, size: 10, font: reg, color: MUTE }); y -= 26; }
  for (const r of s.rows) {
    if (y < 150) { page = pdf.addPage([W, H]); y = H - M; tableHead(); }
    const refunded = r.status === "failed_refunded";
    for (const c of COLS) {
      let text = c.k === "total" ? money(r.total).replace("NGN ", "") : c.k === "service" ? `${r.service}: ${r.provider.replace(/\s*(PREPAID|POSTPAID)$/i, "")}` : String((r as any)[c.k] ?? "");
      text = fit(reg, text, 8.5, c.w - 5);
      const tw = reg.widthOfTextAtSize(text, 8.5);
      page.drawText(text, { x: c.right ? c.x + c.w - tw : c.x + 3, y: y - 10, size: 8.5, font: reg, color: refunded && c.k !== "date" ? BAD : INK });
    }
    page.drawLine({ start: { x: M, y: y - 14 }, end: { x: W - M, y: y - 14 }, thickness: 0.5, color: LINE });
    y -= 16;
  }

  // Totals (always kept together on one page)
  if (y < 150) { page = pdf.addPage([W, H]); y = H - M; }
  y -= 14;
  const line = (label: string, val: string, strong = false) => {
    page.drawText(label, { x: M + 250, y, size: strong ? 10.5 : 9.5, font: strong ? bold : reg, color: INK });
    const f = strong ? bold : reg, sz = strong ? 10.5 : 9.5;
    page.drawText(val, { x: W - M - f.widthOfTextAtSize(val, sz), y, size: sz, font: f, color: INK }); y -= strong ? 17 : 14;
  };
  line("Delivered orders", `${s.delivered.count}`);
  line("Bills paid", money(s.delivered.bill));
  line("Service fees", money(s.delivered.fee));
  line("Total paid, delivered orders", money(s.delivered.total), true);
  if (s.refunded.count) { y -= 2; line(`Refunded (${s.refunded.count}, not counted above)`, money(s.refunded.total)); }
  if (s.inProgress) line("Still being delivered", `${s.inProgress}`);
  y -= 10;
  page.drawText("This is a record of your payments to Nolgic, not a tax invoice. Meter tokens and PINs are not shown here.", { x: M, y, size: 8, font: reg, color: MUTE });

  pdf.getPages().forEach((p, i, all) => p.drawText(`Page ${i + 1} of ${all.length}`, { x: W - M - 50, y: 22, size: 8, font: reg, color: MUTE }));
  return pdf.save();
}
