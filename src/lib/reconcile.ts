// src/lib/reconcile.ts
// Nolgic's daily check, in naira. Read-only: it never writes, refunds or vends.
//
// For one Nigeria day it answers four questions and says plainly when it could not answer one:
//   1. Money in:      every successful Flutterwave / Paystack payment has an order (or bulk batch) that agrees
//                     with it, and every order that says "paid" has a successful payment behind it.
//   2. Goods out:     every fulfilled order is also known to the bills provider (Paybeta / VTpass / Flutterwave).
//   3. Stuck work:    nothing is sitting in paid / needs_review / refund_failed / a half-finished bulk batch.
//   4. What we made:  delivered value, our fees, commission, payment fees and gross profit (the finance engine).
//
// It covers single orders (electricity, TV, airtime, data and exam PINs all live in `orders`) and bulk airtime.
// A quiet day (nothing paid) is reported as quiet, never as "all matched".

import { supabaseAdmin } from "@/lib/supabase";
import { checkBillStatus, activeProvider, providerLabel, getBalance } from "@/lib/bills";
import { flwBase, flwExtraHeaders } from "@/lib/flutterwave";
import { flwPayConfigured, flwPayIsTestMode, flwPayReferenceFor, orderIdFromFlwPayRef, verifyByReference } from "@/lib/flwpay";
import { paystackConfigured, paystackIsTestMode, paystackReferenceFor, verifyTransaction } from "@/lib/paystack";
import { bulkPayRef } from "@/lib/bulk";
import { parsePfmRef } from "@/lib/payforme-shared";
import { buildReport, dayAfterIso, dayStartIso, fetchBulk, loadSettings, validYmd, watDay, productLabel, type BulkRow, type OrderRow, type Report } from "@/lib/finance";

export type Flag = { level: "danger" | "warn"; msg: string };

// Paystack's "customer pays fees" setting adds its card charge on top of the order total. The payment is then
// vended (see paystack-process.ts), so the daily check accepts the same overpayment: at least the expected amount,
// and no more than Paystack's ₦2,000 cap plus ₦1 of rounding. Anything else is still flagged.
export const CARD_CHARGE_CAP_NGN = 2000 + 1;
export function cardChargeOk(expectedNgn: number, paidNgn: number): boolean {
  return paidNgn >= expectedNgn - 0.5 && paidNgn <= expectedNgn + CARD_CHARGE_CAP_NGN + 0.5;
}
export type Check = { name: string; ran: boolean; note: string };

export interface ReconResult {
  date: string;                       // the Nigeria day that was checked
  orders: { total: number; byStatus: Record<string, number> };
  bulk: { total: number; byStatus: Record<string, number> };
  paid: { count: number; ngn: number };               // orders + bulk batches our records say were paid
  received: { flutterwave: number | null; paystack: number | null; ngn: number };  // what the payment providers report
  refunded: { count: number; ngn: number };
  money: { bill: number; fees: number; commission: number; processor: number; gross: number; processorEstimated: boolean };
  products: { label: string; orders: number; bill: number }[];
  wallet: { provider: string; ngn: number | null; low: boolean };
  checks: Check[];
  flags: Flag[];
  verdict: "clear" | "quiet" | "attention";
  ok: boolean;                        // true when there is nothing to look at
}

