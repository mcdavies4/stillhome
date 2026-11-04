// src/lib/payforme.ts
// Pay for Me, server side. Someone in Nigeria lists what they need and shares a link; a friend or relative pays
// for all of it in ONE payment; each item is then bought exactly like a normal order.
//
// Life of a request (pay_requests.status):
//   open -> pending_payment -> paid -> settled
//     \-> expired (nobody paid in 7 days)      \-> needs_review (Nolgic can't tell what happened; you get an email)
//     \-> cancelled (the person who asked, before anyone started paying)
//
// How it stays safe (the same ideas as single orders and bulk airtime):
//   * Money is only taken once. The payment is re-verified with the gateway (status, currency, exact amount, reference)
//     and the request is claimed atomically (pending_payment -> paid) before anything is bought.
//   * Every item becomes an ordinary row in `orders` and goes through the SAME vend pipeline as a single order
//     (fulfilClaimedOrder): wallet check, idempotent provider reference, re-query before any refund, never refund on a guess.
//   * An item that cannot be delivered is refunded on its own (a partial refund of its price + its fee).
//   * The order id for an item is chosen and saved BEFORE the order is created, so a crash and retry can never buy twice.
//   * Webhook, page poll and the daily sweep can all run the same code at the same time: every step is an atomic claim.
//   * Two payments for one request (a double tap, two tabs): the second is refunded in full automatically.

import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase";
import { alertFounder } from "@/lib/alerts";
import { validateCustomer, checkPurchase, billsTestMode, FlwError } from "@/lib/bills";
import { getCountry } from "@/lib/countries";
import { cap, normaliseEmail, safeEqual, UUID_RE } from "@/lib/security";
import { ngnServiceFee, ngnMaxOrder, feeKindOf } from "@/lib/ngn-fee";
import { walletCovers } from "@/lib/capacity";
import { velocityCheck } from "@/lib/velocity";
import { orderIsTest } from "@/lib/test-mode";
import { fulfilClaimedOrder, type ClaimedOrder } from "@/lib/fulfil-order";
import { expectsToken, tryRecoverToken } from "@/lib/fulfilment";
import { ngnPayProvider, flwPayConfigured, flwPayIsTestMode, initializePayment as flwInit, verifyById, verifyByReference, refundTransaction as flwRefund, FlwPayError } from "@/lib/flwpay";
import { paystackConfigured, paystackIsTestMode, initializeTransaction as psInit, verifyTransaction as psVerify, refundTransaction as psRefund, PaystackError } from "@/lib/paystack";
import { PFM_MAX_ITEMS, PFM_NOTE_MAX, PFM_VALID_DAYS, itemStateOf, maskIdentifier, parsePfmRef, pfmMoney, pfmNoValidate, pfmRef, type PfmItemView, type PfmUiStatus, type PfmView } from "@/lib/payforme-shared";
import { sendPayerSummary, sendReceiverSummary } from "@/lib/payforme-email";

export { payForMeEnabled } from "@/lib/payforme-shared";

type Row = Record<string, any>;
const FINAL_ORDER = new Set(["fulfilled", "failed_refunded", "refund_failed", "needs_review"]);
const MAX_TOTAL = () => { const v = Number(process.env.PFM_MAX_TOTAL_NGN ?? 100000); return Number.isFinite(v) && v > 0 ? v : 100000; };
const VEND_BUDGET_MS = 40_000;      // stop starting new items after this long; the poll and the sweep finish the rest
const ORPHAN_AFTER_MS = 2 * 60_000;
const STUCK_AFTER_MS = 30 * 60_000;

const db = () => supabaseAdmin();

// ───────────────────────── 0. is the database set up? ─────────────────────────
// The feature can be switched on (NEXT_PUBLIC_PAYFORME_ENABLED=1) before supabase/migrations/0023_pay_for_me.sql
// has been run. Then nothing may start: no request is made and, above all, nobody is asked to pay. The answer is
// remembered briefly so this costs one tiny query every few minutes, not one per visit.
const NOT_READY_MSG = "Ask someone to pay isn't open yet. Please check back soon.";
let readyCache: { ok: boolean; at: number } | null = null;

export const isMissingSchema = (e: any) =>
  !!e && (["PGRST205", "PGRST204", "42P01", "42703"].includes(String(e.code ?? "")) || /schema cache|does not exist|could not find the/i.test(String(e.message ?? "")));

export function forgetPayForMeReady() { readyCache = null; }

