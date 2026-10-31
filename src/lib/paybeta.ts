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

interface PbResult {
  http: number;
  ok: boolean; // HTTP 2xx AND a JSON body AND envelope status "successful"
  status: string; // envelope status, lower-cased ("" if none)
  message: string;
  data: any;
  body: Json;
  unreadable: boolean; // no JSON body came back
}

async function pb(path: string, opts: { method?: "GET" | "POST"; body?: Record<string, unknown>; timeoutMs?: number } = {}): Promise<PbResult> {
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

let cache: { at: number; items: BillerItem[] } | null = null;
let inflight: Promise<BillerItem[]> | null = null;
const CACHE_MS = 60 * 60 * 1000;

/** The docs spell data services both "mtn_data" and "mtn-data". Try each; remember the one that answers. */
function dataServiceCandidates(p: Json): string[] {
  const raw = String(p.slug ?? slugify(String(p.name ?? ""))).trim();
  const out = [raw.replace(/-/g, "_"), raw.replace(/_/g, "-")];
  return out.filter((s, i) => s && out.indexOf(s) === i);
}

async function buildCatalogue(): Promise<BillerItem[]> {
  const items: BillerItem[] = [];
  let id = 1;
  let okCategories = 0;
  let lastErr: unknown = null;

  // Airtime — one entry per network.
  try {
    const provs = arr(await pbGet("/v2/airtime/providers")).filter(enabled);
    const seen = new Set<string>();
    for (const p of provs) {
      const a = AIRTIME.find((x) => x.match.test(String(p.name ?? "")));
      if (!a || seen.has(a.service)) continue;
      seen.add(a.service);
      items.push(mk(id++, {
        biller_code: a.service, item_code: "airtime",
        name: `${a.brand} Airtime`, biller_name: `${a.brand} Airtime VTU`,
        is_airtime: true, label_name: "Phone Number",
      }));
    }
    okCategories++;
  } catch (e) { lastErr = e; console.error("[paybeta] airtime catalogue failed", e); }

  // Electricity — every enabled DISCO (prepaid; postpaid only if PAYBETA_POSTPAID=1).
  try {
    const provs = arr(await pbGet("/v2/electricity/providers")).filter(enabled);
    const kinds: ("prepaid" | "postpaid")[] = process.env.PAYBETA_POSTPAID === "1" ? ["prepaid", "postpaid"] : ["prepaid"];
    for (const p of provs) {
      const name = String(p.name ?? "").trim();
      if (!name) continue;
      const service = String(p.slug ?? slugify(name));
      const biller_name = /electric/i.test(name) ? name : `${name} Electricity`;
      for (const kind of kinds) {
        items.push(mk(id++, {
          biller_code: service, item_code: kind,
          name: `${name} — ${kind === "prepaid" ? "Prepaid" : "Postpaid"}`,
          biller_name, label_name: "Meter Number",
        }));
      }
    }
    okCategories++;
  } catch (e) { lastErr = e; console.error("[paybeta] electricity catalogue failed", e); }

  // Data bundles — fixed-price plans per network.
  try {
    const provs = arr(await pbGet("/v2/data-bundle/providers")).filter(enabled);
    for (const p of provs) {
      const name = String(p.name ?? "").trim();
      if (!name) continue;
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
      if (!service) { console.error(`[paybeta] data plans unavailable for "${name}" — ${why.join(" | ")}`); continue; }
      const seen = new Set<string>();
      for (const k of pkgs) {
        const code = String(k.code ?? "").trim();
        const amount = Math.round(Number(k.price));
        if (!code || !Number.isFinite(amount) || amount <= 0 || seen.has(code)) continue;
        seen.add(code);
        items.push(mk(id++, {
          biller_code: service, item_code: code,
          name: String(k.description ?? code), biller_name: /data/i.test(name) ? name : `${name} Data`,
          amount, label_name: "Phone Number",
        }));
      }
    }
    okCategories++;
  } catch (e) { lastErr = e; console.error("[paybeta] data catalogue failed", e); }

  // Cable TV — DStv, GOtv, StarTimes bouquets.
  try {
    const provs = arr(await pbGet("/v2/cable/providers")).filter(enabled);
    for (const p of provs) {
      const name = String(p.name ?? "").trim();
      const service = String(p.slug ?? name.toLowerCase().replace(/\s+/g, "")).trim();
      if (!name || !service || /showmax/i.test(name)) continue;
      let pkgs: Json[] = [];
      try { pkgs = arr((await pbGet("/v2/cable/bouquet", "POST", { service }))?.packages); }
      catch (e) { console.error(`[paybeta] bouquets for ${service} failed`, e); continue; }
      const seen = new Set<string>();
      for (const k of pkgs) {
        const code = String(k.code ?? "").trim();
        const amount = Math.round(Number(k.price));
        if (!code || !Number.isFinite(amount) || amount <= 0 || seen.has(code)) continue;
        seen.add(code);
        items.push(mk(id++, {
          biller_code: service, item_code: code,
          name: String(k.description ?? code), biller_name: name, amount, label_name: "Smartcard Number",
        }));
      }
    }
    okCategories++;
  } catch (e) { lastErr = e; console.error("[paybeta] cable catalogue failed", e); }

  if (!okCategories) throw lastErr instanceof Error ? lastErr : new FlwError("Paybeta catalogue unavailable");
  return items;
}

/** NG catalogue in the same shape as Flutterwave's BillerItem list. Cached for an hour. */
export async function pbGetBillCategories(): Promise<BillerItem[]> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.items;
  if (!inflight) {
    inflight = buildCatalogue()
      .then((items) => { if (items.length) cache = { at: Date.now(), items }; return items; })
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

type Kind = "airtime" | "electricity" | "data" | "cable";
function kindOf(billerCode: string, itemCode: string): Kind {
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

async function verifyAccount(kind: "electricity" | "cable", billerCode: string, itemCode: string, identifier: string): Promise<Verified> {
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
  if (kind === "airtime" || kind === "data") return { ...NOT_VERIFIED, customer: identifier };
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
  const d = (r.data ?? {}) as Json;

  if (r.ok) {
    if (d.reference && String(d.reference) !== reference) {
      console.error(`[paybeta] vend reference echo differs: sent ${reference}, got ${String(d.reference)}`);
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
  return { reference, state, recognised, token: pbToken(data) };
}
