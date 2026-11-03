// Branded PDF reports (Nolgic: night navy + amber, letterhead of the operating company). Built with pdf-lib, which needs no
// files or fonts on the server. The standard PDF fonts cannot draw the naira sign, so amounts print as "NGN 1,234.00".

import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from "pdf-lib";
import { productLabel, Report, watDay } from "@/lib/finance";

const NIGHT = rgb(0x0b / 255, 0x10 / 255, 0x26 / 255);
const AMBER = rgb(1, 0xb6 / 255, 0x27 / 255);
const PAPER = rgb(0xf5 / 255, 0xf2 / 255, 0xe9 / 255);
const HAZE = rgb(0x9a / 255, 0xa3 / 255, 0xc7 / 255);
const INK = rgb(0.1, 0.12, 0.2);
const MUTE = rgb(0.4, 0.43, 0.52);
const LINE = rgb(0.86, 0.87, 0.9);
const BAD = rgb(0.75, 0.2, 0.2);
const OK = rgb(0.1, 0.5, 0.32);

const W = 595.28, H = 841.89, M = 44;

/** Standard PDF fonts only carry Latin-1 plus a few punctuation marks; anything else becomes "?" instead of crashing. */
export function winSafe(s: unknown): string {
  return String(s ?? "")
    .replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/…/g, "...").replace(/[–—]/g, "-")
    .replace(/₦/g, "NGN ").replace(/ /g, " ")
    .replace(/[^\x20-\x7E¡-ÿ]/g, "?");
}

