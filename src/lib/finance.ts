// Nolgic finance engine. Reads orders, bulk batches and expenses and works out what the business really earned.
// Nothing here is on the payment path: it only reads orders (and the admin "Sync" fills in two money columns).
//
// Money words used everywhere:
//   bill value   what the customer's bill/airtime/PIN costs. It passes through us to the provider. NOT our revenue.
//   fee          our service fee on top (orders.service_fee_local).
//   commission   what Paybeta pays us on the sale. Calculated from the rates in Settings until the Paybeta statement confirms them.
//   income       fee + commission (our real revenue).
//   processor    Flutterwave's charge. Real figure once Synced, estimate before that.
//   gross profit income - processor fees.
//   net profit   gross profit - expenses (and - VAT on income, if the business is VAT-registered).

import { supabaseAdmin } from "@/lib/supabase";

export type ProductKey = "electricity" | "tv" | "airtime" | "data" | "exams" | "bulk";
export const PRODUCTS: { key: ProductKey; label: string }[] = [
  { key: "electricity", label: "Electricity" },
  { key: "tv", label: "TV subscriptions" },
  { key: "airtime", label: "Airtime" },
  { key: "data", label: "Data bundles" },
  { key: "exams", label: "Exam PINs" },
  { key: "bulk", label: "Bulk airtime" },
];
export const productLabel = (k: string) => PRODUCTS.find((p) => p.key === k)?.label ?? k;

export type Settings = {
  commission: { airtime_pct: number; data_pct: number; tv_pct: number; electricity_pct: number; exam_pct: number; jamb_flat: number };
  processor: { pct: number; cap: number };
  vat: { registered: boolean; rate: number; inclusive: boolean };
  business: { name: string; trading: string; address: string; email: string; tin: string };
};

// Starting points from Paybeta's published ranges. They are ESTIMATES: check them against your Paybeta statement and edit in Settings.
export const DEFAULT_SETTINGS: Settings = {
  commission: { airtime_pct: 2.5, data_pct: 3, tv_pct: 1.5, electricity_pct: 0.8, exam_pct: 0, jamb_flat: 150 },
  processor: { pct: 1.4, cap: 2000 },
  vat: { registered: false, rate: 7.5, inclusive: true },
  business: { name: "The 36th Solutions Ltd", trading: "Nolgic", address: "Abuja, Nigeria", email: "nolgichq@gmail.com", tin: "" },
};

const n = (v: unknown) => Number(v ?? 0) || 0;
const r2 = (v: number) => Math.round(v * 100) / 100;

export type OrderRow = {
  id: string; created_at: string; status: string; email: string | null;
  biller_code: string | null; item_code: string | null; biller_name: string | null;
  amount_ngn: number | string | null; service_fee_local: number | string | null;
  payment_provider: string | null; currency: string | null; flw_pay_id: string | null; error: string | null;
  commission_ngn?: number | string | null; processor_fee_ngn?: number | string | null; econ_at?: string | null;
};

export function productOf(o: { biller_code?: string | null; item_code?: string | null; biller_name?: string | null }): ProductKey {
  const code = String(o.biller_code ?? "");
  const item = String(o.item_code ?? "").toLowerCase();
  if (/^(jamb|waec|neco|nabteb)([_-]|$)/i.test(code)) return "exams";
  if (item === "airtime" || /[_-]vtu$/i.test(code)) return "airtime";
  if (item === "prepaid" || item === "postpaid" || /ELECTRIC|DISCO/i.test(String(o.biller_name ?? ""))) return "electricity";
  if (/[_-]data$/i.test(code)) return "data";
  return "tv";
}

export function estimateCommission(s: Settings, product: ProductKey, bill: number, code?: string | null): number {
  const c = s.commission;
  if (product === "exams") return /^jamb/i.test(String(code ?? "")) ? c.jamb_flat : r2((bill * c.exam_pct) / 100);
  const pct = { electricity: c.electricity_pct, tv: c.tv_pct, airtime: c.airtime_pct, data: c.data_pct, bulk: c.airtime_pct }[product];
  return r2((bill * pct) / 100);
}
export const estimateProcessorFee = (s: Settings, total: number) => r2(Math.min(s.processor.cap, (total * s.processor.pct) / 100));