export async function payForMeReady(): Promise<boolean> {
  if (readyCache && Date.now() - readyCache.at < (readyCache.ok ? 5 * 60_000 : 15_000)) return readyCache.ok;
  let ok = false;
  try {
    const [a, b] = await Promise.all([
      db().from("pay_requests").select("id").limit(1),
      db().from("orders").select("pay_request_id").limit(1),
    ]);
    ok = !a.error && !b.error;
    if (!ok) console.error("[pfm] NOT READY: run supabase/migrations/0023_pay_for_me.sql in the Supabase SQL editor.", a.error?.message ?? "", b.error?.message ?? "");
  } catch (e: any) {
    console.error("[pfm] readiness check failed", e?.message ?? e);
  }
  readyCache = { ok, at: Date.now() };
  return ok;
}

// ───────────────────────── 1. making a request ─────────────────────────

export type PfmDraft = { billerCode: string; itemCode: string; billerName: string; itemName: string; identifier: string; identifierLabel: string; amount: number };
export type Fail = { ok: false; status: number; error: string; busy?: boolean };

const safeMsg = (e: any, fallback: string) => {
  const m = String(e?.message ?? "");
  return (e instanceof FlwError || e?.name === "FlwError") && m && !/^(Flutterwave|VTpass|Paybeta) /i.test(m) ? m : fallback;
};

async function pool<T, R>(xs: T[], n: number, fn: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(xs.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, xs.length) }, async () => {
    while (next < xs.length) { const i = next++; out[i] = await fn(xs[i], i); }
  }));
  return out;
}

export async function createPayRequest(raw: any, ip: string): Promise<{ ok: true; id: string; key: string; total: number; count: number } | Fail> {
  if (!(await payForMeReady())) return { ok: false, status: 503, error: NOT_READY_MSG };
  const rail = ngnPayProvider();
  if (rail === "flutterwave" ? !flwPayConfigured() : !paystackConfigured()) return { ok: false, status: 503, error: "This isn't available yet. Please check back soon." };

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, status: 400, error: "Invalid request" };
  const receiverName = cap(raw.receiverName, 60).replace(/\s+/g, " ");
  if (receiverName.length < 2) return { ok: false, status: 400, error: "Enter your name, so they know who is asking." };
  let receiverEmail: string | null = null;
  if (raw.receiverEmail) {
    receiverEmail = normaliseEmail(raw.receiverEmail);
    if (!receiverEmail) return { ok: false, status: 400, error: "That email address doesn't look right." };
  }
  const note = cap(raw.note, PFM_NOTE_MAX).replace(/\s+/g, " ") || null;
  if (!Array.isArray(raw.items) || raw.items.length < 1) return { ok: false, status: 400, error: "Add at least one thing to pay for." };
  if (raw.items.length > PFM_MAX_ITEMS) return { ok: false, status: 400, error: `You can ask for up to ${PFM_MAX_ITEMS} things at a time.` };

  const country = getCountry("NG");
  const minNgn = country.minDomestic ?? country.minLocal;
  const maxNgn = ngnMaxOrder(country.maxLocal);

  const drafts: PfmDraft[] = [];
  for (const r of raw.items as any[]) {
    const d: PfmDraft = {
      billerCode: cap(r?.billerCode, 64), itemCode: cap(r?.itemCode, 64), billerName: cap(r?.billerName, 120), itemName: cap(r?.itemName, 120),
      identifier: cap(r?.identifier, 64), identifierLabel: cap(r?.identifierLabel, 60) || "Account number", amount: Math.round(Number(r?.amount)),
    };
    if (!d.billerCode || !d.itemCode || !d.billerName || !d.identifier) return { ok: false, status: 400, error: "One of the items is incomplete." };
    if (!Number.isFinite(d.amount) || d.amount < minNgn || d.amount > maxNgn) {
      return { ok: false, status: 400, error: `Each amount must be between ${pfmMoney(minNgn)} and ${pfmMoney(maxNgn)}.` };
    }
    drafts.push(d);
  }

  // Check every item with the provider now, exactly as checkout does: the plan exists, the price is right, and the
  // meter / smartcard belongs to a real name that the payer will see before paying.
  type Checked = PfmDraft & { name: string | null; fee: number };
  const checked: (Checked | { err: string })[] = await pool(drafts, 3, async (d, i): Promise<Checked | { err: string }> => {
    try {
      const purchase = await checkPurchase(d.billerCode, d.itemCode, d.amount);
      if (!purchase.ok) return { err: `Item ${i + 1}: ${purchase.error}` };
      let name: string | null = null;
      try {
        name = (await validateCustomer(d.itemCode, d.billerCode, d.identifier)).name ?? null;
      } catch (e) {
        if (!pfmNoValidate({ biller_name: d.billerName, name: d.itemName, item_code: d.itemCode })) throw e;
      }
      const fee = ngnServiceFee(d.amount, feeKindOf(purchase.ok && purchase.item ? purchase.item : { biller_code: d.billerCode, item_code: d.itemCode, biller_name: d.billerName }));
      return { ...d, name, fee };
    } catch (e: any) {
      return { err: `Item ${i + 1}: ${safeMsg(e, "We couldn't check this one. Check the number and try again.")}` };
    }
  });
  const bad = checked.find((c): c is { err: string } => "err" in c);
  if (bad) return { ok: false, status: 400, error: bad.err };
  const items = checked as Checked[];

  const amount = items.reduce((s, i) => s + i.amount, 0);
  const fee = items.reduce((s, i) => s + i.fee, 0);
  if (amount + fee > MAX_TOTAL()) return { ok: false, status: 400, error: `One request can be up to ${pfmMoney(MAX_TOTAL())} in all. Split it into two requests.` };

  const key = randomUUID();
  const { data: req, error } = await db().from("pay_requests").insert({
    receiver_name: receiverName, receiver_email: receiverEmail, receiver_key: key, note, status: "open",
    amount_ngn: amount, fee_ngn: fee, ip,
    expires_at: new Date(Date.now() + PFM_VALID_DAYS * 86400_000).toISOString(),
  }).select("id").single();
  if (error || !req) {
    console.error("[pfm] create failed", error?.message);
    if (isMissingSchema(error)) { readyCache = { ok: false, at: Date.now() }; return { ok: false, status: 503, error: NOT_READY_MSG }; }
    return { ok: false, status: 500, error: "Something went wrong. Please try again." };
  }

  const { error: itemErr } = await db().from("pay_request_items").insert(
    items.map((i, n) => ({
      request_id: req.id, row_no: n + 1, biller_code: i.billerCode, item_code: i.itemCode, biller_name: i.billerName, item_name: i.itemName || null,
      identifier: i.identifier, identifier_label: i.identifierLabel, customer_name: i.name, amount_ngn: i.amount, fee_ngn: i.fee, status: "queued",
    }))
  );
  if (itemErr) {
    await db().from("pay_requests").update({ status: "cancelled", error: "could not save items" }).eq("id", req.id);
    console.error("[pfm] items failed", itemErr.message);
    return { ok: false, status: 500, error: "Something went wrong. Please try again." };
  }
  return { ok: true, id: req.id, key, total: amount + fee, count: items.length };
}

