// Paybeta bills client (Nigeria). A drop-in alternative to Flutterwave / VTpass.
// Switched on with BILLS_PROVIDER=paybeta (see src/lib/bills.ts). Nothing here
// runs unless that switch is set.
//
// Docs: https://docs.paybeta.ng/   (sandbox: api.sandbox.paybeta.ng)
//   auth     every call: header  P-API-KEY: <secret key>
//   envelope { status: "successful" | "failed" | "pending", message, data }
//   catalogue GET  /v2/airtime/providers          GET  /v2/data-bundle/providers
//             POST /v2/data-bundle/list {service} GET  /v2/cable/providers
//             POST /v2/cable/bouquet {service}    GET  /v2/electricity/providers
//   lookup    POST /v2/cable/validate  /v2/electricity/validate
//   vend      POST /v2/airtime/purchase  /v2/data-bundle/purchase
//                  /v2/cable/purchase    /v2/electricity/purchase
//   wallet    GET  /v2/wallet/balance
//   exams     GET  /v2/education/providers   POST /v2/education/list {service}   POST /v2/education/purchase
//             (JAMB / WAEC PINs; kept OUT of the main catalogue, see pbExamCatalogue below)
//
// IMPORTANT — what Paybeta does NOT have: a transaction status ("requery") endpoint.
// A vend that comes back "pending" (or never answers) is settled by Paybeta's WEBHOOK
// ("Do not retry the purchase; wait for the final result on your webhook").
// So: /api/paybeta/webhook records every webhook in the paybeta_events table, and
// pbStatus() reads that table. Until an event exists the state is "pending" — never
// "not_found", because "not_found" makes the order pipeline refund.
//
// Errors are thrown as FlwError (same class the rest of the app already understands).

import { createHmac, timingSafeEqual } from "node:crypto";
import { notPower } from "@/lib/not-power";
import { FlwError } from "@/lib/flutterwave";
import type { BillerItem, ValidateResult, BillPaymentResult } from "@/lib/flutterwave";
import { toLocalPhone } from "@/lib/vtpass";
import { supabaseAdmin } from "@/lib/supabase";

// ───────────────────────── config ─────────────────────────

const isLive = () => (process.env.PAYBETA_ENV ?? "sandbox").trim().toLowerCase() === "live";

function base(): string {
  const override = (process.env.PAYBETA_BASE ?? "").trim().replace(/\/+$/, "");
  if (override) return override;
  return isLive() ? "https://api.paybeta.ng" : "https://api.sandbox.paybeta.ng";
}

/** True while pointed at the Paybeta sandbox (no real money or vends). */
export const paybetaIsSandbox = () => !isLive() || /sandbox/i.test(base());

const apiKey = () => (process.env.PAYBETA_API_KEY ?? "").trim();

export const paybetaConfigured = () => !!apiKey();

/** A vend error where Paybeta definitively did NOT process the purchase (safe to refund). */
function notVended(message: string, raw?: unknown): FlwError {
  const e = new FlwError(message, raw);
  e.notVended = true;
  return e;
}

const TRY_AGAIN = "This service is temporarily unavailable — please try again in a few minutes.";

// ───────────────────────── http ─────────────────────────

type Json = Record<string, any>;

export interface PbResult {
  http: number;
  ok: boolean; // HTTP 2xx AND a JSON body AND envelope status "successful"
  status: string; // envelope status, lower-cased ("" if none)
  message: string;
  data: any;
  body: Json;
  unreadable: boolean; // no JSON body came back
}

export async function pb(path: string, opts: { method?: "GET" | "POST"; body?: Record<string, unknown>; timeoutMs?: number } = {}): Promise<PbResult> {
  const method = opts.method ?? "GET";
  const headers: Record<string, string> = {
    "P-API-KEY": apiKey(),
    Accept: "application/json",
    "Content-Type": "application/json",
  };
  // Only when routed through the fixed-IP relay (PAYBETA_BASE set): never sent to Paybeta directly.
  if ((process.env.PAYBETA_BASE ?? "").trim() && (process.env.RELAY_KEY ?? "").trim()) {
    headers["x-relay-key"] = (process.env.RELAY_KEY ?? "").trim();
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 20000);
  let res: Response;
  let text = "";
  try {
    res = await fetch(`${base()}${path}`, {
      method,
      headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: ctrl.signal,
      redirect: "manual",
      cache: "no-store", // wallet balance and vend answers must never be cached
    });
    text = await res.text();
  } catch (e: any) {
    const aborted = e?.name === "AbortError";
    console.error(`[paybeta] ${method} ${path} -> ${aborted ? "timeout" : "network error"}: ${String(e?.message ?? e)}`);
    throw new FlwError(aborted ? "Paybeta did not respond in time" : "Paybeta could not be reached", { network: true });
  } finally {
    clearTimeout(timer);
  }

  let body: Json = {};
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) body = parsed;
  } catch {
    /* non-JSON (HTML error page, empty body, redirect) */
  }
  const unreadable = !Object.keys(body).length;
  if (unreadable) console.error(`[paybeta] ${method} ${path} -> HTTP ${res.status}, unreadable body: ${text.slice(0, 200)}`);
  const status = String(body.status ?? "").toLowerCase();
  return {
    http: res.status,
    ok: res.status >= 200 && res.status < 300 && !unreadable && status === "successful",
    status,
    message: String(body.message ?? "").slice(0, 160),
    data: body.data,
    body,
    unreadable,
  };
}