export type Econ = {
  id: string; at: string; product: ProductKey; item: string; email: string | null;
  bill: number; fee: number; commission: number; processor: number; income: number; gross: number; processorActual: boolean;
};

export function econOfOrder(o: OrderRow, s: Settings): Econ {
  const bill = n(o.amount_ngn); const fee = n(o.service_fee_local);
  const product = productOf(o);
  const commission = o.commission_ngn != null ? n(o.commission_ngn) : estimateCommission(s, product, bill, o.biller_code);
  const processorActual = o.processor_fee_ngn != null;
  const processor = processorActual ? n(o.processor_fee_ngn) : estimateProcessorFee(s, bill + fee);
  return { id: o.id, at: o.created_at, product, item: o.biller_name ?? "", email: o.email, bill, fee, commission, processor, income: r2(fee + commission), gross: r2(fee + commission - processor), processorActual };
}

export type BulkRow = {
  id: string; created_at: string; status: string; email: string | null; amount_total: number | string; service_fee: number | string;
  delivered_ngn: number | string | null; refunded_ngn: number | string | null; pb_charged: number | string | null;
  processor_fee_ngn?: number | string | null; flw_pay_id: string | null; recipients_count: number | null; settled_at: string | null;
};

export function econOfBulk(b: BulkRow, s: Settings): Econ {
  const bill = n(b.delivered_ngn); const fee = n(b.service_fee);
  // Paybeta tells us what it took from our wallet: the gap to what was delivered is our real commission.
  const commission = b.pb_charged != null && n(b.pb_charged) > 0 ? r2(Math.max(0, bill - n(b.pb_charged))) : estimateCommission(s, "bulk", bill);
  const processorActual = b.processor_fee_ngn != null;
  const processor = processorActual ? n(b.processor_fee_ngn) : estimateProcessorFee(s, n(b.amount_total) + fee);
  return { id: b.id, at: b.settled_at ?? b.created_at, product: "bulk", item: `Bulk airtime (${b.recipients_count ?? "?"} numbers)`, email: b.email, bill, fee, commission, processor, income: r2(fee + commission), gross: r2(fee + commission - processor), processorActual };
}

export type ExpenseRow = { id: string; spent_on: string; category: string; vendor: string | null; description: string | null; amount_ngn: number | string; vat_ngn: number | string; receipt_ref: string | null };
export const EXPENSE_CATEGORIES = ["Hosting & infrastructure", "Software & subscriptions", "Payment & bank charges", "Marketing", "Legal & accounting", "Licences & registration", "Staff & contractors", "Equipment", "Other"];

// ───────── dates (Nigeria time, WAT = UTC+1, so a "day" matches the books and the bank) ─────────
const WAT = "+01:00";
export const dayStartIso = (ymd: string) => new Date(`${ymd}T00:00:00${WAT}`).toISOString();
export const dayAfterIso = (ymd: string) => new Date(new Date(`${ymd}T00:00:00${WAT}`).getTime() + 86400_000).toISOString();
export const watDay = (iso: string) => new Date(new Date(iso).getTime() + 3600_000).toISOString().slice(0, 10);
export const validYmd = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(`${s}T00:00:00Z`).getTime());

// ───────── database ─────────
export async function loadSettings(): Promise<{ settings: Settings; saved: boolean; tableMissing: boolean }> {
  try {
    const { data, error } = await supabaseAdmin().from("finance_settings").select("value").eq("key", "main").maybeSingle();
    if (error) return { settings: DEFAULT_SETTINGS, saved: false, tableMissing: true };
    return { settings: mergeSettings(data?.value), saved: !!data, tableMissing: false };
  } catch { return { settings: DEFAULT_SETTINGS, saved: false, tableMissing: true }; }
}