const ngn = (n: number) => { const v = Math.round(Number(n) * 100) / 100; return `₦${Number.isInteger(v) ? v.toLocaleString("en-NG") : v.toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; };
const num = (v: unknown) => Number(v ?? 0) || 0;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const short = (id: string) => String(id).slice(0, 8);

/** Yesterday in Nigeria (WAT). The cron runs after 08:00 UTC, which is after Nigeria's midnight, so that day is complete. */
export function yesterdayWAT(now = Date.now()): string {
  return watDay(new Date(now - 24 * 3600_000).toISOString());
}

// Statuses in which a customer's money has definitely been received.
const ORDER_PAID = new Set(["paid", "processing", "fulfilled", "needs_review", "failed_refunded", "refund_failed"]);
const BULK_PAID = new Set(["paid", "processing", "settling", "settled", "needs_review", "refund_failed"]);

// ───────── payment providers: list successful payments in a window ─────────
type ProviderTx = { ref: string; ngn: number; at: string; currency: string };
type Listing = { ok: true; txs: ProviderTx[] } | { ok: false; error: string };

async function getJson(url: string, headers: Record<string, string>): Promise<any> {
  const res = await fetch(url, { headers, cache: "no-store", signal: AbortSignal.timeout(20_000), redirect: "manual" });
  const text = await res.text();
  let body: any = null;
  try { body = JSON.parse(text); } catch { /* not JSON */ }
  if (!res.ok || !body) throw new Error(`HTTP ${res.status}`);
  return body;
}

async function listFlutterwave(fromIso: string, toIso: string): Promise<Listing> {
  try {
    const key = (process.env.FLW_SECRET_KEY ?? "").trim();
    const from = fromIso.slice(0, 10), to = toIso.slice(0, 10);
    const txs: ProviderTx[] = [];
    for (let page = 1; page <= 20; page++) {
      const b = await getJson(`${flwBase()}/transactions?from=${from}&to=${to}&status=successful&currency=NGN&page=${page}`, { Authorization: `Bearer ${key}`, Accept: "application/json", ...flwExtraHeaders() });
      for (const t of b?.data ?? []) txs.push({ ref: String(t.tx_ref ?? ""), ngn: num(t.amount), at: String(t.created_at ?? ""), currency: String(t.currency ?? "").toUpperCase() });
      const pi = b?.meta?.page_info;
      if (!pi || page >= num(pi.total_pages)) break;
    }
    return { ok: true, txs };
  } catch (e: any) { return { ok: false, error: String(e?.message ?? e).slice(0, 80) }; }
}

async function listPaystack(fromIso: string, toIso: string): Promise<Listing> {
  try {
    const key = (process.env.PAYSTACK_SECRET_KEY ?? "").trim();
    const txs: ProviderTx[] = [];
    for (let page = 1; page <= 20; page++) {
      const b = await getJson(`https://api.paystack.co/transaction?status=success&perPage=100&page=${page}&from=${encodeURIComponent(fromIso)}&to=${encodeURIComponent(toIso)}`, { Authorization: `Bearer ${key}` });
      for (const t of b?.data ?? []) txs.push({ ref: String(t.reference ?? ""), ngn: num(t.amount) / 100, at: String(t.paid_at ?? t.created_at ?? ""), currency: String(t.currency ?? "").toUpperCase() });
      if (!b?.meta || page >= num(b.meta.pageCount)) break;
    }
    return { ok: true, txs };
  } catch (e: any) { return { ok: false, error: String(e?.message ?? e).slice(0, 80) }; }
}

/** Individual lookup, used when a payment is not in the list (late settlement, list lag). Returns the amount if successful. */
async function verifyOne(provider: "flutterwave" | "paystack", ref: string): Promise<{ state: "paid"; ngn: number } | { state: "unpaid" } | { state: "unknown" }> {
  try {
    if (provider === "flutterwave") {
      const tx = await verifyByReference(ref);
      return tx.status === "successful" && tx.currency === "NGN" ? { state: "paid", ngn: tx.amount } : { state: "unpaid" };
    }
    const tx = await verifyTransaction(ref);
    return tx.status === "success" && tx.currency === "NGN" ? { state: "paid", ngn: tx.amountKobo / 100 } : { state: "unpaid" };
  } catch (e: any) {
    // "no such transaction" is an answer (unpaid); a network error is not.
    const m = String(e?.message ?? "");
    return /not found|no transaction|invalid|404/i.test(m) || e?.http === 404 ? { state: "unpaid" } : { state: "unknown" };
  }
}

async function pool<T>(items: T[], limit: number, fn: (x: T) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => { while (i < items.length) { const x = items[i++]; await fn(x); } }));
}

// ───────── our records ─────────
async function readOrders(from: string, to: string, includeTest = false): Promise<any[]> {
  const db = supabaseAdmin();
  const run = async (useTest: boolean) => {
    const out: any[] = [];
    for (let p = 0; p < 20; p++) {
      let q = db.from("orders").select("*").gte("created_at", dayStartIso(from)).lt("created_at", dayAfterIso(to));
      if (useTest) q = q.eq("is_test", false);
      const { data, error } = await q.order("created_at", { ascending: true }).range(p * 1000, p * 1000 + 999);
      if (error) throw error;
      out.push(...(data ?? []));
      if (!data || data.length < 1000) break;
    }
    return out;
  };
  try { return await run(!includeTest); }
  catch (e: any) { if (/is_test/.test(String(e?.message ?? ""))) return run(false); throw e; }
}