/**
 * Data-plan list for one network. Paybeta's docs say POST {service}, but its sandbox answers
 * "The POST method is not supported for this route. Supported method: GET" — so try GET ?service= first,
 * then POST, and keep the reason from both if neither works.
 */
async function pbDataList(service: string): Promise<any> {
  const g = await pb(`/v2/data-bundle/list?service=${encodeURIComponent(service)}`);
  if (g.ok) return g.data;
  const p = await pb("/v2/data-bundle/list", { method: "POST", body: { service } });
  if (p.ok) return p.data;
  const why = (r: PbResult) => `HTTP ${r.http}${r.message ? `: ${r.message}` : ""}`;
  throw new FlwError(`data list failed — GET ${why(g)} | POST ${why(p)}`, { get: g.body, post: p.body });
}

/** Catalogue/lookup calls: anything but a clean success is an error (never a guess). */
async function pbGet(path: string, method: "GET" | "POST" = "GET", body?: Record<string, unknown>): Promise<any> {
  const r = await pb(path, { method, body });
  if (!r.ok) throw new FlwError(`Paybeta ${path} failed (HTTP ${r.http}${r.message ? `: ${r.message}` : ""})`, r.body);
  return r.data;
}

// ───────────────────────── references ─────────────────────────

/** "PB" + the order id without dashes (34 chars, alphanumeric). Distinguishable from NOLGIC-… and VTpass ids. */
export const pbReference = (orderId: string) => `PB${orderId.replace(/-/g, "").toLowerCase()}`;
export const isPbReference = (ref: string) => /^PB[0-9a-f]{32}$/i.test(ref);

// ───────────────────────── catalogue ─────────────────────────

function mk(id: number, p: Partial<BillerItem> & Pick<BillerItem, "biller_code" | "item_code" | "name" | "biller_name">): BillerItem {
  return {
    id,
    short_name: p.name,
    amount: 0,
    fee: 0,
    country: "NG",
    is_airtime: false,
    label_name: "Account number",
    ...p,
  } as BillerItem;
}

const slugify = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const arr = (x: unknown): Json[] => (Array.isArray(x) ? (x as Json[]) : []);
const enabled = (p: Json) => p?.status !== false; // Paybeta lists `status: true|false` per provider

// Airtime `service` values are fixed by the docs.
const AIRTIME: { match: RegExp; service: string; brand: string }[] = [
  { match: /mtn/i, service: "mtn_vtu", brand: "MTN" },
  { match: /airtel/i, service: "airtel_vtu", brand: "Airtel" },
  { match: /glo/i, service: "glo_vtu", brand: "Glo" },
  { match: /9\s*mobile|etisalat/i, service: "9mobile_vtu", brand: "9mobile" },
];

let cache: { at: number; ttl: number; items: BillerItem[] } | null = null;
let inflight: Promise<BillerItem[]> | null = null;
const CACHE_MS = 60 * 60 * 1000;
const PARTIAL_CACHE_MS = 2 * 60 * 1000; // a catalogue missing a category is retried after two minutes, not an hour

/** The docs spell data services both "mtn_data" and "mtn-data". Try each; remember the one that answers. */
function dataServiceCandidates(p: Json): string[] {
  const raw = String(p.slug ?? slugify(String(p.name ?? ""))).trim();
  const out = [raw.replace(/-/g, "_"), raw.replace(/_/g, "-")];
  return out.filter((s, i) => s && out.indexOf(s) === i);
}

type Spec = Parameters<typeof mk>[1];

/** Run fn over list with at most `limit` in flight; results keep the list's order. */
async function pool<T, R>(list: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(list.length);
  let next = 0;
  const worker = async () => {
    while (next < list.length) { const i = next++; out[i] = await fn(list[i]); }
  };
  await Promise.all(Array.from({ length: Math.min(limit, list.length) }, worker));
  return out;
}

// Each category returns its entries without ids (ids are handed out afterwards, in a fixed order), and throws if
// the whole category is unavailable. The four run side by side, so the catalogue takes as long as the slowest one
// instead of the sum of all of them.

/** Airtime — one entry per network. */
async function airtimeSpecs(): Promise<Spec[]> {
  const provs = arr(await pbGet("/v2/airtime/providers")).filter(enabled);
  const seen = new Set<string>();
  const out: Spec[] = [];
  for (const p of provs) {
    const a = AIRTIME.find((x) => x.match.test(String(p.name ?? "")));
    if (!a || seen.has(a.service)) continue;
    seen.add(a.service);
    out.push({
      biller_code: a.service, item_code: "airtime",
      name: `${a.brand} Airtime`, biller_name: `${a.brand} Airtime VTU`,
      is_airtime: true, label_name: "Phone Number",
    });
  }
  return out;
}