export function mergeSettings(v: any): Settings {
  const d = DEFAULT_SETTINGS;
  const num = (x: unknown, dflt: number, max = 1e9) => { const k = Number(x); return Number.isFinite(k) && k >= 0 && k <= max ? k : dflt; };
  const str = (x: unknown, dflt: string, max = 160) => (typeof x === "string" && x.trim() ? x.trim().slice(0, max) : dflt);
  const c = v?.commission ?? {}; const p = v?.processor ?? {}; const t = v?.vat ?? {}; const b = v?.business ?? {};
  return {
    commission: {
      airtime_pct: num(c.airtime_pct, d.commission.airtime_pct, 50), data_pct: num(c.data_pct, d.commission.data_pct, 50),
      tv_pct: num(c.tv_pct, d.commission.tv_pct, 50), electricity_pct: num(c.electricity_pct, d.commission.electricity_pct, 50),
      exam_pct: num(c.exam_pct, d.commission.exam_pct, 50), jamb_flat: num(c.jamb_flat, d.commission.jamb_flat, 100000),
    },
    processor: { pct: num(p.pct, d.processor.pct, 20), cap: num(p.cap, d.processor.cap, 1e6) },
    vat: { registered: typeof t.registered === "boolean" ? t.registered : d.vat.registered, rate: num(t.rate, d.vat.rate, 50), inclusive: typeof t.inclusive === "boolean" ? t.inclusive : d.vat.inclusive },
    business: { name: str(b.name, d.business.name), trading: str(b.trading, d.business.trading), address: str(b.address, d.business.address, 240), email: str(b.email, d.business.email), tin: typeof b.tin === "string" ? b.tin.trim().slice(0, 40) : "" },
  };
}