// ───────────────────────── 2. the payer presses Pay ─────────────────────────

export async function startPayRequestPayment(id: string, body: any, ip: string): Promise<{ ok: true; url: string } | Fail> {
  if (!UUID_RE.test(id)) return { ok: false, status: 404, error: "This request wasn't found." };
  const email = normaliseEmail(body?.email);
  if (!email) return { ok: false, status: 400, error: "Enter a valid email address for your receipt." };
  const payerName = cap(body?.name, 60).replace(/\s+/g, " ") || null;

  if (!(await payForMeReady())) return { ok: false, status: 503, error: NOT_READY_MSG };
  const rail = ngnPayProvider();
  if (rail === "flutterwave" ? !flwPayConfigured() : !paystackConfigured()) return { ok: false, status: 503, error: "Payments aren't available right now. Please check back soon." };

  const { data: r } = await db().from("pay_requests").select("*").eq("id", id).maybeSingle();
  const req = r as Row | null;
  if (!req) return { ok: false, status: 404, error: "This request wasn't found." };
  if (req.status === "cancelled") return { ok: false, status: 410, error: `${req.receiver_name} cancelled this request.` };
  if (!["open", "pending_payment"].includes(req.status)) {
    return { ok: false, status: 409, error: req.status === "expired" ? "This request has expired. Ask them to send a new one." : "This request has already been paid." };
  }
  if (new Date(req.expires_at).getTime() < Date.now()) {
    await db().from("pay_requests").update({ status: "expired", updated_at: new Date().toISOString() }).eq("id", id).eq("status", "open");
    return { ok: false, status: 410, error: "This request has expired. Ask them to send a new one." };
  }

  const bill = Number(req.amount_ngn), total = bill + Number(req.fee_ngn);

  // Can we deliver all of it right now? Asked before any payment exists, so nobody pays for what we can't buy.
  const cover = await walletCovers(bill, { context: `Pay for Me, ${pfmMoney(bill)}` });
  if (!cover.ok) return { ok: false, status: 503, busy: true, error: "We're restocking right now. Your payment hasn't been taken. Please try again in a few minutes." };

  const approxPence = Math.round((total / Number(process.env.NGN_PER_GBP ?? 2050)) * 100);
  const vel = await velocityCheck({ email, ip, amountGbpPence: approxPence });
  if (vel.blocked) {
    alertFounder("Pay for Me blocked by velocity check", `Request ${id}\nPayer: ${email}\nIP: ${ip}\nReason: ${vel.reason}\nAmount: ${pfmMoney(total)}`);
    return { ok: false, status: 403, error: "For your security this payment needs review. Please contact nolgichq@gmail.com if you think this is a mistake." };
  }

  // A new attempt = a new reference. (A gateway refuses a reference it has seen, so an abandoned checkout can't be reused.)
  const attempt = Number(req.attempt) + 1;
  const ref = pfmRef(rail, id, attempt);
  const { data: upd } = await db().from("pay_requests").update({
    attempt, status: "pending_payment", payer_email: email, payer_name: payerName, payment_provider: rail, pay_ref: ref,
    is_test: orderIsTest(rail), updated_at: new Date().toISOString(),
  }).eq("id", id).eq("attempt", req.attempt).in("status", ["open", "pending_payment"]).select("id").maybeSingle();
  if (!upd) return { ok: false, status: 409, error: "Someone just started paying this. Please try again in a moment." };

  const app = (process.env.NEXT_PUBLIC_APP_URL ?? "https://www.nolgic.com").replace(/\/$/, "");
  const back = `${app}/r/${id}?paid=1`;
  try {
    if (rail === "flutterwave") {
      const fw = await flwInit({ email, name: payerName, amountNgn: total, orderId: id, txRef: ref, redirectUrl: back, description: `Paying for ${req.receiver_name}`.slice(0, 100) });
      return { ok: true, url: fw.link };
    }
    const ps = await psInit({ email, amountNgn: total, orderId: id, callbackUrl: back, reference: ref, metadata: { pfm_id: id, attempt } });
    return { ok: true, url: ps.authorizationUrl };
  } catch (e: any) {
    console.error("[pfm] could not start payment", e?.message ?? e);
    alertFounder("Pay for Me: could not start a payment", `Request ${id}: ${e?.message ?? e}`);
    return { ok: false, status: 502, error: "We couldn't start the payment. Please try again." };
  }
}