/** Electricity — every enabled DISCO (prepaid; postpaid only if PAYBETA_POSTPAID=1). */
async function electricitySpecs(): Promise<Spec[]> {
  const provs = arr(await pbGet("/v2/electricity/providers")).filter(enabled);
  const kinds: ("prepaid" | "postpaid")[] = process.env.PAYBETA_POSTPAID === "1" ? ["prepaid", "postpaid"] : ["prepaid"];
  const out: Spec[] = [];
  for (const p of provs) {
    const name = String(p.name ?? "").trim();
    if (!name) continue;
    if (notPower(`${name} ${String(p.slug ?? "")}`)) { console.warn(`[paybeta] ignoring "${name}" in the electricity list: it is not an electricity company`); continue; }
    const service = String(p.slug ?? slugify(name));
    const biller_name = /electric/i.test(name) ? name : `${name} Electricity`;
    for (const kind of kinds) {
      out.push({
        biller_code: service, item_code: kind,
        name: `${name} — ${kind === "prepaid" ? "Prepaid" : "Postpaid"}`,
        biller_name, label_name: "Meter Number",
      });
    }
  }
  return out;
}

/** Data bundles — fixed-price plans per network (networks fetched three at a time). */
async function dataSpecs(): Promise<Spec[]> {
  const provs = arr(await pbGet("/v2/data-bundle/providers")).filter(enabled);
  const named = provs.filter((p) => String(p.name ?? "").trim());
  const perProvider = await pool(named, 3, async (p): Promise<Spec[]> => {
    const name = String(p.name ?? "").trim();
    let service = "";
    let pkgs: Json[] = [];
    const why: string[] = [];
    for (const cand of dataServiceCandidates(p)) {
      try {
        const d = await pbDataList(cand);
        // docs show data.packages; also accept a bare array in case the sandbox differs
        const list = arr(d?.packages ?? d?.bundles ?? d);
        if (list.length) { service = cand; pkgs = list; break; }
        why.push(`${cand}: answered but no plans (data keys: ${d && typeof d === "object" ? Object.keys(d).join(",") || "none" : typeof d})`);
      } catch (e) { why.push(`${cand}: ${String((e as any)?.message ?? e).slice(0, 140)}`); }
    }
    if (!service) { console.error(`[paybeta] data plans unavailable for "${name}" — ${why.join(" | ")}`); return []; }
    const seen = new Set<string>();
    const out: Spec[] = [];
    for (const k of pkgs) {
      const code = String(k.code ?? "").trim();
      const amount = Math.round(Number(k.price));
      if (!code || !Number.isFinite(amount) || amount <= 0 || seen.has(code)) continue;
      seen.add(code);
      out.push({
        biller_code: service, item_code: code,
        name: String(k.description ?? code), biller_name: /data/i.test(name) ? name : `${name} Data`,
        amount, label_name: "Phone Number",
      });
    }
    return out;
  });
  return perProvider.flat();
}

/** Cable TV — DStv, GOtv, StarTimes bouquets (providers fetched three at a time). */
async function cableSpecs(): Promise<Spec[]> {
  const provs = arr(await pbGet("/v2/cable/providers")).filter(enabled);
  const wanted = provs
    .map((p) => {
      const name = String(p.name ?? "").trim();
      return { name, service: String(p.slug ?? name.toLowerCase().replace(/\s+/g, "")).trim() };
    })
    .filter((p) => p.name && p.service && !/showmax/i.test(p.name));
  const perProvider = await pool(wanted, 3, async ({ name, service }): Promise<Spec[]> => {
    let pkgs: Json[] = [];
    try { pkgs = arr((await pbGet("/v2/cable/bouquet", "POST", { service }))?.packages); }
    catch (e) { console.error(`[paybeta] bouquets for ${service} failed`, e); return []; }
    const seen = new Set<string>();
    const out: Spec[] = [];
    for (const k of pkgs) {
      const code = String(k.code ?? "").trim();
      const amount = Math.round(Number(k.price));
      if (!code || !Number.isFinite(amount) || amount <= 0 || seen.has(code)) continue;
      seen.add(code);
      out.push({
        biller_code: service, item_code: code,
        name: String(k.description ?? code), biller_name: name, amount, label_name: "Smartcard Number",
      });
    }
    return out;
  });
  return perProvider.flat();
}

let lastPartial = false;
/** True when the last catalogue build was missing a category (the billers route then lets the CDN keep it for minutes, not an hour). */
export const pbCatalogueIsPartial = () => lastPartial;

async function buildCatalogue(): Promise<BillerItem[]> {
  const jobs: [string, () => Promise<Spec[]>][] = [
    ["airtime", airtimeSpecs], ["electricity", electricitySpecs], ["data", dataSpecs], ["cable", cableSpecs],
  ];
  const results = await Promise.allSettled(jobs.map(([, run]) => run()));
  const items: BillerItem[] = [];
  let id = 1;
  let ok = 0;
  let lastErr: unknown = null;
  results.forEach((r, i) => {
    if (r.status === "rejected") { lastErr = r.reason; console.error(`[paybeta] ${jobs[i][0]} catalogue failed`, r.reason); return; }
    ok++;
    for (const s of r.value) items.push(mk(id++, s));
  });
  if (!ok) throw lastErr instanceof Error ? lastErr : new FlwError("Paybeta catalogue unavailable");
  lastPartial = ok < jobs.length;
  return items;
}