export async function logAudit(req: Request | null, action: string, target: string | null, detail: unknown) {
  try {
    const ip = req ? (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || req.headers.get("x-real-ip") || null : null;
    await supabaseAdmin().from("admin_audit").insert({ action, target, detail: detail ?? null, ip });
  } catch (e) { console.error("[finance] audit log failed", (e as any)?.message ?? e); }
}

const ORDER_COLS = "id,created_at,status,email,biller_code,item_code,biller_name,amount_ngn,service_fee_local,payment_provider,currency,flw_pay_id,error";
const ORDER_COLS_ECON = `${ORDER_COLS},commission_ngn,processor_fee_ngn,econ_at`;

async function pageAll<T>(build: (from: number, to: number) => PromiseLike<{ data: any; error: any }>, maxPages = 20): Promise<T[]> {
  const out: T[] = [];
  for (let p = 0; p < maxPages; p++) {
    const { data, error } = await build(p * 1000, p * 1000 + 999);
    if (error) throw error;
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}

/** Real (non-test) orders created in [from, to] (Nigeria days). Works before migration 0020 is run (no money columns then). */
export async function fetchOrders(from: string, to: string, includeTest = false): Promise<{ rows: OrderRow[]; econColumns: boolean }> {
  const db = supabaseAdmin();
  const run = async (cols: string, useTest: boolean) =>
    pageAll<OrderRow>((a, b) => {
      let q = db.from("orders").select(cols).gte("created_at", dayStartIso(from)).lt("created_at", dayAfterIso(to));
      if (useTest) q = q.eq("is_test", false);
      return q.order("created_at", { ascending: false }).range(a, b);
    });
  let cols = ORDER_COLS_ECON; let econ = true; let useTest = !includeTest;
  for (let attempt = 0; attempt < 3; attempt++) {
    try { return { rows: await run(cols, useTest), econColumns: econ }; }
    catch (e: any) {
      const m = String(e?.message ?? "");
      if (econ && /commission_ngn|processor_fee_ngn|econ_at/.test(m)) { cols = ORDER_COLS; econ = false; continue; }
      if (useTest && /is_test/.test(m)) { useTest = false; continue; }
      throw e;
    }
  }
  return { rows: await run(ORDER_COLS, false), econColumns: false };
}

export async function fetchBulk(from: string, to: string, includeTest = false): Promise<BulkRow[]> {
  const db = supabaseAdmin();
  const cols = "id,created_at,status,email,amount_total,service_fee,delivered_ngn,refunded_ngn,pb_charged,processor_fee_ngn,flw_pay_id,recipients_count,settled_at";
  const run = (c: string, useTest: boolean) => pageAll<BulkRow>((a, b) => {
    let q = db.from("bulk_orders").select(c).gte("created_at", dayStartIso(from)).lt("created_at", dayAfterIso(to));
    if (useTest) q = q.eq("is_test", false);
    return q.order("created_at", { ascending: false }).range(a, b);
  });
  try { return await run(cols, !includeTest); }
  catch (e: any) {
    const m = String(e?.message ?? "");
    try {
      if (/processor_fee_ngn/.test(m)) return await run(cols.replace(",processor_fee_ngn", ""), !includeTest);
      return []; // bulk tables not created yet
    } catch { return []; }
  }
}

export async function fetchExpenses(from: string, to: string): Promise<{ rows: ExpenseRow[]; tableMissing: boolean }> {
  try {
    const rows = await pageAll<ExpenseRow>((a, b) =>
      supabaseAdmin().from("expenses").select("id,spent_on,category,vendor,description,amount_ngn,vat_ngn,receipt_ref").gte("spent_on", from).lte("spent_on", to).order("spent_on", { ascending: false }).range(a, b));
    return { rows, tableMissing: false };
  } catch { return { rows: [], tableMissing: true }; }
}

// ───────── the report ─────────
export type ProductLine = { key: ProductKey; label: string; orders: number; bill: number; fees: number; commission: number; processor: number; gross: number };
export type Report = {
  period: { from: string; to: string };
  generatedAt: string;
  settings: Settings;
  notes: { settingsSaved: boolean; financeTablesMissing: boolean; econColumns: boolean; processorEstimated: number; processorActual: number };
  products: ProductLine[];
  totals: { orders: number; bill: number; collected: number; fees: number; commission: number; income: number; processor: number; gross: number; expenses: number; vatOnIncome: number; vatDeducted: number; net: number; avgGrossPerOrder: number };
  daily: { day: string; orders: number; income: number; gross: number }[];
  expensesByCategory: { category: string; amount: number; vat: number }[];
  expenses: ExpenseRow[];
  customers: { unique: number; repeat: number };
  attention: { needsReview: number; refundFailed: number; stuckPaid: number };
  refunds: { count: number; bill: number; rows: { id: string; at: string; item: string; amount: number; status: string; error: string | null }[] };
  ledger: Econ[];
};

export function buildReport(args: {
  from: string; to: string; settings: Settings; settingsSaved: boolean; financeTablesMissing: boolean; econColumns: boolean;
  orders: OrderRow[]; bulk: BulkRow[]; expenses: ExpenseRow[]; now?: number;
}): Report {
  const { settings: s } = args; const now = args.now ?? Date.now();
  const fulfilled = args.orders.filter((o) => o.status === "fulfilled");
  const ledger: Econ[] = [
    ...fulfilled.map((o) => econOfOrder(o, s)),
    ...args.bulk.filter((b) => b.status === "settled").map((b) => econOfBulk(b, s)),
  ].sort((a, b) => (a.at < b.at ? 1 : -1));

  const products: ProductLine[] = PRODUCTS.map((p) => {
    const rows = ledger.filter((e) => e.product === p.key);
    const sum = (f: (e: Econ) => number) => r2(rows.reduce((a, e) => a + f(e), 0));
    return { key: p.key, label: p.label, orders: rows.length, bill: sum((e) => e.bill), fees: sum((e) => e.fee), commission: sum((e) => e.commission), processor: sum((e) => e.processor), gross: sum((e) => e.gross) };
  });
  const sumP = (f: (p: ProductLine) => number) => r2(products.reduce((a, p) => a + f(p), 0));
  const income = r2(sumP((p) => p.fees) + sumP((p) => p.commission));
  const processor = sumP((p) => p.processor);
  const gross = r2(income - processor);
  const expensesTotal = r2(args.expenses.reduce((a, e) => a + n(e.amount_ngn), 0));
  const vatOnIncome = s.vat.rate > 0 ? r2(s.vat.inclusive ? (income * s.vat.rate) / (100 + s.vat.rate) : (income * s.vat.rate) / 100) : 0;
  // Exclusive pricing means VAT sits on top of what we keep, so it is not deducted from profit; inclusive means part of the fee is VAT owed.
  const vatDeducted = s.vat.registered && s.vat.inclusive ? vatOnIncome : 0;
  const totalOrders = ledger.length;

  const days = new Map<string, { orders: number; income: number; gross: number }>();
  for (let d = new Date(`${args.from}T00:00:00Z`).getTime(); d <= new Date(`${args.to}T00:00:00Z`).getTime(); d += 86400_000) days.set(new Date(d).toISOString().slice(0, 10), { orders: 0, income: 0, gross: 0 });
  for (const e of ledger) { const k = watDay(e.at); const v = days.get(k); if (v) { v.orders++; v.income = r2(v.income + e.income); v.gross = r2(v.gross + e.gross); } }

  const cat = new Map<string, { amount: number; vat: number }>();
  for (const e of args.expenses) { const v = cat.get(e.category) ?? { amount: 0, vat: 0 }; v.amount = r2(v.amount + n(e.amount_ngn)); v.vat = r2(v.vat + n(e.vat_ngn)); cat.set(e.category, v); }

  const byEmail = new Map<string, number>();
  for (const e of ledger) if (e.email) byEmail.set(e.email.toLowerCase(), (byEmail.get(e.email.toLowerCase()) ?? 0) + 1);

  const refundRows = args.orders.filter((o) => o.status === "failed_refunded" || o.status === "refund_failed")
    .map((o) => ({ id: o.id, at: o.created_at, item: o.biller_name ?? "", amount: n(o.amount_ngn) + n(o.service_fee_local), status: o.status, error: o.error }));

  return {
    period: { from: args.from, to: args.to },
    generatedAt: new Date(now).toISOString(),
    settings: s,
    notes: {
      settingsSaved: args.settingsSaved, financeTablesMissing: args.financeTablesMissing, econColumns: args.econColumns,
      processorEstimated: ledger.filter((e) => !e.processorActual).length, processorActual: ledger.filter((e) => e.processorActual).length,
    },
    products,
    totals: {
      orders: totalOrders, bill: sumP((p) => p.bill), collected: r2(sumP((p) => p.bill) + sumP((p) => p.fees)), fees: sumP((p) => p.fees), commission: sumP((p) => p.commission),
      income, processor, gross, expenses: expensesTotal, vatOnIncome, vatDeducted, net: r2(gross - expensesTotal - vatDeducted),
      avgGrossPerOrder: totalOrders ? r2(gross / totalOrders) : 0,
    },
    daily: Array.from(days.entries()).map(([day, v]) => ({ day, ...v })),
    expensesByCategory: Array.from(cat.entries()).map(([category, v]) => ({ category, ...v })).sort((a, b) => b.amount - a.amount),
    expenses: args.expenses,
    customers: { unique: byEmail.size, repeat: Array.from(byEmail.values()).filter((c) => c > 1).length },
    attention: {
      needsReview: args.orders.filter((o) => o.status === "needs_review").length + args.bulk.filter((b) => b.status === "needs_review").length,
      refundFailed: args.orders.filter((o) => o.status === "refund_failed").length + args.bulk.filter((b) => b.status === "refund_failed").length,
      stuckPaid: args.orders.filter((o) => o.status === "paid" && now - new Date(o.created_at).getTime() > 10 * 60_000).length,
    },
    refunds: { count: refundRows.length, bill: r2(refundRows.reduce((a, r) => a + r.amount, 0)), rows: refundRows },
    ledger,
  };
}

export async function loadReport(from: string, to: string, includeTest = false): Promise<Report> {
  const [{ settings, saved, tableMissing }, { rows, econColumns }, bulk, exp] = await Promise.all([
    loadSettings(), fetchOrders(from, to, includeTest), fetchBulk(from, to, includeTest), fetchExpenses(from, to),
  ]);
  return buildReport({ from, to, settings, settingsSaved: saved, financeTablesMissing: tableMissing || exp.tableMissing, econColumns, orders: rows, bulk, expenses: exp.rows });
}

// ───────── CSV (opens in Excel; a leading =,+,-,@ is neutralised so a customer-typed value can never run as a formula) ─────────
const cell = (v: unknown) => {
  let t = v == null ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(t)) t = `'${t}`;
  return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};
export const toCsv = (header: string[], rows: unknown[][]) => "﻿" + [header, ...rows].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";

export function ledgerCsv(r: Report) {
  return toCsv(["Date (Nigeria)", "Order id", "Product", "Item", "Customer email", "Bill value NGN", "Our fee NGN", "Commission NGN", "Income NGN", "Processor fee NGN", "Processor fee is", "Gross profit NGN"],
    r.ledger.map((e) => [watDay(e.at), e.id, productLabel(e.product), e.item, e.email ?? "", e.bill, e.fee, e.commission, e.income, e.processor, e.processorActual ? "actual" : "estimate", e.gross]));
}
export function pnlCsv(r: Report) {
  const t = r.totals;
  const rows: unknown[][] = [
    ...r.products.map((p) => [p.label, p.orders, p.bill, p.fees, p.commission, p.processor, p.gross]),
    ["TOTAL", t.orders, t.bill, t.fees, t.commission, t.processor, t.gross], [],
    ["Income (fees + commission)", "", "", "", "", "", t.income], ["Processor fees", "", "", "", "", "", -t.processor], ["Gross profit", "", "", "", "", "", t.gross],
    ["Expenses", "", "", "", "", "", -t.expenses], ["VAT deducted", "", "", "", "", "", -t.vatDeducted], ["Net profit", "", "", "", "", "", t.net],
  ];
  return toCsv(["Product", "Orders", "Bill value NGN (pass-through)", "Our fees NGN", "Commission NGN", "Processor fees NGN", "Gross profit NGN"], rows);
}
export const refundsCsv = (r: Report) => toCsv(["Date (Nigeria)", "Order id", "Item", "Amount NGN", "Status", "Reason"], r.refunds.rows.map((x) => [watDay(x.at), x.id, x.item, x.amount, x.status, x.error ?? ""]));
export const expensesCsv = (r: Report) => toCsv(["Date", "Category", "Vendor", "Description", "Amount NGN (VAT included)", "VAT NGN", "Receipt / invoice"], r.expenses.map((e) => [e.spent_on, e.category, e.vendor ?? "", e.description ?? "", n(e.amount_ngn), n(e.vat_ngn), e.receipt_ref ?? ""]));

// ───────── request helpers ─────────
/** ?from=YYYY-MM-DD&to=YYYY-MM-DD in Nigeria days. Missing or invalid means "this month so far". Longest range: 400 days. */
export function periodFrom(url: URL, now = Date.now()): { from: string; to: string } {
  const today = watDay(new Date(now).toISOString());
  let from = url.searchParams.get("from"); let to = url.searchParams.get("to");
  if (!validYmd(from) || !validYmd(to)) { from = `${today.slice(0, 8)}01`; to = today; }
  if (from > to) [from, to] = [to, from];
  const days = (new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86400_000;
  if (days > 400) from = new Date(new Date(`${to}T00:00:00Z`).getTime() - 400 * 86400_000).toISOString().slice(0, 10);
  return { from: from as string, to: to as string };
}