// ───────────────────────── 3. confirming the payment ─────────────────────────

export type PfmConfirmState = "processed" | "unpaid" | "already" | "mismatch" | "skipped" | "duplicate";
type Tx = { paid: boolean; id: string | null; amount: number; currency: string; ref: string };

const looksNotFound = (e: unknown) =>
  (e instanceof FlwPayError && (e.http === 404 || /no transaction|not found/i.test(e.message))) ||
  (e instanceof PaystackError && /not found|invalid/i.test(e.message));

/** Ask the gateway. Never trusts the browser or the webhook body: only the gateway's own answer counts. */
async function checkGateway(rail: "paystack" | "flutterwave", ref: string, txId?: string | null): Promise<Tx | null> {
  try {
    if (rail === "flutterwave") {
      const tx = txId ? await verifyById(txId) : await verifyByReference(ref);
      return { paid: tx.status === "successful" && tx.txRef === ref, id: tx.id || null, amount: tx.amount, currency: tx.currency, ref: tx.txRef };
    }
    const tx = await psVerify(ref);
    return { paid: tx.status === "success", id: ref, amount: tx.amountKobo / 100, currency: tx.currency, ref };
  } catch (e) {
    if (looksNotFound(e)) return null;
    throw e; // network / 5xx: the caller retries
  }
}

async function refundWhole(rail: "paystack" | "flutterwave", tx: Tx) {
  if (rail === "flutterwave") await flwRefund(tx.id ?? "");
  else await psRefund(tx.ref);
}

async function refundDuplicate(req: Row, rail: "paystack" | "flutterwave", tx: Tx) {
  const marker = `pfm-dup:${tx.ref}`;
  const { count } = await db().from("request_log").select("id", { count: "exact", head: true }).eq("route", marker);
  if ((count ?? 0) > 0) return; // already dealt with (a webhook retry)
  await db().from("request_log").insert({ ip: "pfm", route: marker });
  try {
    await refundWhole(rail, tx);
    await alertFounder("Pay for Me: a second payment was refunded", `Request ${req.id} was already paid. A second payment (${tx.ref}, ${pfmMoney(tx.amount)}) came in and was refunded in full.`);
  } catch (e: any) {
    await alertFounder("🚨 Pay for Me: DUPLICATE PAYMENT, REFUND FAILED", `Request ${req.id} was already paid. A second payment ${tx.ref} (${pfmMoney(tx.amount)}) must be refunded by hand.\nError: ${e?.message ?? e}`);
  }
}