/** NG catalogue in the same shape as Flutterwave's BillerItem list. Cached for an hour. */
export async function pbGetBillCategories(): Promise<BillerItem[]> {
  if (cache && Date.now() - cache.at < cache.ttl) return cache.items;
  if (!inflight) {
    inflight = buildCatalogue()
      .then((items) => { if (items.length) cache = { at: Date.now(), ttl: lastPartial ? PARTIAL_CACHE_MS : CACHE_MS, items }; return items; })
      .finally(() => { inflight = null; });
  }
  return inflight;
}

/** Server-side truth for a purchase (checkout re-checks price/plan so the browser can't pick its own). */
export async function pbLookupItem(billerCode: string, itemCode: string): Promise<{ item: BillerItem | null; min: number; max: number }> {
  const items = await pbGetBillCategories();
  const item = items.find((i) => i.biller_code === billerCode && i.item_code === itemCode) ?? null;
  return { item, min: 0, max: 0 }; // Paybeta publishes no per-product limits; electricity minimum comes from the meter lookup
}

type Kind = "airtime" | "electricity" | "data" | "cable" | "education";
/** Exam-PIN services. Their codes never overlap with electricity / data / cable service names. */
export const isExamService = (billerCode: string) => /^(jamb|waec|neco|nabteb)([_-]|$)/i.test(billerCode);
function kindOf(billerCode: string, itemCode: string): Kind {
  if (isExamService(billerCode)) return "education";
  if (itemCode === "airtime") return "airtime";
  if (itemCode === "prepaid" || itemCode === "postpaid") return "electricity";
  if (/[_-]data$/i.test(billerCode)) return "data";
  return "cable";
}

// ───────────────────────── lookup ─────────────────────────

const NOT_VERIFIED: Omit<ValidateResult, "customer"> = {
  response_code: "00", response_message: "Not verified", name: null, minimum: 0, maximum: 0, fee: 0,
};

interface Verified { name: string; address: string; minimum: number }

// A meter or smartcard that was just verified is remembered for ten minutes, so the lookup the customer sees on
// the form, the one checkout runs and the one the vend runs are one Paybeta call, not three. Only a successful
// answer is remembered: a failure is always asked again.
const VERIFY_MEMO_MS = 10 * 60 * 1000;
const verifyMemo = new Map<string, { at: number; v: Verified }>();
/** (for tests) forget every remembered verification */
export const pbClearVerifyMemo = () => verifyMemo.clear();

async function verifyAccount(kind: "electricity" | "cable", billerCode: string, itemCode: string, identifier: string): Promise<Verified> {
  const key = `${kind}|${billerCode}|${itemCode}|${identifier.trim()}`;
  const hit = verifyMemo.get(key);
  if (hit && Date.now() - hit.at < VERIFY_MEMO_MS) return hit.v;
  const v = await verifyAccountLive(kind, billerCode, itemCode, identifier);
  if (verifyMemo.size >= 500) verifyMemo.delete(verifyMemo.keys().next().value as string);
  verifyMemo.set(key, { at: Date.now(), v });
  return v;
}

async function verifyAccountLive(kind: "electricity" | "cable", billerCode: string, itemCode: string, identifier: string): Promise<Verified> {
  const r = kind === "electricity"
    ? await pb("/v2/electricity/validate", { method: "POST", body: { service: billerCode, meterNumber: identifier, meterType: itemCode === "postpaid" ? "postpaid" : "prepaid" } })
    : await pb("/v2/cable/validate", { method: "POST", body: { service: billerCode, smartCardNumber: identifier } });
  const d = r.data ?? {};
  const name = String(d.customerName ?? "").trim();
  if (!r.ok || !name) {
    console.error(`[paybeta] validate ${billerCode}/${itemCode} -> HTTP ${r.http} status=${r.status} msg=${r.message} name=${name ? "yes" : "no"}`);
    if (r.http >= 500 || r.unreadable) throw new FlwError(TRY_AGAIN, r.body);
    throw new FlwError("Couldn't verify that number for this plan — check it's correct, or try a different plan.", r.body);
  }
  const min = Number(d.minimuVendAmount ?? d.minimumVendAmount); // (sic) Paybeta spells it "minimu"
  return { name, address: String(d.customerAddress ?? "").trim(), minimum: Number.isFinite(min) && min > 0 ? min : 0 };
}

/** Account-name lookup. Electricity and cable support it; airtime/data return name=null. */
export async function pbValidate(itemCode: string, billerCode: string, identifier: string): Promise<ValidateResult> {
  const kind = kindOf(billerCode, itemCode);
  if (kind === "airtime" || kind === "data" || kind === "education") return { ...NOT_VERIFIED, customer: identifier };
  const v = await verifyAccount(kind, billerCode, itemCode, identifier);
  return { response_code: "00", response_message: "Verified", name: v.name, customer: identifier, minimum: v.minimum, maximum: 0, fee: 0 };
}

// ───────────────────────── vend ─────────────────────────