// ───────── the check ─────────
export async function runReconcile(dateStr: string = yesterdayWAT(), deep = true, now = Date.now()): Promise<ReconResult> {
  if (!validYmd(dateStr)) throw new Error(`Bad date: ${dateStr}`);
  const db = supabaseAdmin();
  const flags: Flag[] = [];
  const checks: Check[] = [];
  const startMs = new Date(dayStartIso(dateStr)).getTime();
  const endMs = new Date(dayAfterIso(dateStr)).getTime();
  const inDay = (iso: string) => { const t = new Date(iso).getTime(); return Number.isFinite(t) && t >= startMs && t < endMs; };

  const [orders, bulk, settingsInfo] = await Promise.all([
    readOrders(dateStr, dateStr),
    fetchBulk(dateStr, dateStr),
    loadSettings(),
  ]);
  // Old pounds-era orders (Stripe) are not part of the naira check.
  const naira = orders.filter((o) => (o.payment_provider ?? "stripe") !== "stripe");
  const byStatus = (rows: { status: string }[]) => rows.reduce<Record<string, number>>((a, r) => { a[r.status] = (a[r.status] ?? 0) + 1; return a; }, {});
  checks.push({ name: "Orders and bulk batches", ran: true, note: `${naira.length} order${naira.length === 1 ? "" : "s"}, ${bulk.length} bulk batch${bulk.length === 1 ? "" : "es"} read` });

  // What each of our records expects from the payment side.
  type Expect = { kind: "order" | "bulk" | "pfm"; id: string; provider: "flutterwave" | "paystack"; ref: string; ngn: number; status: string; paidExpected: boolean; label: string };
  const expects: Expect[] = [];
  for (const o of naira.filter((x) => !x.pay_request_id)) { // items of a "Pay for Me" request share ONE payment: matched below
    const provider = o.payment_provider === "flutterwave" ? "flutterwave" : "paystack";
    expects.push({ kind: "order", id: o.id, provider, ref: provider === "flutterwave" ? flwPayReferenceFor(o.id) : paystackReferenceFor(o.id), ngn: num(o.amount_ngn) + num(o.service_fee_local), status: o.status, paidExpected: ORDER_PAID.has(o.status), label: `order ${short(o.id)} (${o.biller_name ?? "?"} ${ngn(num(o.amount_ngn))})` });
  }
  for (const b of bulk) expects.push({ kind: "bulk", id: b.id, provider: b.payment_provider === "paystack" ? "paystack" : "flutterwave", ref: bulkPayRef(b), ngn: num(b.amount_total) + num(b.service_fee), status: b.status, paidExpected: BULK_PAID.has(b.status), label: `bulk batch ${short(b.id)} (${b.recipients_count ?? "?"} numbers, ${ngn(num(b.amount_total))})` });

  // "Pay for Me": one payment covers a whole request, so it is matched to the request, not to its item orders.
  const PFM_PAID = new Set(["paid", "settled", "needs_review"]);
  let pfmCount = 0;
  try {
    const { data: reqs, error: pErr } = await db.from("pay_requests").select("*").gte("created_at", dayStartIso(dateStr)).lt("created_at", dayAfterIso(dateStr)).limit(500);
    if (pErr) throw pErr;
    for (const p of (reqs ?? []) as any[]) {
      if (p.is_test || !p.pay_ref) continue;
      pfmCount++;
      expects.push({ kind: "pfm", id: p.id, provider: p.payment_provider === "flutterwave" ? "flutterwave" : "paystack", ref: p.pay_ref, ngn: num(p.amount_ngn) + num(p.fee_ngn), status: p.status, paidExpected: PFM_PAID.has(p.status) && !!p.paid_at, label: `Pay for Me request ${short(p.id)} (${ngn(num(p.amount_ngn))})` });
    }
  } catch { /* the Pay for Me tables don't exist yet: nothing to check */ }
  if (pfmCount) checks.push({ name: "Pay for Me requests", ran: true, note: `${pfmCount} request${pfmCount === 1 ? "" : "s"} matched to their payments` });

  // ── 1. Money in ──
  // Ask each provider for a window one day either side so a payment made near midnight still finds its pair.
  const winFrom = new Date(startMs - 24 * 3600_000).toISOString();
  const winTo = new Date(endMs + 24 * 3600_000).toISOString();
  const needFlw = true; // cheap to list, and it catches a customer who pays an old Flutterwave link after a switch
  const needPs = naira.some((o) => o.payment_provider === "paystack") || bulk.some((b) => b.payment_provider === "paystack") || (process.env.NGN_PAY_PROVIDER ?? "").trim().toLowerCase() !== "flutterwave";
  type Rail = { name: string; listing: Listing | null; skipped: string | null };
  const rails: Record<"flutterwave" | "paystack", Rail> = {
    flutterwave: { name: "Flutterwave", listing: null, skipped: !flwPayConfigured() ? "not configured" : flwPayIsTestMode() ? "test key (payments are not real)" : null },
    paystack: { name: "Paystack", listing: null, skipped: !paystackConfigured() ? "not configured" : paystackIsTestMode() ? "test key (payments are not real)" : null },
  };
  await Promise.all([
    needFlw && !rails.flutterwave.skipped ? listFlutterwave(winFrom, winTo).then((l) => { rails.flutterwave.listing = l; }) : Promise.resolve(),
    needPs && !rails.paystack.skipped ? listPaystack(winFrom, winTo).then((l) => { rails.paystack.listing = l; }) : Promise.resolve(),
  ]);

  const byRef = new Map<string, ProviderTx>();            // successful payments seen, any rail
  const receivedByRail: Record<"flutterwave" | "paystack", number | null> = { flutterwave: null, paystack: null };
  for (const key of ["flutterwave", "paystack"] as const) {
    const r = rails[key];
    if (key === "paystack" && !needPs) continue; // not in use
    if (r.skipped) {
      const used = expects.some((e) => e.provider === key && e.paidExpected);
      checks.push({ name: `${r.name} payments`, ran: false, note: `skipped: ${r.skipped}` });
      if (used && !/test key/.test(r.skipped)) flags.push({ level: "warn", msg: `${r.name} is ${r.skipped}, so ${expects.filter((e) => e.provider === key && e.paidExpected).length} paid record(s) could not be matched to a payment.` });
      continue;
    }
    const l = r.listing;
    if (!l) continue;
    if (!l.ok) {
      checks.push({ name: `${r.name} payments`, ran: false, note: `could not read: ${l.error}` });
      flags.push({ level: "warn", msg: `Could not read ${r.name} payments (${l.error}). Money in was not compared for this rail today.` });
      continue;
    }
    for (const t of l.txs) byRef.set(t.ref, t);
    receivedByRail[key] = l.txs.filter((t) => inDay(t.at) && t.currency === "NGN").reduce((a, t) => a + t.ngn, 0);
    checks.push({ name: `${r.name} payments`, ran: true, note: `${l.txs.filter((t) => inDay(t.at)).length} successful payment(s) on the day` });
  }
  const railOk = (p: "flutterwave" | "paystack") => !rails[p].skipped && rails[p].listing?.ok === true;

  // 1a. Our records that say "paid" must have a successful payment of the right size.
  const toVerify: Expect[] = [];
  let cardCharges = 0; // paid above the order total by Paystack's card charge, and accepted
  for (const e of expects) {
    if (!railOk(e.provider)) continue;
    const tx = byRef.get(e.ref);
    if (!e.paidExpected) {
      // Not paid on our side, yet the provider took the money: the customer paid and got nothing.
      if (tx && tx.currency === "NGN") flags.push({ level: "danger", msg: `Money received but ${e.label} is still "${e.status}": ${ngn(tx.ngn)} was paid and nothing was delivered.` });
      continue;
    }
    if (!tx) toVerify.push(e);
    else if (cardChargeOk(e.ngn, tx.ngn)) { if (tx.ngn > e.ngn + 0.5) cardCharges++; }
    else if (Math.abs(tx.ngn - e.ngn) > 0.5) flags.push({ level: "danger", msg: `Amount differs: ${e.label} should be ${ngn(e.ngn)} but ${rails[e.provider].name} took ${ngn(tx.ngn)}.` });
  }
  let unverifiable = 0;
  await pool(toVerify, 4, async (e) => {
    const v = await verifyOne(e.provider, e.ref);
    if (v.state === "paid") {
      if (cardChargeOk(e.ngn, v.ngn)) { if (v.ngn > e.ngn + 0.5) cardCharges++; }
      else if (Math.abs(v.ngn - e.ngn) > 0.5) flags.push({ level: "danger", msg: `Amount differs: ${e.label} should be ${ngn(e.ngn)} but ${rails[e.provider].name} took ${ngn(v.ngn)}.` });
    }
    else if (v.state === "unpaid") flags.push({ level: "danger", msg: `${e.label} is "${e.status}" but ${rails[e.provider].name} has no successful payment for it. Nothing was received.` });
    else unverifiable++;
  });
  if (unverifiable) flags.push({ level: "warn", msg: `${unverifiable} paid record(s) could not be confirmed with the payment provider (it did not answer). Check them by hand.` });
  if (cardCharges) checks.push({ name: "Card charges", ran: true, note: `${cardCharges} payment${cardCharges === 1 ? "" : "s"} included Paystack's card charge (customer pays fees). Accepted, not flagged.` });

  // 1b. Every successful payment in the day must belong to an order or bulk batch that agrees with it.
  const known = new Map(expects.map((e) => [e.ref, e] as const));
  const strangers = Array.from(byRef.values()).filter((t) => inDay(t.at) && t.currency === "NGN" && !known.has(t.ref));
  const looksOurs = (ref: string) => /^(NLG|NLGFW|NLGFB|NLGPB|NLGP|NLGFP)-/i.test(ref);
  const orderIds = new Set<string>(), bulkIds = new Set<string>();
  for (const t of strangers) {
    const m = /^NLG(?:FW)?-([0-9a-f-]{36})$/i.exec(t.ref); if (m) orderIds.add(m[1].toLowerCase());
    const b = /^NLG(?:FB|PB)-([0-9a-f-]{36})$/i.exec(t.ref); if (b) bulkIds.add(b[1].toLowerCase());
  }
  const lateOrders = new Map<string, any>(), lateBulk = new Map<string, any>();
  if (orderIds.size) { const { data } = await db.from("orders").select("id,status,biller_name,amount_ngn,service_fee_local,is_test").in("id", Array.from(orderIds)); for (const o of data ?? []) lateOrders.set(String(o.id).toLowerCase(), o); }
  if (bulkIds.size) { const { data } = await db.from("bulk_orders").select("id,status,amount_total,service_fee,is_test").in("id", Array.from(bulkIds)); for (const b of data ?? []) lateBulk.set(String(b.id).toLowerCase(), b); }
  const pfmIds = new Set<string>();
  for (const t of strangers) { const m = parsePfmRef(t.ref); if (m) pfmIds.add(m.requestId); }
  const latePfm = new Map<string, any>();
  if (pfmIds.size) { try { const { data } = await db.from("pay_requests").select("id,status,is_test").in("id", Array.from(pfmIds)); for (const p of data ?? []) latePfm.set(String(p.id).toLowerCase(), p); } catch { /* table missing */ } }
  for (const t of strangers) {
    const pm = parsePfmRef(t.ref);
    if (pm) {
      const rq = latePfm.get(pm.requestId);
      if (rq?.is_test) continue;
      if (!rq) flags.push({ level: "danger", msg: `Money received with no request: ${ngn(t.ngn)} (${t.ref.slice(0, 60)}). Someone paid a Pay for Me link and nothing exists on our side.` });
      else if (!PFM_PAID.has(String(rq.status))) flags.push({ level: "danger", msg: `Money received but Pay for Me request ${short(rq.id)} is still "${rq.status}": ${ngn(t.ngn)} was paid and nothing was delivered.` });
      continue; // (a paid request's other payments were refunded as duplicates: the alert email already said so)
    }
    const o = lateOrders.get((/^NLG(?:FW)?-(.+)$/i.exec(t.ref)?.[1] ?? "").toLowerCase());
    const b = lateBulk.get((/^NLG(?:FB|PB)-(.+)$/i.exec(t.ref)?.[1] ?? "").toLowerCase());
    const rec = o ?? b;
    if (rec?.is_test) continue;
    if (!looksOurs(t.ref)) { flags.push({ level: "warn", msg: `A payment of ${ngn(t.ngn)} (${t.ref.slice(0, 40)}) is not one of ours. Check it in the payment dashboard.` }); continue; }
    if (!rec) { flags.push({ level: "danger", msg: `Money received with no order: ${ngn(t.ngn)} (${t.ref.slice(0, 50)}). The customer paid and nothing exists on our side.` }); continue; }
    const st = String(rec.status);
    const paid = o ? ORDER_PAID.has(st) : BULK_PAID.has(st);
    if (!paid) flags.push({ level: "danger", msg: `Money received but ${o ? "order" : "bulk batch"} ${short(rec.id)} is still "${st}": ${ngn(t.ngn)} was paid and nothing was delivered.` });
  }

  // ── 2. Goods out (bills provider knows every fulfilled order) ──
  const fulfilled = naira.filter((o) => o.status === "fulfilled");
  let billsChecked = 0, billsUnknown = 0;
  if (deep && fulfilled.length) {
    await pool(fulfilled.slice(0, 80), 4, async (o) => {
      if (!o.flw_reference) { flags.push({ level: "warn", msg: `Fulfilled order ${short(o.id)} has no provider reference to verify.` }); return; }
      try {
        const v = await checkBillStatus(o.flw_reference);
        billsChecked++;
        if (!v.found) flags.push({ level: "danger", msg: `Order ${short(o.id)} is fulfilled but the bills provider has no record of ${o.flw_reference}.` });
        else if (v.state !== "success") flags.push({ level: "danger", msg: `Order ${short(o.id)}: bills provider says "${v.state}" but we marked it fulfilled.` });
      } catch { billsUnknown++; }
    });
    if (billsUnknown) flags.push({ level: "warn", msg: `${billsUnknown} fulfilled order(s) could not be checked with the bills provider (it did not answer).` });
    if (fulfilled.length > 80) flags.push({ level: "warn", msg: `Only the first 80 of ${fulfilled.length} fulfilled orders were checked with the bills provider.` });
    checks.push({ name: "Bills provider", ran: true, note: `${billsChecked} of ${fulfilled.length} fulfilled order(s) confirmed` });
  } else checks.push({ name: "Bills provider", ran: deep, note: fulfilled.length ? "skipped" : "nothing was fulfilled" });

  // ── 3. Stuck work (judged as of now) ──
  for (const o of naira) {
    const age = now - new Date(o.created_at).getTime();
    if (o.status === "refund_failed") flags.push({ level: "danger", msg: `Refund failed on order ${short(o.id)} (${o.biller_name ?? "?"} ${ngn(num(o.amount_ngn) + num(o.service_fee_local))}). The customer is owed money; refund it by hand.` });
    else if (o.status === "needs_review") flags.push({ level: "warn", msg: `Order ${short(o.id)} (${o.biller_name ?? "?"} ${ngn(num(o.amount_ngn))}) still needs review. Nothing was refunded.` });
    else if (o.status === "paid" && age > 10 * 60_000) flags.push({ level: "danger", msg: `Order ${short(o.id)} was paid but never delivered (status "paid" for ${Math.round(age / 3600_000)}h).` });
  }
  for (const b of bulk) {
    const age = now - new Date(b.created_at).getTime();
    if (b.status === "refund_failed") flags.push({ level: "danger", msg: `Bulk refund failed on batch ${short(b.id)}. Refund the customer by hand in the payment dashboard.` });
    else if (b.status === "needs_review") flags.push({ level: "warn", msg: `Bulk batch ${short(b.id)} still needs review. Check it in the Paybeta console.` });
    else if (["paid", "processing", "settling"].includes(b.status) && age > 3 * 3600_000) flags.push({ level: "warn", msg: `Bulk batch ${short(b.id)} has been "${b.status}" for ${Math.round(age / 3600_000)}h.` });
  }

  // ── 4. What we made, from the same engine as /admin/finance ──
  const report: Report = buildReport({
    from: dateStr, to: dateStr, settings: settingsInfo.settings, settingsSaved: settingsInfo.saved, financeTablesMissing: false, econColumns: true,
    orders: naira as OrderRow[], bulk: bulk as BulkRow[], expenses: [], now,
  });
  checks.push({ name: "Profit figures", ran: true, note: report.notes.processorEstimated ? "payment fees and commission are estimates until synced" : "payment fees confirmed" });

  // Wallet float: will the next orders be able to vend?
  const wallet = { provider: providerLabel(activeProvider()), ngn: null as number | null, low: false };
  if (deep) {
    try {
      wallet.ngn = await getBalance("NGN");
      const floor = num(process.env.WALLET_LOW_NGN ?? 20000);
      wallet.low = wallet.ngn < floor;
      if (wallet.low) flags.push({ level: "warn", msg: `${wallet.provider} wallet is down to ${ngn(wallet.ngn)} (alert level ${ngn(floor)}). Top it up before orders fail.` });
      checks.push({ name: "Bills wallet", ran: true, note: `${wallet.provider}: ${ngn(wallet.ngn)}` });
    } catch { checks.push({ name: "Bills wallet", ran: false, note: "could not read the balance" }); }
  }

  const paidRows = expects.filter((e) => e.paidExpected);
  const refundRows = naira.filter((o) => o.status === "failed_refunded");
  const refundedBulk = bulk.reduce((a, b) => a + num(b.refunded_ngn), 0);
  const received = { flutterwave: receivedByRail.flutterwave, paystack: receivedByRail.paystack, ngn: (receivedByRail.flutterwave ?? 0) + (receivedByRail.paystack ?? 0) };
  const hasFlags = flags.length > 0;
  const quiet = !hasFlags && paidRows.length === 0 && received.ngn === 0;
  flags.sort((a, b) => (a.level === b.level ? 0 : a.level === "danger" ? -1 : 1));

  return {
    date: dateStr,
    orders: { total: naira.length, byStatus: byStatus(naira) },
    bulk: { total: bulk.length, byStatus: byStatus(bulk) },
    paid: { count: paidRows.length, ngn: paidRows.reduce((a, e) => a + e.ngn, 0) },
    received,
    refunded: { count: refundRows.length + bulk.filter((b) => num(b.refunded_ngn) > 0).length, ngn: refundRows.reduce((a, o) => a + num(o.amount_ngn) + num(o.service_fee_local), 0) + refundedBulk },
    money: { bill: report.totals.bill, fees: report.totals.fees, commission: report.totals.commission, processor: report.totals.processor, gross: report.totals.gross, processorEstimated: report.notes.processorEstimated > 0 },
    products: report.products.filter((p) => p.orders > 0).map((p) => ({ label: productLabel(p.key), orders: p.orders, bill: p.bill })),
    wallet, checks, flags,
    verdict: hasFlags ? "attention" : quiet ? "quiet" : "clear",
    ok: !hasFlags,
  };
}