/** Called from the Paystack and Flutterwave webhooks AND from the page poll. */
export async function confirmPayRequest(id: string, opts: { ref?: string | null; transactionId?: string | null } = {}): Promise<{ state: PfmConfirmState; note?: string }> {
  const { data: r } = await db().from("pay_requests").select("*").eq("id", id).maybeSingle();
  const req = r as Row | null;
  if (!req) return { state: "skipped", note: "no such request" };

  const ref = opts.ref ?? req.pay_ref;
  if (!ref) return { state: "unpaid", note: "nobody has started paying" };
  const parsed = parsePfmRef(ref);
  if (!parsed || parsed.requestId !== req.id || parsed.attempt < 1 || parsed.attempt > Number(req.attempt)) {
    await alertFounder("⚠️ Pay for Me: unrecognised payment reference", `Request ${id}: reference "${String(ref).slice(0, 80)}" does not belong to it. Not processed.`);
    return { state: "skipped", note: "unknown reference" };
  }
  const rail = parsed.rail;

  // Already past payment: only a *different* paid reference is interesting (a second payment).
  if (req.status !== "pending_payment") {
    if (ref === req.pay_ref || !["paid", "settled", "needs_review"].includes(req.status)) return { state: "already", note: req.status };
    const dup = await checkGateway(rail, ref, opts.transactionId);
    if (dup?.paid && dup.currency === "NGN") { await refundDuplicate(req, rail, dup); return { state: "duplicate" }; }
    return { state: "already", note: req.status };
  }

  const tx = await checkGateway(rail, ref, opts.transactionId);
  if (!tx) return { state: "unpaid", note: "no transaction yet" };
  if (!tx.paid) return { state: "unpaid", note: "not successful yet" };

  // Never buy anything on an underpayment or a wrong-currency charge.
  const expected = Number(req.amount_ngn) + Number(req.fee_ngn);
  if (tx.currency !== "NGN" || !Number.isFinite(tx.amount) || Math.abs(tx.amount - expected) > 0.005) {
    await db().from("pay_requests").update({
      status: "needs_review", pay_ref: ref, pay_id: tx.id, payment_provider: rail, updated_at: new Date().toISOString(),
      error: `PAYMENT MISMATCH: got ${tx.amount} ${tx.currency}, expected ${expected} NGN`,
    }).eq("id", id).eq("status", "pending_payment");
    await alertFounder("🚨 Pay for Me amount mismatch, NOT bought", `Request ${id}\nPaid: ${tx.amount} ${tx.currency}\nExpected: ${expected} NGN\nReference ${ref}. Check the gateway and refund if needed.`);
    return { state: "mismatch", note: "amount mismatch" };
  }

  // A gateway TEST payment is not real money. If the bills provider is LIVE it would spend real float, so refuse unless
  // you've opted in to a supervised end-to-end test (PAYSTACK_TEST_ALLOW_LIVE_VEND=1; remove it afterwards).
  const testRail = rail === "flutterwave" ? flwPayIsTestMode() : paystackIsTestMode();
  if (testRail && !billsTestMode() && process.env.PAYSTACK_TEST_ALLOW_LIVE_VEND !== "1") {
    await db().from("pay_requests").update({ status: "needs_review", pay_ref: ref, pay_id: tx.id, updated_at: new Date().toISOString(), error: "TEST payment on a LIVE bills provider, not bought" }).eq("id", id).eq("status", "pending_payment");
    await alertFounder("Pay for Me TEST payment, not bought", `Request ${id}: the payment gateway is in test mode but the bills provider is live, so nothing was bought. For a supervised test set PAYSTACK_TEST_ALLOW_LIVE_VEND=1, then remove it.`);
    return { state: "skipped", note: "test payment, live bills" };
  }

  const { data: claimed } = await db().from("pay_requests").update({
    status: "paid", pay_ref: ref, pay_id: tx.id, payment_provider: rail, paid_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }).eq("id", id).eq("status", "pending_payment").select("*").maybeSingle();
  if (!claimed) return { state: "already", note: "claimed elsewhere" };

  await runRequest(claimed as Row);
  return { state: "processed" };
}