/**
 * Token from a vend/webhook payload: data.token (strips a leading "Token:" label).
 * Paybeta's sandbox sends 0 for products that have no token (data, TV), so "0"/"000…" is never a token.
 */
export function pbToken(data: unknown): string | null {
  const d = (data ?? {}) as Json;
  for (const c of [d.token, d.Token]) {
    if (c == null) continue;
    const s = String(c).replace(/^\s*token\s*:?\s*/i, "").trim();
    if (s && !/^(null|undefined|n\/a|0+)$/i.test(s)) return s;
  }
  return null;
}

export async function pbPay(params: {
  identifier: string;
  amountLocal: number;
  itemCode: string;
  billerCode: string;
  reference: string;
  phone?: string | null;
}): Promise<BillPaymentResult> {
  const { billerCode, itemCode, identifier, reference } = params;
  const kind = kindOf(billerCode, itemCode);
  const amount = Math.round(Number(params.amountLocal));

  let path: string;
  let body: Record<string, unknown>;

  if (kind === "airtime" || kind === "data") {
    const phone = toLocalPhone(identifier);
    if (!phone) throw notVended("The phone number for this Paybeta vend isn't a valid Nigerian mobile");
    if (kind === "airtime") {
      path = "/v2/airtime/purchase";
      body = { service: billerCode, phoneNumber: phone, amount, reference };
    } else {
      path = "/v2/data-bundle/purchase";
      body = { service: billerCode, amount, phoneNumber: phone, code: itemCode, reference };
    }
  } else if (kind === "education") {
    path = "/v2/education/purchase";
    body = { service: billerCode, examCode: itemCode, customerId: identifier, amount, reference };
  } else {
    // Electricity and cable need the account holder's name (and the meter address) on the vend.
    // This lookup runs BEFORE any money moves, so any failure here is safe to refund.
    let v: Verified;
    try { v = await verifyAccount(kind, billerCode, itemCode, identifier); }
    catch (e) { throw notVended(`Paybeta account lookup failed before vend: ${String((e as any)?.message ?? e)}`); }
    if (kind === "electricity") {
      path = "/v2/electricity/purchase";
      body = {
        service: billerCode, meterNumber: identifier, meterType: itemCode === "postpaid" ? "postpaid" : "prepaid",
        amount, customerName: v.name, customerAddress: v.address, reference,
      };
    } else {
      path = "/v2/cable/purchase";
      body = { service: billerCode, smartCardNumber: identifier, amount, packageCode: itemCode, customerName: v.name, reference };
    }
  }

  const r = await pb(path, { method: "POST", body, timeoutMs: 30000 });
  // Education answers differently from the other products (status "success", fields possibly at the top level).
  const d = ((kind === "education" ? eduData(r) : r.data) ?? {}) as Json;

  if (kind === "education" ? eduOk(r) : r.ok) {
    if (d.reference && String(d.reference) !== reference) {
      console.error(`[paybeta] vend reference echo differs: sent ${reference}, got ${String(d.reference)}`);
    }
    if (kind === "education") {
      // The customer is buying a PIN, so a "successful" answer with no PIN we can read must never be treated as delivered.
      // In live mode it goes to review (NOT a refund: Paybeta may have issued the PIN, the founder can read it in the
      // Paybeta console, and the webhook may still deliver it). In sandbox the docs show an empty answer, so use a test PIN.
      const pins = pbExamPins(d);
      if (!pins) {
        if (paybetaIsSandbox()) {
          return { amount: params.amountLocal, flw_ref: String(d.transactionId ?? ""), tx_ref: reference, reference, extra: "PIN: SANDBOX-TEST-PIN" };
        }
        const keys = d && typeof d === "object" ? Object.keys(d).slice(0, 12).join(",") || "none" : typeof d;
        console.error(`[paybeta] education vend ok but no PIN found. data keys: ${keys}`);
        throw new FlwError(`Paybeta exam vend succeeded but no PIN was readable (data keys: ${keys}). Read the PIN in the Paybeta console and send it to the customer.`, r.body);
      }
      return { amount: params.amountLocal, flw_ref: String(d.transactionId ?? ""), tx_ref: reference, reference, extra: pins };
    }
    return {
      amount: params.amountLocal,
      flw_ref: String(d.transactionId ?? ""),
      tx_ref: reference,
      reference,
      extra: kind === "electricity" ? pbToken(d) : null, // only electricity has a token to show the customer
    };
  }

  // "Do not retry the purchase; wait for the final result on your webhook."
  if (r.http >= 200 && r.http < 300 && r.status === "pending") {
    throw new FlwError("Paybeta vend pending — waiting for webhook", r.body);
  }
  // A clear "that profile / candidate doesn't exist" rejection of an exam PIN means nothing was issued: safe to refund.
  // (A message that also mentions the reference or a duplicate is NOT clear, and falls through to the check below.)
  if (kind === "education" && r.status === "failed" && /(invalid|incorrect|not found|does not exist|doesn't exist|no (record|candidate|profile))/i.test(r.message) && !/reference|duplicate|already/i.test(r.message)) {
    throw notVended(`Paybeta rejected the exam PIN request: ${r.message}`, r.body);
  }
  // Duplicate-reference style rejections mean an earlier attempt may exist: never refund on those.
  // (Checked BEFORE the generic "failed" below, which would otherwise mark them refundable.)
  if (/duplicate|already|exist/i.test(r.message)) {
    throw new FlwError(`Paybeta says this reference was seen before (${r.message})`, r.body);
  }
  if (r.status === "failed") throw notVended(`Paybeta vend failed${r.message ? `: ${r.message}` : ""}`, r.body);
  // A clean 4xx rejection (bad key, IP not allowed, validation error, empty wallet): nothing was bought.
  if (r.http >= 400 && r.http < 500) {
    throw notVended(`Paybeta rejected the vend (HTTP ${r.http}${r.message ? `: ${r.message}` : ""})`, r.body);
  }
  // 5xx, empty/garbled 2xx, unknown status: outcome unknown. The order goes to review until the webhook settles it.
  throw new FlwError(`Paybeta vend unconfirmed (HTTP ${r.http}, status "${r.status || "none"}")`, r.body);
}

// ───────────────────────── status (webhook-fed) + wallet ─────────────────────────

export type PbState = "success" | "failed" | "pending";
export interface PbStatus {
  found: boolean;
  state: PbState;
  token: string | null;
  detail: string;
}

/**
 * Status of a vend from the webhook events we have recorded. With no event yet the answer is
 * "pending" (found: true) — NEVER "not_found", which the pipeline treats as proof of failure.
 */
export async function pbStatus(reference: string): Promise<PbStatus> {
  const { data, error } = await supabaseAdmin()
    .from("paybeta_events")
    .select("state, token")
    .eq("reference", reference)
    .maybeSingle();
  if (error) throw new FlwError(`Paybeta events unavailable: ${error.message}`);
  if (!data) return { found: true, state: "pending", token: null, detail: "awaiting Paybeta webhook" };
  const state: PbState = data.state === "success" ? "success" : data.state === "failed" ? "failed" : "pending";
  return { found: true, state, token: state === "success" ? (data.token ?? null) : null, detail: `webhook: ${data.state}` };
}

export async function pbBalance(): Promise<number> {
  const d = await pbGet("/v2/wallet/balance");
  const n = Number(d?.availableBalance);
  if (!Number.isFinite(n)) throw new FlwError("Paybeta balance unavailable", d);
  return n;
}

// ───────────────────────── webhook helpers ─────────────────────────

/**
 * Paybeta signs `data.reference` (NOT the whole body) with HMAC-SHA256 using your API secret key (PAYBETA_SECRET_KEY, else PAYBETA_API_KEY) and
 * sends it in the `Signature` header. The docs don't say hex or base64, so both are accepted.
 */
export function pbVerifySignature(reference: string, header: string | null, secrets?: string[]): boolean {
  // The console may show an "API key" and a separate "Secret key". The docs say the signature uses the
  // secret key, so PAYBETA_SECRET_KEY (if set) is tried first, then PAYBETA_API_KEY. Both are secrets.
  const keys = (secrets ?? [process.env.PAYBETA_SECRET_KEY ?? "", apiKey()]).map((k) => k.trim()).filter(Boolean);
  if (!keys.length || !header || !reference) return false;
  const given = header.trim();
  const eq = (x: string, y: string) => {
    const a = Buffer.from(x, "utf8");
    const b = Buffer.from(y, "utf8");
    return a.length === b.length && timingSafeEqual(a, b);
  };
  let ok = false;
  for (const k of keys) {
    const mac = createHmac("sha256", k).update(reference).digest();
    if (eq(mac.toString("hex"), given.toLowerCase()) || eq(mac.toString("base64"), given)) ok = true; // no early exit: constant work
  }
  return ok;
}

export interface PbWebhook {
  reference: string;
  state: PbState;
  recognised: boolean; // false when the payload carried no status we understand
  token: string | null;
}

export function pbParseWebhook(payload: unknown): PbWebhook | null {
  const p = (payload ?? {}) as Json;
  const data = (p.data ?? {}) as Json;
  const reference = typeof data.reference === "string" ? data.reference.trim() : "";
  if (!reference || reference.length > 80 || !/^[A-Za-z0-9_-]+$/.test(reference)) return null;
  const raw = String(data.status ?? p.status ?? p.event ?? "").toLowerCase();
  let state: PbState = "pending";
  let recognised = true;
  if (/^(successful|success|completed|delivered)$/.test(raw)) state = "success";
  else if (/^(failed|reversed|refunded|cancelled|canceled|declined)$/.test(raw)) state = "failed";
  else if (/^(pending|processing|initiated)$/.test(raw)) state = "pending";
  else recognised = false;
  return { reference, state, recognised, token: pbToken(data) ?? (state === "success" ? pbExamPins(data) : null) };
}

// ───────────────────────── exam PINs (JAMB / WAEC) ─────────────────────────
//
// Paybeta's docs give the request shapes but NOT the PIN fields of the answer, so the reader below is deliberately wide:
// it walks the answer for keys that look like a PIN / serial / voucher and shows what it finds. If it finds nothing on a
// live purchase the order is held for review (see pbPay), never refunded and never marked delivered.

const PIN_KEY = /^(e?pins?|pin_?(code|number|no|value)|card_?pin|voucher(_?(code|pin|number|no))?|serial(_?(number|no|num))?|token|scratch_?card(_?pin)?)$/i;
const SERIAL_KEY = /^serial/i;

function pinValue(v: unknown): string | null {
  if (typeof v === "number" && Number.isFinite(v)) v = String(v);
  if (typeof v !== "string") return null;
  const s = v.replace(/^\s*(pin|serial|token)\s*(number|no)?\s*:?\s*/i, "").trim();
  if (!s || s.length > 80 || /^(null|undefined|n\/a|none|0+)$/i.test(s)) return null;
  return s;
}

/**
 * "PIN: 1234567890 · Serial: AB12345" from a purchase / webhook `data` object, or null when nothing PIN-like is in it.
 * Several PINs come out as "PIN: a · PIN: b". Never returns the reference or an exam code (those are not PINs).
 */
export function pbExamPins(data: unknown): string | null {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (label: "PIN" | "Serial", raw: unknown) => {
    const v = pinValue(raw);
    if (!v) return;
    const k = `${label}:${v}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push(`${label}: ${v}`);
  };
  const walk = (node: unknown, key: string, depth: number) => {
    if (depth > 4 || node == null) return;
    if (Array.isArray(node)) {
      for (const n of node.slice(0, 20)) {
        if (n && typeof n === "object") walk(n, "", depth + 1);
        else if (PIN_KEY.test(key)) add(SERIAL_KEY.test(key) ? "Serial" : "PIN", n);
      }
      return;
    }
    if (typeof node === "object") {
      for (const [k, v] of Object.entries(node as Json)) {
        if (v && typeof v === "object") walk(v, k, depth + 1);
        else if (PIN_KEY.test(k)) add(SERIAL_KEY.test(k) ? "Serial" : "PIN", v);
      }
      return;
    }
  };
  walk(data, "", 0);
  return out.length ? out.join(" · ").slice(0, 400) : null;
}

export interface ExamItem {
  service: string; // "jamb" | "waec-registration" | "waec-result" …
  serviceName: string; // "JAMB PIN Vending"
  code: string; // examCode sent on purchase
  name: string; // what the customer sees
  price: number; // whole naira, from Paybeta
}

let examCache: { at: number; items: ExamItem[] } | null = null;
let examInflight: Promise<ExamItem[]> | null = null;

/**
 * Paybeta's education calls do not follow the usual envelope: the list answers status "success" (not "successful")
 * with the rows in a top-level `products` field and no `data`. So here "ok" means HTTP 2xx, a readable body, and a
 * success-looking status or `success: true`; the answer to read is `data` when present, otherwise the whole body.
 */
const eduOk = (r: PbResult) => r.http >= 200 && r.http < 300 && !r.unreadable && (/^success/i.test(r.status) || r.body?.success === true);
const eduData = (r: PbResult) => (r.data !== undefined && r.data !== null ? r.data : r.body);

/** Exam list for one service (POST {service}; the GET form is rejected by Paybeta). */
async function pbExamList(service: string): Promise<any> {
  const p = await pb("/v2/education/list", { method: "POST", body: { service } });
  if (eduOk(p)) return eduData(p);
  throw new FlwError(`exam list failed for ${service}: HTTP ${p.http}${p.message ? ` (${p.message})` : ""}`, p.body);
}

const KNOWN_EXAM_SERVICES = ["jamb", "waec"]; // what the list call really accepts (its provider list shows waec-registration / waec-result, which it rejects)

const money = (v: unknown): number => {
  if (typeof v === "number") return Math.round(v);
  if (typeof v === "string") { const n = Number(v.replace(/[^0-9.]/g, "")); return Number.isFinite(n) ? Math.round(n) : NaN; }
  return NaN;
};
const firstOf = (o: Json, keys: string[]): unknown => { for (const k of keys) if (o[k] != null && o[k] !== "") return o[k]; return undefined; };

/** The first array of objects inside an answer, wherever Paybeta put it (data, data.packages, data.exams ...). */
function findRows(node: unknown, depth = 0): Json[] {
  if (depth > 3 || node == null) return [];
  if (Array.isArray(node)) return node.some((x) => x && typeof x === "object" && !Array.isArray(x)) ? (node as Json[]) : [];
  if (typeof node !== "object") return [];
  const o = node as Json;
  for (const k of ["packages", "exams", "examTypes", "exam_types", "types", "items", "list", "plans", "variations", "products", "data"]) {
    const r = findRows(o[k], depth + 1);
    if (r.length) return r;
  }
  for (const v of Object.values(o)) { const r = findRows(v, depth + 1); if (r.length) return r; }
  return [];
}

function parseExamRows(service: string, serviceName: string, data: unknown): ExamItem[] {
  const out: ExamItem[] = [];
  const seen = new Set<string>();
  for (const k of findRows(data)) {
    const code = String(firstOf(k, ["code", "examCode", "exam_code", "variation_code", "variationCode", "packageCode", "id", "slug"]) ?? "").trim();
    const price = money(firstOf(k, ["price", "amount", "fee", "cost", "vendAmount", "sellingPrice", "selling_price", "variation_amount", "value"]));
    if (!code || !Number.isFinite(price) || price <= 0 || seen.has(code)) continue;
    seen.add(code);
    out.push({ service, serviceName, code, name: String(firstOf(k, ["description", "name", "title", "exam", "label", "plan"]) ?? code).trim(), price });
  }
  return out;
}

/** "waec-result" and "waec-registration" are both the one "waec" service when listing and buying. */
const examFamily = (slug: string) => slug.split(/[-_]/)[0].toLowerCase();

async function tryList(slug: string, label: string): Promise<ExamItem[]> {
  try {
    const rows = parseExamRows(slug, label, await pbExamList(slug));
    if (!rows.length) console.error(`[paybeta] exam list for ${slug} had no rows with a code and a price`);
    return rows;
  } catch (e) { console.error(`[paybeta] exam list for ${slug} failed`, (e as any)?.message ?? e); return []; }
}

async function buildExamCatalogue(): Promise<ExamItem[]> {
  // Which services exist: Paybeta's own list, falling back to the known ones if that call fails or looks different.
  let services: { slug: string; name: string }[] = [];
  try {
    services = arr(await pbGet("/v2/education/providers")).filter(enabled)
      .map((p) => ({ slug: String(p.slug ?? slugify(String(p.name ?? ""))).trim(), name: String(p.name ?? "").trim() }))
      .filter((x) => x.slug && isExamService(x.slug));
  } catch (e) { console.error("[paybeta] education providers failed", (e as any)?.message ?? e); }
  if (!services.length) services = KNOWN_EXAM_SERVICES.map((slug) => ({ slug, name: slug }));

  // One entry per family ("jamb", "waec"): try the family name first (what Paybeta accepts), then the slugs it listed.
  const families = new Map<string, { names: string[]; label: string }>();
  for (const sv of services) {
    const f = examFamily(sv.slug);
    const cur = families.get(f) ?? { names: [f], label: sv.name || f };
    if (!cur.names.includes(sv.slug)) cur.names.push(sv.slug);
    families.set(f, cur);
  }

  const items: ExamItem[] = [];
  for (const fam of Array.from(families.values())) {
    const [family, ...listed] = fam.names;
    const got = await tryList(family, fam.label);
    if (got.length) { items.push(...got); continue; }
    // The family name was refused: fall back to each slug Paybeta listed (all of them, they may be separate services).
    for (const slug of listed) items.push(...(await tryList(slug, fam.label)));
  }
  return items;
}

/** Founder diagnostic: what Paybeta really returns for the exam calls (shapes and short samples, no secrets). */
export async function pbExamDebug(): Promise<unknown> {
  const clip = (v: unknown) => (typeof v === "string" ? v.slice(0, 60) : v);
  const out: Json[] = [];
  let slugs: string[] = [];
  try {
    const r = await pb("/v2/education/providers");
    const rows = arr(r.data ?? r.body?.providers ?? r.body?.products);
    out.push({
      step: "providers", http: r.http, status: r.status, message: r.message,
      providers: rows.map((p) => ({ name: clip(p.name), slug: clip(p.slug), status: p.status, category: clip(p.category) })),
      otherFields: Object.keys(r.body ?? {}),
    });
    slugs = rows.map((p) => String(p.slug ?? "").trim()).filter(Boolean);
  } catch (e) { out.push({ step: "providers", error: String((e as any)?.message ?? e) }); }

  // The slugs Paybeta itself lists first, then the spellings the docs and other apps use, in case they differ.
  const tries = Array.from(new Set([...slugs, ...KNOWN_EXAM_SERVICES, "waec", "waec-result-checker", "waec-registration-pin", "waec_result", "waec_registration", "waec-checker", "neco"]));
  for (const svc of tries) {
    try {
      const r = await pb("/v2/education/list", { method: "POST", body: { service: svc } });
      const rows = findRows(eduData(r));
      out.push({
        step: `list ${svc}`, fromProviders: slugs.includes(svc), http: r.http, status: r.status, message: r.message,
        rows: rows.length, sample: rows.slice(0, 3).map((x) => Object.fromEntries(Object.entries(x).slice(0, 8).map(([k, v]) => [k, clip(v)]))),
        topFields: Object.keys(r.body ?? {}),
      });
    } catch (e) { out.push({ step: `list ${svc}`, error: String((e as any)?.message ?? e) }); }
  }
  return out;
}

/** Everything buyable as an exam PIN, with Paybeta's own prices. Cached for an hour. Throws if Paybeta can't be reached. */
export async function pbExamCatalogue(): Promise<ExamItem[]> {
  if (examCache && Date.now() - examCache.at < CACHE_MS) return examCache.items;
  if (!examInflight) {
    examInflight = buildExamCatalogue()
      .then((items) => { if (items.length) examCache = { at: Date.now(), items }; return items; })
      .finally(() => { examInflight = null; });
  }
  return examInflight;
}

/** Server-side truth for one exam product (price comes from here, never from the browser). */
export async function pbExamLookup(service: string, code: string): Promise<ExamItem | null> {
  const items = await pbExamCatalogue();
  return items.find((i) => i.service === service && i.code === code) ?? null;
}