export const money = (v: number) => {
  const neg = v < 0; const abs = Math.abs(v);
  const [i, d] = abs.toFixed(2).split(".");
  return `${neg ? "-" : ""}NGN ${i.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${d}`;
};
const longDate = (ymd: string) => new Date(`${ymd}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

class Doc {
  pdf!: PDFDocument; reg!: PDFFont; bold!: PDFFont; page!: PDFPage; y = 0; first = true;
  constructor(private r: Report, private title: string) {}
  async init() {
    this.pdf = await PDFDocument.create();
    this.pdf.setTitle(`${this.r.settings.business.trading} - ${this.title}`);
    this.pdf.setAuthor(this.r.settings.business.name);
    this.reg = await this.pdf.embedFont(StandardFonts.Helvetica);
    this.bold = await this.pdf.embedFont(StandardFonts.HelveticaBold);
    this.newPage();
  }
  logo(x: number, top: number, size: number) {
    const sc = size / 64;
    // the Nolgic mark: a dial with a wave in it
    this.page.drawCircle({ x: x + 32 * sc, y: top - 32 * sc, size: 15 * sc, borderColor: AMBER, borderWidth: 7.5 * sc, opacity: 0, borderOpacity: 1 });
    this.page.drawSvgPath("M25 32 q3.5 -5 7 0 t7 0", { x, y: top, scale: sc, borderColor: AMBER, borderWidth: 3 * sc, borderLineCap: 1 as any });
  }
  newPage() {
    this.page = this.pdf.addPage([W, H]);
    const b = this.r.settings.business;
    if (this.first) {
      this.page.drawRectangle({ x: 0, y: H - 112, width: W, height: 112, color: NIGHT });
      this.logo(M, H - 30, 40);
      this.page.drawText(winSafe(b.trading.toLowerCase()), { x: M + 50, y: H - 62, size: 28, font: this.bold, color: PAPER });
      this.page.drawText(winSafe(`${b.name}  |  ${b.address}`), { x: M, y: H - 92, size: 9, font: this.reg, color: HAZE });
      const t = winSafe(this.title); const tw = this.bold.widthOfTextAtSize(t, 14);
      this.page.drawText(t, { x: W - M - tw, y: H - 56, size: 14, font: this.bold, color: AMBER });
      const sub = winSafe(`${longDate(this.r.period.from)} to ${longDate(this.r.period.to)}`); const sw = this.reg.widthOfTextAtSize(sub, 10);
      this.page.drawText(sub, { x: W - M - sw, y: H - 74, size: 10, font: this.reg, color: PAPER });
      this.y = H - 112 - 28; this.first = false;
    } else {
      this.page.drawRectangle({ x: 0, y: H - 34, width: W, height: 34, color: NIGHT });
      this.logo(M, H - 8, 18);
      this.page.drawText(winSafe(`${b.trading.toLowerCase()}  |  ${this.title}`), { x: M + 26, y: H - 22, size: 10, font: this.bold, color: PAPER });
      this.y = H - 34 - 28;
    }
  }
  need(h: number) { if (this.y - h < 56) this.newPage(); }
  text(t: string, o: { size?: number; bold?: boolean; color?: any; x?: number; gap?: number; max?: number } = {}) {
    const size = o.size ?? 9.5; const font = o.bold ? this.bold : this.reg; const x = o.x ?? M; const max = o.max ?? W - M - x;
    const words = winSafe(t).split(/\s+/); let line = "";
    const flush = () => { this.need(size + 4); this.page.drawText(line, { x, y: this.y - size, size, font, color: o.color ?? INK }); this.y -= size + 4; line = ""; };
    for (const w of words) {
      const test = line ? `${line} ${w}` : w;
      if (font.widthOfTextAtSize(test, size) > max && line) { flush(); line = w; } else line = test;
    }
    if (line) flush();
    this.y -= o.gap ?? 0;
  }
  heading(t: string) { this.need(40); this.y -= 8; this.page.drawText(winSafe(t), { x: M, y: this.y - 12, size: 12, font: this.bold, color: INK }); this.page.drawRectangle({ x: M, y: this.y - 17, width: 28, height: 2, color: AMBER }); this.y -= 26; }
  cards(items: { label: string; value: string; tone?: "ok" | "bad" }[]) {
    this.need(70); const gap = 10; const w = (W - 2 * M - gap * (items.length - 1)) / items.length;
    items.forEach((it, i) => {
      const x = M + i * (w + gap);
      this.page.drawRectangle({ x, y: this.y - 56, width: w, height: 56, color: rgb(0.965, 0.968, 0.98), borderColor: LINE, borderWidth: 1 });
      this.page.drawText(winSafe(it.label), { x: x + 10, y: this.y - 18, size: 8.5, font: this.reg, color: MUTE });
      this.page.drawText(winSafe(it.value), { x: x + 10, y: this.y - 40, size: 12.5, font: this.bold, color: it.tone === "bad" ? BAD : it.tone === "ok" ? OK : INK });
    });
    this.y -= 72;
  }
  table(cols: { h: string; w: number; right?: boolean }[], rows: string[][], o: { totalRow?: boolean } = {}) {
    const rowH = 18; const total = cols.reduce((a, c) => a + c.w, 0); const scale = (W - 2 * M) / total;
    const xs: number[] = []; let acc = M; for (const c of cols) { xs.push(acc); acc += c.w * scale; }
    const drawHead = () => {
      this.need(rowH * 2); this.page.drawRectangle({ x: M, y: this.y - rowH, width: W - 2 * M, height: rowH, color: NIGHT });
      cols.forEach((c, i) => { const t = winSafe(c.h); const w = this.bold.widthOfTextAtSize(t, 8.5); this.page.drawText(t, { x: c.right ? xs[i] + c.w * scale - w - 6 : xs[i] + 6, y: this.y - 12.5, size: 8.5, font: this.bold, color: PAPER }); });
      this.y -= rowH;
    };
    drawHead();
    rows.forEach((r, ri) => {
      if (this.y - rowH < 56) { this.newPage(); drawHead(); }
      const last = o.totalRow && ri === rows.length - 1;
      if (last) this.page.drawRectangle({ x: M, y: this.y - rowH, width: W - 2 * M, height: rowH, color: rgb(0.965, 0.968, 0.98) });
      this.page.drawLine({ start: { x: M, y: this.y - rowH }, end: { x: W - M, y: this.y - rowH }, thickness: 0.5, color: LINE });
      r.forEach((v, i) => {
        const f = last ? this.bold : this.reg; let t = winSafe(v); const max = cols[i].w * scale - 12;
        while (t.length > 1 && f.widthOfTextAtSize(t, 8.8) > max) t = t.slice(0, -2);
        const w = f.widthOfTextAtSize(t, 8.8);
        this.page.drawText(t, { x: cols[i].right ? xs[i] + cols[i].w * scale - w - 6 : xs[i] + 6, y: this.y - 12.5, size: 8.8, font: f, color: INK });
      });
      this.y -= rowH;
    });
    this.y -= 10;
  }
  async finish(): Promise<Uint8Array> {
    const pages = this.pdf.getPages(); const b = this.r.settings.business;
    const foot = winSafe(`${b.name} | ${b.trading} management report | Generated ${new Date(this.r.generatedAt).toISOString().slice(0, 16).replace("T", " ")} UTC | Confidential`);
    pages.forEach((p, i) => {
      p.drawLine({ start: { x: M, y: 40 }, end: { x: W - M, y: 40 }, thickness: 0.5, color: LINE });
      p.drawText(foot, { x: M, y: 26, size: 7.5, font: this.reg, color: MUTE });
      const pg = `Page ${i + 1} of ${pages.length}`; const w = this.reg.widthOfTextAtSize(pg, 7.5);
      p.drawText(pg, { x: W - M - w, y: 26, size: 7.5, font: this.reg, color: MUTE });
    });
    return this.pdf.save();
  }
}

/** The monthly management report: profit and loss, by product, expenses, VAT, and what to double-check. */
export async function pnlPdf(r: Report): Promise<Uint8Array> {
  const d = new Doc(r, "Profit & Loss");
  await d.init();
  const t = r.totals; const s = r.settings;

  d.cards([
    { label: "Income (fees + commission)", value: money(t.income) },
    { label: "Gross profit", value: money(t.gross), tone: t.gross >= 0 ? "ok" : "bad" },
    { label: "Expenses", value: money(t.expenses) },
    { label: "Net profit", value: money(t.net), tone: t.net >= 0 ? "ok" : "bad" },
  ]);

  d.heading("Income statement");
  d.table([{ h: "", w: 5 }, { h: "NGN", w: 2, right: true }], [
    ["Our service fees", money(t.fees).replace("NGN ", "")],
    ["Provider commission (Paybeta)", money(t.commission).replace("NGN ", "")],
    ["Income", money(t.income).replace("NGN ", "")],
    ["Less: payment processing fees (Flutterwave)", money(-t.processor).replace("NGN ", "")],
    ["Gross profit", money(t.gross).replace("NGN ", "")],
    ["Less: operating expenses", money(-t.expenses).replace("NGN ", "")],
    ...(t.vatDeducted ? [[`Less: VAT included in income (${s.vat.rate}%)`, money(-t.vatDeducted).replace("NGN ", "")]] : []),
    ["Net profit for the period", money(t.net).replace("NGN ", "")],
  ], { totalRow: true });

  d.heading("By product");
  d.table(
    [{ h: "Product", w: 3 }, { h: "Orders", w: 1.2, right: true }, { h: "Our fees", w: 2, right: true }, { h: "Commission", w: 2, right: true }, { h: "Processor", w: 2, right: true }, { h: "Gross profit", w: 2.2, right: true }],
    [...r.products.filter((p) => p.orders > 0).map((p) => [p.label, String(p.orders), money(p.fees).replace("NGN ", ""), money(p.commission).replace("NGN ", ""), money(p.processor).replace("NGN ", ""), money(p.gross).replace("NGN ", "")]),
      ["Total", String(t.orders), money(t.fees).replace("NGN ", ""), money(t.commission).replace("NGN ", ""), money(t.processor).replace("NGN ", ""), money(t.gross).replace("NGN ", "")]],
    { totalRow: true });

  d.heading("Customers' money passing through");
  d.text(`Customers paid ${money(t.collected)} in total. ${money(t.bill)} of that is the cost of the bills, airtime and PINs we bought for them, passed on to the providers. It is not our revenue. The other ${money(t.fees)} is our service fee, which is counted above.`, { gap: 4 });

  if (r.expensesByCategory.length) {
    d.heading("Expenses by category");
    d.table([{ h: "Category", w: 4 }, { h: "Amount", w: 2, right: true }, { h: "of which VAT", w: 2, right: true }],
      [...r.expensesByCategory.map((c) => [c.category, money(c.amount).replace("NGN ", ""), money(c.vat).replace("NGN ", "")]), ["Total", money(t.expenses).replace("NGN ", ""), money(r.expensesByCategory.reduce((a, c) => a + c.vat, 0)).replace("NGN ", "")]],
      { totalRow: true });
  }

  d.heading("Tax and VAT");
  d.text(s.vat.registered
    ? `VAT-registered at ${s.vat.rate}%. Income of ${money(t.income)} ${s.vat.inclusive ? "includes" : "excludes"} VAT; the VAT element is ${money(t.vatOnIncome)}. Input VAT on expenses recorded this period: ${money(r.expensesByCategory.reduce((a, c) => a + c.vat, 0))}.`
    : `Not VAT-registered in these records. If registration applies, VAT at ${s.vat.rate}% on this period's income would be about ${money(t.vatOnIncome)} (assuming fees are VAT-inclusive). Confirm your position with your accountant.`, { gap: 4 });

  if (r.refunds.count || r.attention.needsReview || r.attention.refundFailed || r.attention.stuckPaid) {
    d.heading("Refunds and open items");
    d.text(`${r.refunds.count} ${r.refunds.count === 1 ? "order was" : "orders were"} refunded or awaiting a refund in this period, worth ${money(r.refunds.bill)} to customers. Open now: ${r.attention.needsReview} held for review, ${r.attention.refundFailed} with a failed refund, ${r.attention.stuckPaid} paid but not delivered for over 10 minutes.`, { gap: 4 });
  }

  d.heading("Basis of preparation");
  const c = s.commission;
  d.text(`Management figures from Nolgic's own order records, in Nigerian naira, using Nigeria time (WAT) for dates. Test orders are excluded. Only delivered orders count as income. Refunded orders earn nothing.`);
  d.text(`Provider commission is calculated at the rates set in Finance settings (airtime ${c.airtime_pct}%, data ${c.data_pct}%, TV ${c.tv_pct}%, electricity ${c.electricity_pct}%, exam PINs ${c.exam_pct}%, JAMB flat NGN ${c.jamb_flat}); bulk airtime uses the amount Paybeta actually took from the wallet. Check these against the Paybeta statement. Processing fees: ${r.notes.processorActual} order(s) use the real Flutterwave charge, ${r.notes.processorEstimated} use an estimate of ${s.processor.pct}% capped at NGN ${s.processor.cap}.`);
  d.text(`These are unaudited management accounts for internal use and are not tax advice. Wallet top-ups to Paybeta are funding, not expenses.`);
  if (s.business.tin) d.text(`Tax ID: ${s.business.tin}`);

  return d.finish();
}