// ───────────────────────── 4. buying the items ─────────────────────────

async function refundItem(req: Row, amountNgn: number) {
  if (req.payment_provider === "flutterwave") {
    if (!req.pay_id) throw new Error("no Flutterwave transaction id on file");
    await flwRefund(req.pay_id, amountNgn);
  } else {
    if (!req.pay_ref) throw new Error("no Paystack reference on file");
    await psRefund(req.pay_ref, amountNgn);
  }
}

async function insertOrder(req: Row, it: Row): Promise<Row | null> {
  const { data: existing } = await db().from("orders").select("*").eq("id", it.order_id).maybeSingle();
  if (existing) return existing as Row;
  const { data: o, error } = await db().from("orders").insert({
    id: it.order_id, pay_request_id: req.id,
    email: req.payer_email, ip: req.ip ?? null, country: "NG", currency: "NGN", payment_provider: req.payment_provider,
    biller_code: it.biller_code, item_code: it.item_code, biller_name: it.biller_name, identifier: it.identifier,
    identifier_label: it.identifier_label || "Account number", customer_name: it.customer_name, recipient_whatsapp: null,
    amount_ngn: Number(it.amount_ngn), service_fee_local: Number(it.fee_ngn),
    fx_ngn_per_gbp: Number(process.env.NGN_PER_GBP ?? 2050), service_fee_pence: 0, amount_gbp_pence: 0,
    status: "paid",
    ...(req.is_test ? { is_test: true } : {}),
  }).select("*").single();
  if (error || !o) { console.error("[pfm] could not create order", error?.message); return null; }
  return o as Row;
}

/** Buy every item that is waiting. Safe to run from several places at once. */
export async function runRequest(req: Row, budgetMs = VEND_BUDGET_MS): Promise<void> {
  const started = Date.now();
  const d = db();

  // An item claimed for buying more than 2 minutes ago, whose order was never created: nothing happened, try again.
  // (An item whose order DOES exist is handled below by reusing that same order id.)
  const { data: all } = await d.from("pay_request_items").select("*").eq("request_id", req.id).order("row_no", { ascending: true });
  for (const it of (all ?? []) as Row[]) {
    if (it.status === "vending" && Date.now() - new Date(it.vending_at ?? 0).getTime() > ORPHAN_AFTER_MS) {
      const { data: o } = await d.from("orders").select("id,status").eq("id", it.order_id).maybeSingle();
      if (!o) await d.from("pay_request_items").update({ status: "queued" }).eq("id", it.id).eq("status", "vending");
    }
  }

  const { data: queued } = await d.from("pay_request_items").select("*").eq("request_id", req.id).eq("status", "queued").order("row_no", { ascending: true });
  for (const q of (queued ?? []) as Row[]) {
    if (Date.now() - started > budgetMs) break; // the poll or the sweep will pick up the rest
    const orderId = q.order_id ?? randomUUID();
    const { data: claimed } = await d.from("pay_request_items")
      .update({ status: "vending", order_id: orderId, vending_at: new Date().toISOString() })
      .eq("id", q.id).eq("status", "queued").select("*").maybeSingle();
    if (!claimed) continue; // someone else has it

    const order = await insertOrder(req, claimed as Row);
    if (!order) { await d.from("pay_request_items").update({ status: "queued" }).eq("id", q.id).eq("status", "vending"); continue; }
    if (order.status !== "paid") { await d.from("pay_request_items").update({ status: "done" }).eq("id", q.id); continue; } // already dealt with

    const itemTotal = Number(q.amount_ngn) + Number(q.fee_ngn);
    try {
      await fulfilClaimedOrder(order as ClaimedOrder, {
        refund: async () => { await refundItem(req, itemTotal); },
        sendReceiptEmail: async () => { /* one combined email per request goes out when everything is settled */ },
        paymentLabel: `Pay for Me ${req.id.slice(0, 8)} via ${req.payment_provider === "flutterwave" ? "Flutterwave tx " + req.pay_id : "Paystack ref " + req.pay_ref} (this item ${pfmMoney(itemTotal)})`,
      });
    } catch (e: any) {
      console.error("[pfm] fulfil threw", q.id, e?.message ?? e);
      await alertFounder("Pay for Me: an item hit an unexpected error", `Request ${req.id}, item ${q.row_no}, order ${orderId}: ${e?.message ?? e}\nThe order is left as it is. Check it before doing anything.`);
    }
    await d.from("pay_request_items").update({ status: "done" }).eq("id", q.id);
  }

  await settleIfDone(req.id);
}