// ───────── the email ─────────
const prettyDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

export function reconSubject(r: ReconResult): string {
  const d = prettyDay(r.date);
  if (r.verdict === "attention") return `⚠ Nolgic daily check, ${d}: ${r.flags.length} to look at`;
  if (r.verdict === "quiet") return `Nolgic daily check, ${d}: quiet day, nothing paid`;
  return `✓ Nolgic daily check, ${d}: all clear`;
}

export function reconEmailHtml(r: ReconResult): string {
  const site = (process.env.NEXT_PUBLIC_APP_URL ?? "https://www.nolgic.com").replace(/\/+$/, "");
  const statusLine = (m: Record<string, number>) => Object.entries(m).map(([k, v]) => `${k.replace(/_/g, " ")} ${v}`).join(", ") || "none";
  const NAVY = "#14172B", AMBER = "#FFB627", CREAM = "#FAF8F3", MUTE = "#667085", LINE = "#EAE7DD";

  // The verdict card: one colour, one sentence, so the first thing you read is the answer.
  const card = r.verdict === "attention"
    ? { bg: "#FDECEA", edge: "#B42318", title: `${r.flags.length} thing${r.flags.length === 1 ? "" : "s"} to look at`, sub: "Money in does not match our records. Read these first." }
    : r.verdict === "quiet"
      ? { bg: "#F2F4F7", edge: "#667085", title: "Quiet day", sub: "Nobody paid today, so there was nothing to match." }
      : { bg: "#E8FBF2", edge: "#067647", title: "All clear", sub: "Every payment matches an order, and every delivered order is known to the bills provider." };

  const flagRows = r.flags.map((f) => {
    const dot = f.level === "danger" ? "#B42318" : "#B54708";
    return `<tr><td style="padding:10px 0;border-top:1px solid #F3C4C0;vertical-align:top;width:18px"><span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${dot};margin-top:6px"></span></td>
      <td style="padding:10px 0;border-top:1px solid #F3C4C0;color:#101828;font-size:14px;line-height:1.5">${f.level === "danger" ? `<b style="color:#B42318">Act now.</b> ` : ""}${esc(f.msg)}</td></tr>`;
  }).join("");

  const flagsBlock = r.verdict === "attention"
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:14px">${flagRows}</table>` : "";

  const tile = (label: string, value: string, sub = "") => `<td style="width:33%;padding:0 4px 0 0;vertical-align:top">
      <div style="background:#FFFFFF;border:1px solid ${LINE};border-radius:12px;padding:14px 12px">
        <div style="font-size:11px;letter-spacing:.04em;text-transform:uppercase;color:${MUTE}">${label}</div>
        <div style="font-size:20px;font-weight:700;color:${NAVY};margin-top:4px">${value}</div>
        ${sub ? `<div style="font-size:12px;color:${MUTE};margin-top:2px">${sub}</div>` : ""}
      </div></td>`;

  const tiles = r.paid.count || r.received.ngn
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:18px"><tr>
        ${tile("Paid orders", `${r.paid.count}`, `${ngn(r.paid.ngn)} from customers`)}
        ${tile("Received", ngn(r.received.ngn), [r.received.flutterwave != null ? `Flutterwave ${ngn(r.received.flutterwave)}` : "", r.received.paystack != null ? `Paystack ${ngn(r.received.paystack)}` : ""].filter(Boolean).join(" · "))}
        ${tile("Gross profit", ngn(r.money.gross), r.money.processorEstimated ? "payment fees estimated" : "payment fees confirmed")}
      </tr></table>` : "";

  const line = (k: string, v: string, sub = "", bold = false) => `<tr><td style="padding:9px 0;border-top:1px solid ${LINE};color:${MUTE};font-size:14px">${k}${sub ? `<div style="font-size:12px;color:#98a2b3;margin-top:2px">${sub}</div>` : ""}</td><td style="padding:9px 0;border-top:1px solid ${LINE};text-align:right;vertical-align:top;font-size:14px;color:${NAVY};${bold ? "font-weight:700;" : ""}">${v}</td></tr>`;

  const breakdown = r.paid.count || r.received.ngn ? `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:18px">
      ${line("Delivered value", ngn(r.money.bill), "passes through to the bills provider, not our income")}
      ${line("Our fees", ngn(r.money.fees))}
      ${line("Commission", ngn(r.money.commission), r.money.processorEstimated ? "estimated from your rates" : "")}
      ${line("Payment fees", `−${ngn(r.money.processor)}`, r.money.processorEstimated ? "estimated until you press Sync in Finance" : "confirmed")}
      ${r.refunded.count ? line("Refunded to customers", `${r.refunded.count} (${ngn(r.refunded.ngn)})`) : ""}
    </table>` : "";

  const orders = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:18px">
      ${line("Orders", `${r.orders.total}`, esc(statusLine(r.orders.byStatus)))}
      ${line("Bulk airtime batches", `${r.bulk.total}`, esc(statusLine(r.bulk.byStatus)))}
      ${r.wallet.ngn != null ? line(`${esc(r.wallet.provider)} wallet`, `<span style="${r.wallet.low ? "color:#B42318;font-weight:700" : ""}">${ngn(r.wallet.ngn)}</span>`, r.wallet.low ? "low, top it up" : "") : ""}
    </table>`;

  const products = r.products.length
    ? `<p style="margin:14px 0 0;font-size:13px;color:${MUTE}">${r.products.map((p) => `<span style="display:inline-block;background:#FFFFFF;border:1px solid ${LINE};border-radius:999px;padding:3px 10px;margin:0 6px 6px 0">${esc(p.label)} · ${p.orders} · ${ngn(p.bill)}</span>`).join("")}</p>` : "";

  const checks = r.checks.map((c) => `<li style="margin-bottom:4px;color:${c.ran ? "#475467" : "#B54708"}">${c.ran ? "✓" : "–"} ${esc(c.name)}: ${esc(c.note)}</li>`).join("");

  const button = (href: string, label: string, primary = false) => `<a href="${href}" style="display:inline-block;padding:10px 16px;margin:0 8px 8px 0;border-radius:999px;font-size:13px;font-weight:600;text-decoration:none;${primary ? `background:${NAVY};color:#FFFFFF;` : `background:#FFFFFF;color:${NAVY};border:1px solid ${LINE};`}">${label}</a>`;

  return `
  <div style="background:${CREAM};padding:24px 12px;font-family:system-ui,-apple-system,Segoe UI,Arial,sans-serif;color:#101828">
   <div style="max-width:580px;margin:0 auto">
    <div style="background:${NAVY};border-radius:16px 16px 0 0;padding:20px 22px">
      <div style="font-size:13px;color:${AMBER};font-weight:700;letter-spacing:.02em">Nolgic daily check</div>
      <div style="font-size:14px;color:#D8D9E4;margin-top:4px">${prettyDay(r.date)}, Nigeria time</div>
    </div>
    <div style="background:#FFFFFF;border-radius:0 0 16px 16px;border:1px solid ${LINE};border-top:none;padding:20px 22px">
      <div style="background:${card.bg};border-left:4px solid ${card.edge};border-radius:10px;padding:14px 16px">
        <div style="font-size:18px;font-weight:700;color:${card.edge}">${card.title}</div>
        <div style="font-size:14px;color:#344054;margin-top:4px;line-height:1.5">${card.sub}</div>
        ${flagsBlock}
      </div>
      ${tiles}
      ${breakdown}
      ${orders}
      ${products}
      <p style="margin:22px 0 8px;font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:${MUTE}">What was checked</p>
      <ul style="padding-left:18px;margin:0;font-size:13px;line-height:1.5">${checks}</ul>
      <div style="margin-top:22px">${button(`${site}/admin/finance`, "Open Finance", true)}${button(`${site}/admin`, "Admin")}${button(`${site}/admin/feedback`, "Abandoned orders")}</div>
    </div>
    <p style="color:#98a2b3;font-size:12px;text-align:center;margin:16px 0 0">Read-only report. It changes nothing. Profit figures are not accounting advice.</p>
   </div>
  </div>`;
}

// ---------------------------------------------------------------------------
// Email sender — lives here (not in the route) because Next.js route files may
// only export GET/POST/etc. Any other export from a route breaks the build.
// Called by /api/cron/reconcile and folded into the daily token cron.
// ---------------------------------------------------------------------------
export async function sendReconcileEmail(): Promise<{ ok: boolean; flags: number }> {
  const result = await runReconcile(); // yesterday in Nigeria, deep
  const ADMIN_EMAIL = process.env.ADMIN_ALERT_EMAIL ?? "azubuikedavies@gmail.com";
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
    body: JSON.stringify({
      from: process.env.RESEND_FROM ?? "Nolgic <noreply@songsnap.online>",
      to: ADMIN_EMAIL,
      subject: reconSubject(result),
      html: reconEmailHtml(result),
    }),
  });
  if (!res.ok) console.error("[reconcile] email send failed", res.status, await res.text());
  return { ok: result.ok, flags: result.flags.length };
}