/** When every item is finished, mark the request settled and send the two summary emails (once). */
async function settleIfDone(id: string): Promise<void> {
  const d = db();
  const { data: items } = await d.from("pay_request_items").select("*").eq("request_id", id).order("row_no", { ascending: true });
  const rows = (items ?? []) as Row[];
  if (!rows.length || !rows.every((i) => i.status === "done")) return;

  const { data: claimed } = await d.from("pay_requests").update({ status: "settled", settled_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", id).in("status", ["paid", "needs_review"]).select("*").maybeSingle();
  if (!claimed) return; // another run settled it
  const req = claimed as Row;

  const { data: orders } = await d.from("orders").select("*").eq("pay_request_id", id);
  const byId = new Map(((orders ?? []) as Row[]).map((o) => [o.id, o] as const));
  const lines = await Promise.all(rows.map(async (i) => {
    const o = byId.get(i.order_id);
    let token: string | null = o?.flw_token ?? null;
    if (o && o.status === "fulfilled" && !token && expectsToken(o)) token = await tryRecoverToken(d, o);
    return { billerName: i.biller_name as string, itemName: (i.item_name ?? null) as string | null, identifier: i.identifier as string, customerName: (i.customer_name ?? null) as string | null, amount: Number(i.amount_ngn), fee: Number(i.fee_ngn), state: itemStateOf(o?.status), token, wantsToken: o ? expectsToken(o) : false };
  }));
  try { await sendPayerSummary(req, lines); } catch (e) { console.error("[pfm] payer email failed", e); }
  try { if (req.receiver_email) await sendReceiverSummary(req, lines); } catch (e) { console.error("[pfm] receiver email failed", e); }

  const refunded = lines.filter((l) => l.state === "refunded").length;
  const checking = lines.filter((l) => l.state === "checking").length;
  if (refunded || checking) {
    await alertFounder(
      "Pay for Me settled with problems",
      `Request ${id}: ${lines.length - refunded - checking} delivered, ${refunded} refunded, ${checking} need a look.`
    );
  }
}

// ───────────────────────── 5. one entry point for the page and the cron ─────────────────────────

const lastSync = new Map<string, number>();

export async function syncPayRequest(id: string, opts: { force?: boolean } = {}): Promise<void> {
  if (!opts.force) {
    const last = lastSync.get(id) ?? 0;
    if (Date.now() - last < 4000) return;
  }
  lastSync.set(id, Date.now());
  if (lastSync.size > 500) lastSync.clear();

  const d = db();
  const { data: r } = await d.from("pay_requests").select("*").eq("id", id).maybeSingle();
  const req = r as Row | null;
  if (!req) return;
  try {
    if (req.status === "open" && new Date(req.expires_at).getTime() < Date.now()) {
      await d.from("pay_requests").update({ status: "expired", updated_at: new Date().toISOString() }).eq("id", id).eq("status", "open");
    } else if (req.status === "pending_payment") {
      // The payer is back (or the webhook was missed): ask the gateway about every attempt, newest first.
      if (Date.now() - new Date(req.created_at).getTime() < 3 * 3600_000 || Date.now() - new Date(req.updated_at).getTime() < 3 * 3600_000) {
        for (let a = Number(req.attempt); a >= 1 && a > Number(req.attempt) - 3; a--) {
          const rail = req.payment_provider === "flutterwave" ? "flutterwave" : "paystack";
          const res = await confirmPayRequest(id, { ref: pfmRef(rail, id, a) });
          if (res.state !== "unpaid") break;
        }
      }
    } else if (req.status === "paid" || req.status === "needs_review") {
      if (req.paid_at) {
        await runRequest(req);
        const { data: now } = await d.from("pay_requests").select("status,paid_at").eq("id", id).maybeSingle();
        if (now?.status === "paid" && Date.now() - new Date(now.paid_at ?? req.paid_at).getTime() > STUCK_AFTER_MS) {
          const { data: moved } = await d.from("pay_requests").update({ status: "needs_review", error: "Paid, but some items are still not finished after 30 minutes", updated_at: new Date().toISOString() }).eq("id", id).eq("status", "paid").select("id").maybeSingle();
          if (moved) await alertFounder("🚨 Pay for Me: a paid request is not finishing", `Request ${id} was paid over 30 minutes ago and some items are not finished. Nothing has been refunded. Open the orders for this request (orders.pay_request_id) and check each one.`);
        }
      }
    }
  } catch (e: any) {
    console.error("[pfm] sync failed", id, e?.message ?? e);
  }
}

/** Daily safety net: expire old open requests, and nudge any that aren't finished. */
export async function sweepPayRequests(): Promise<{ checked: number }> {
  const d = db();
  const now = new Date().toISOString();
  await d.from("pay_requests").update({ status: "expired", updated_at: now }).eq("status", "open").lt("expires_at", now);
  const since = new Date(Date.now() - 7 * 86400_000).toISOString();
  const { data } = await d.from("pay_requests").select("id").in("status", ["pending_payment", "paid", "needs_review"]).gte("created_at", since).limit(100);
  for (const r of (data ?? []) as Row[]) await syncPayRequest(r.id, { force: true });
  return { checked: (data ?? []).length };
}

// ───────────────────────── 6. what the page shows ─────────────────────────

const uiStatus = (r: Row): PfmUiStatus => {
  switch (r.status) {
    case "open": return new Date(r.expires_at).getTime() < Date.now() ? "expired" : "open";
    case "pending_payment": return "paying";
    case "paid": return "working";
    case "settled": return "done";
    case "cancelled": return "cancelled";
    case "expired": return "expired";
    default: return "checking";
  }
};

export async function getPayRequestView(id: string, key?: string | null): Promise<PfmView | null> {
  if (!UUID_RE.test(id)) return null;
  const d = db();
  const { data: r } = await d.from("pay_requests").select("*").eq("id", id).maybeSingle();
  const req = r as Row | null;
  if (!req) return null;
  const owner = !!key && safeEqual(String(key).toLowerCase(), String(req.receiver_key).toLowerCase());

  const [{ data: items }, { data: orders }] = await Promise.all([
    d.from("pay_request_items").select("*").eq("request_id", id).order("row_no", { ascending: true }),
    d.from("orders").select("id,status,flw_token,biller_name,identifier_label").eq("pay_request_id", id),
  ]);
  const byId = new Map(((orders ?? []) as Row[]).map((o) => [o.id, o] as const));

  const views: PfmItemView[] = [];
  let refunded = 0;
  for (const i of (items ?? []) as Row[]) {
    const o = byId.get(i.order_id);
    const state = itemStateOf(o?.status);
    if (state === "refunded") refunded += Number(i.amount_ngn) + Number(i.fee_ngn);
    let token: string | null = null;
    if (owner && o?.status === "fulfilled") {
      token = o.flw_token ?? null;
      if (!token && expectsToken({ biller_name: o.biller_name, identifier_label: o.identifier_label })) {
        const { data: full } = await d.from("orders").select("*").eq("id", o.id).maybeSingle();
        if (full) token = await tryRecoverToken(d, full);
      }
    }
    views.push({
      n: i.row_no, billerName: i.biller_name, itemName: i.item_name ?? null, identifier: owner ? i.identifier : maskIdentifier(i.identifier),
      label: i.identifier_label || "Account number", customerName: i.customer_name ?? null, amount: Number(i.amount_ngn), fee: Number(i.fee_ngn),
      state: req.status === "open" || req.status === "expired" || req.status === "cancelled" ? "waiting" : state, token, orderId: owner ? (i.order_id ?? null) : null,
    });
  }
  const status = uiStatus(req);
  return {
    id: req.id, receiverName: req.receiver_name, note: req.note ?? null, status, expiresAt: req.expires_at,
    amount: Number(req.amount_ngn), fee: Number(req.fee_ngn), total: Number(req.amount_ngn) + Number(req.fee_ngn), refunded,
    items: views, owner, canCancel: owner && req.status === "open",
    payerFirstName: req.payer_name ? String(req.payer_name).split(" ")[0] : null,
  };
}

export async function cancelPayRequest(id: string, key: string): Promise<{ ok: boolean; error?: string }> {
  if (!UUID_RE.test(id)) return { ok: false, error: "Not found" };
  const { data: r } = await db().from("pay_requests").select("receiver_key,status").eq("id", id).maybeSingle();
  if (!r || !safeEqual(String(key).toLowerCase(), String(r.receiver_key).toLowerCase())) return { ok: false, error: "Not found" };
  if (r.status !== "open") return { ok: false, error: r.status === "cancelled" ? "Already cancelled." : "Someone has already started paying, so it can't be cancelled." };
  const { data: done } = await db().from("pay_requests").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("id", id).eq("status", "open").select("id").maybeSingle();
  return done ? { ok: true } : { ok: false, error: "Someone has already started paying, so it can't be cancelled." };
}
