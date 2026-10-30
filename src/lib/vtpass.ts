// VTpass bills client (Nigeria). A drop-in alternative to Flutterwave Bills.
// Switched on with BILLS_PROVIDER=vtpass (see src/lib/bills.ts). Nothing here
// runs unless that switch is set, so Flutterwave stays the default.
//
// Docs: https://vtpass.com/documentation/  (sandbox: sandbox.vtpass.com)
//   auth    GET  -> headers api-key + public-key
//           POST -> headers api-key + secret-key
//   catalogue  GET  /services?identifier=<airtime|data|tv-subscription|electricity-bill>
//              GET  /service-variations?serviceID=<id>
//   lookup     POST /merchant-verify
//   vend       POST /pay          (request_id must start with YYYYMMDDHHmm, Lagos time)
//   status     POST /requery
//   wallet     GET  /balance
//
// Errors are thrown as FlwError (same class the rest of the app already
// understands) so existing `instanceof FlwError` / name checks keep working.

import { FlwError } from "@/lib/flutterwave";
import type { BillerItem, ValidateResult, BillPaymentResult } from "@/lib/flutterwave";

// ───────────────────────── config ─────────────────────────

const isLive = () => (process.env.VTPASS_ENV ?? "sandbox").trim().toLowerCase() === "live";

function base(): string {
  const override = (process.env.VTPASS_BASE ?? "").trim().replace(/\/+$/, "");
  if (override) return override;
  return isLive() ? "https://vtpass.com/api" : "https://sandbox.vtpass.com/api";
}

/** True while pointed at the VTpass sandbox (no real money or vends). */
export const vtpassIsSandbox = () => !isLive() || /sandbox/i.test(base());

export function vtpassConfigured(): boolean {
  return !!(
    (process.env.VTPASS_API_KEY ?? "").trim() &&
    (process.env.VTPASS_PUBLIC_KEY ?? "").trim() &&
    (process.env.VTPASS_SECRET_KEY ?? "").trim()
  );
}

/** A vend error where VTpass definitively did NOT process the purchase (safe to refund). */
function notVended(message: string, raw?: unknown): FlwError {
  const e = new FlwError(message, raw);
  e.notVended = true;
  return e;
}

const TRY_AGAIN = "This service is temporarily unavailable — please try again in a few minutes.";

// ───────────────────────── http ─────────────────────────

interface VtOpts {
  method?: "GET" | "POST";
  query?: Record<string, string>;
  body?: Record<string, unknown>;
  timeoutMs?: number;
}

type Json = Record<string, any>;

async function vt(path: string, opts: VtOpts = {}): Promise<Json> {
  const method = opts.method ?? "GET";
  const url = new URL(`${base()}${path}`);
  for (const k of Object.keys(opts.query ?? {})) url.searchParams.set(k, opts.query![k]);

  const headers: Record<string, string> = {
    "api-key": (process.env.VTPASS_API_KEY ?? "").trim(),
    Accept: "application/json",
  };
  // Only when routed through the fixed-IP relay (VTPASS_BASE set): never sent to VTpass directly.
  if ((process.env.VTPASS_BASE ?? "").trim() && (process.env.RELAY_KEY ?? "").trim()) {
    headers["x-relay-key"] = (process.env.RELAY_KEY ?? "").trim();
  }
  if (method === "GET") headers["public-key"] = (process.env.VTPASS_PUBLIC_KEY ?? "").trim();
  else {
    headers["secret-key"] = (process.env.VTPASS_SECRET_KEY ?? "").trim();
    headers["Content-Type"] = "application/json";
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 20000);
  let res: Response;
  let text = "";
  try {
    res = await fetch(url.toString(), {
      method,
      headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: ctrl.signal,
      redirect: "manual",
    });
    text = await res.text();
  } catch (e: any) {
    const aborted = e?.name === "AbortError";
    console.error(`[vtpass] ${method} ${path} -> ${aborted ? "timeout" : "network error"}: ${String(e?.message ?? e)}`);
    throw new FlwError(aborted ? "VTpass did not respond in time" : "VTpass could not be reached", { network: true });
  } finally {
    clearTimeout(timer);
  }

  let body: Json = {};
  try {
    body = JSON.parse(text);
  } catch {
    /* non-JSON (HTML error page, empty body, redirect) */
  }
  if (!res.ok && !Object.keys(body).length) {
    console.error(`[vtpass] ${method} ${path} -> HTTP ${res.status}: ${text.slice(0, 300)}`);
    throw new FlwError(`VTpass HTTP ${res.status}`, text);
  }
  if (!Object.keys(body).length) {
    console.error(`[vtpass] ${method} ${path} -> unreadable response: ${text.slice(0, 300)}`);
    throw new FlwError("VTpass returned an unreadable response", text);
  }
  return body;
}

const codeOf = (b: Json): string => String(b?.code ?? b?.response_description ?? "").trim();

// Codes that mean "the request never reached the biller / not our customer's fault".
// Internal only: logged and put on the order, never shown to customers.
const CONFIG_CODES: Record<string, string> = {
  "018": "VTpass wallet has insufficient funds — top it up",
  "021": "VTpass account locked",
  "022": "VTpass account suspended",
  "023": "VTpass API access not enabled for this account",
  "024": "VTpass account inactive",
  "027": "VTpass says this server IP is not whitelisted",
  "028": "Product not whitelisted on the VTpass account",
  "087": "VTpass credentials rejected (check VTPASS_* keys)",
};

// Codes that mean the vend outcome is NOT known yet (requery before deciding).
const PENDING_CODES = new Set(["099", "089", "044", "014", "083"]);

// ───────────────────────── references ─────────────────────────

/** VTpass request_id: 12-digit Lagos YYYYMMDDHHmm, then our order id (dashes removed). */
export function vtRequestId(orderId: string, now: Date = new Date()): string {
  const lagos = new Date(now.getTime() + 3600_000); // Africa/Lagos is UTC+1, no DST
  const stamp = lagos.toISOString().replace(/[-:T]/g, "").slice(0, 12);
  return `${stamp}${orderId.replace(/-/g, "")}`;
}

export const isVtRequestId = (ref: string) => /^\d{12}[A-Za-z0-9]+$/.test(ref);

// ───────────────────────── catalogue ─────────────────────────

interface VtService {
  serviceID: string;
  name: string;
  minimium_amount?: string | number;
  maximum_amount?: string | number;
}
interface VtVariation {
  variation_code: string;
  name: string;
  variation_amount: string | number;
  fixedPrice?: string;
}

async function vtServices(identifier: string): Promise<VtService[]> {
  const b = await vt("/services", { query: { identifier } });
  if (codeOf(b) !== "000" || !Array.isArray(b.content)) {
    throw new FlwError(`VTpass services (${identifier}) failed: ${codeOf(b) || "no code"}`, b);
  }
  return b.content as VtService[];
}

async function vtVariations(serviceID: string): Promise<VtVariation[]> {
  const b = await vt("/service-variations", { query: { serviceID } });
  const c = b?.content ?? {};
  const list = c.variations ?? c.varations; // VTpass docs show both spellings
  return Array.isArray(list) ? (list as VtVariation[]) : [];
}

const AIRTIME_BRANDS: Record<string, string> = {
  mtn: "MTN",
  airtel: "Airtel",
  glo: "Glo",
  etisalat: "9mobile",
};

const isElectric = (serviceID: string) => /-electric$/i.test(serviceID);
const VERIFIABLE_TV = new Set(["dstv", "gotv", "startimes"]);

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

let cache: { at: number; items: BillerItem[] } | null = null;
let inflight: Promise<BillerItem[]> | null = null;
const CACHE_MS = 60 * 60 * 1000;

async function buildCatalogue(): Promise<BillerItem[]> {
  const items: BillerItem[] = [];
  let id = 1;
  let okCategories = 0;
  let lastErr: unknown = null;

  // Airtime — one entry per network (VTpass needs the network chosen up front).
  try {
    const svcs = await vtServices("airtime");
    for (const s of svcs) {
      const brand = AIRTIME_BRANDS[s.serviceID];
      if (!brand) continue; // skips international airtime
      items.push(mk(id++, {
        biller_code: s.serviceID, item_code: "airtime",
        name: `${brand} Airtime`, biller_name: `${brand} Airtime VTU`,
        is_airtime: true, label_name: "Phone Number",
      }));
    }
    okCategories++;
  } catch (e) { lastErr = e; console.error("[vtpass] airtime catalogue failed", e); }

  // Electricity — every DISCO, prepaid + postpaid.
  try {
    const svcs = await vtServices("electricity-bill");
    for (const s of svcs) {
      if (!isElectric(s.serviceID)) continue;
      const biller_name = /electric/i.test(s.name) ? s.name : `${s.name} Electricity`;
      for (const kind of ["prepaid", "postpaid"] as const) {
        items.push(mk(id++, {
          biller_code: s.serviceID, item_code: kind,
          name: `${s.name} — ${kind === "prepaid" ? "Prepaid" : "Postpaid"}`,
          biller_name, label_name: "Meter Number",
        }));
      }
    }
    okCategories++;
  } catch (e) { lastErr = e; console.error("[vtpass] electricity catalogue failed", e); }

  // Data + TV: fixed-price plans from the variation lists.
  const planCats: { identifier: string; label: (s: VtService) => string; field: (s: VtService) => string }[] = [
    {
      identifier: "data",
      label: (s) => (/data/i.test(s.name) ? s.name : `${s.name} Data`),
      field: (s) => (/^(smile|spectranet)/i.test(s.serviceID) ? "Account ID" : "Phone Number"),
    },
    {
      identifier: "tv-subscription",
      label: (s) => s.name,
      field: (s) => (/showmax/i.test(s.serviceID) ? "Phone Number" : "Smartcard Number"),
    },
  ];
  for (const cat of planCats) {
    try {
      const svcs = await vtServices(cat.identifier);
      const lists: { s: VtService; vars: VtVariation[] }[] = [];
      for (let i = 0; i < svcs.length; i += 5) {
        const chunk = svcs.slice(i, i + 5);
        const got = await Promise.all(
          chunk.map(async (s) => {
            try { return { s, vars: await vtVariations(s.serviceID) }; }
            catch (e) { console.error(`[vtpass] variations ${s.serviceID} failed`, e); return { s, vars: [] as VtVariation[] }; }
          })
        );
        lists.push(...got);
      }
      for (const { s, vars } of lists) {
        const seen: Record<string, boolean> = {};
        for (const v of vars) {
          const amount = Math.round(Number(v.variation_amount));
          if (!v.variation_code || !Number.isFinite(amount) || amount <= 0) continue; // price must be fixed
          if (seen[v.variation_code]) continue; // docs show a duplicated code once; keep the first
          seen[v.variation_code] = true;
          items.push(mk(id++, {
            biller_code: s.serviceID, item_code: v.variation_code,
            name: v.name, biller_name: cat.label(s), amount, label_name: cat.field(s),
          }));
        }
      }
      okCategories++;
    } catch (e) { lastErr = e; console.error(`[vtpass] ${cat.identifier} catalogue failed`, e); }
  }

  if (!okCategories) throw lastErr instanceof Error ? lastErr : new FlwError("VTpass catalogue unavailable");
  return items;
}

/** NG catalogue in the same shape as Flutterwave's BillerItem list. Cached for an hour. */
export async function vtGetBillCategories(): Promise<BillerItem[]> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.items;
  if (!inflight) {
    inflight = buildCatalogue()
      .then((items) => { if (items.length) cache = { at: Date.now(), items }; return items; })
      .finally(() => { inflight = null; });
  }
  return inflight;
}

// ───────────────────────── lookup ─────────────────────────

const NOT_VERIFIED: Omit<ValidateResult, "customer"> = {
  response_code: "00", response_message: "Not verified", name: null, minimum: 0, maximum: 0, fee: 0,
};

/** Account-name lookup. Only electricity, DStv/GOtv/StarTimes and Smile support it; other products return name=null. */
export async function vtValidate(itemCode: string, billerCode: string, identifier: string): Promise<ValidateResult> {
  const electric = isElectric(billerCode);
  const verifiable = electric || VERIFIABLE_TV.has(billerCode) || billerCode === "smile-direct";
  if (!verifiable) return { ...NOT_VERIFIED, customer: identifier };

  const reqBody: Record<string, unknown> = { billersCode: identifier, serviceID: billerCode };
  if (electric) reqBody.type = itemCode === "postpaid" ? "postpaid" : "prepaid";

  const b = await vt("/merchant-verify", { method: "POST", body: reqBody });
  const code = codeOf(b);
  const c = b?.content ?? {};

  if (CONFIG_CODES[code]) {
    console.error(`[vtpass] merchant-verify ${billerCode}: ${code} ${CONFIG_CODES[code]}`);
    throw new FlwError(TRY_AGAIN, b);
  }
  const name = c.Customer_Name ?? c.customer_name ?? null;
  const wrong = c.WrongBillersCode === true || c.WrongBillersCode === "true" || !!c.error;
  if (code !== "000" || wrong || !name) {
    console.error(`[vtpass] merchant-verify ${billerCode}/${itemCode} -> code=${code} wrong=${wrong} name=${name ? "yes" : "no"}`);
    throw new FlwError("Couldn't verify that number for this plan — check it's correct, or try a different plan.", b);
  }
  const num = (x: unknown) => { const n = Number(x); return Number.isFinite(n) ? n : 0; };
  return {
    response_code: "00",
    response_message: "Verified",
    name: String(name).trim(),
    customer: identifier,
    minimum: num(c.Min_Purchase_Amount),
    maximum: 0,
    fee: 0,
  };
}

// ───────────────────────── vend ─────────────────────────

/** Nigerian mobile → local 11-digit form VTpass expects (0803…). Returns null if it isn't a plausible mobile. */
export function toLocalPhone(raw: unknown): string | null {
  let d = String(raw ?? "").replace(/\D/g, "");
  if (d.startsWith("234") && d.length === 13) d = "0" + d.slice(3);
  else if (d.length === 10 && /^[789]/.test(d)) d = "0" + d;
  return /^0[789]\d{9}$/.test(d) ? d : null;
}

export function extractToken(b: Json): string | null {
  const cands = [b?.Token, b?.token, b?.content?.Token, b?.content?.token, b?.purchased_code];
  for (const c of cands) {
    if (c == null) continue;
    const s = String(c).replace(/^\s*token\s*:?\s*/i, "").trim();
    if (s && !/^(null|undefined|n\/a)$/i.test(s)) return s;
  }
  return null;
}

export async function vtPay(params: {
  identifier: string;
  amountLocal: number;
  itemCode: string;
  billerCode: string;
  reference: string;
  /** Customer/recipient mobile (any common format). Falls back to VTPASS_DEFAULT_PHONE. */
  phone?: string | null;
}): Promise<BillPaymentResult> {
  const { billerCode, itemCode, identifier, reference } = params;
  const airtime = itemCode === "airtime";
  const phone =
    toLocalPhone(params.phone) ??
    (airtime ? toLocalPhone(identifier) : null) ??
    toLocalPhone(process.env.VTPASS_DEFAULT_PHONE);
  if (!phone) {
    throw notVended("No valid phone number for the VTpass vend — set VTPASS_DEFAULT_PHONE");
  }

  const body: Record<string, unknown> = { request_id: reference, serviceID: billerCode, phone };
  if (airtime) {
    body.amount = params.amountLocal;
  } else if (isElectric(billerCode)) {
    body.billersCode = identifier;
    body.variation_code = itemCode === "postpaid" ? "postpaid" : "prepaid";
    body.amount = params.amountLocal;
  } else {
    // Data and TV plans: the variation code fixes the price.
    body.billersCode = identifier;
    body.variation_code = itemCode;
    if (billerCode === "dstv" || billerCode === "gotv") {
      body.subscription_type = "change";
      body.quantity = 1;
    }
  }

  const b = await vt("/pay", { method: "POST", body, timeoutMs: 25000 });
  const code = codeOf(b);
  const tx = b?.content?.transactions ?? {};
  const status = String(tx.status ?? "").toLowerCase();

  if (code === "000") {
    if (status === "delivered" || status === "successful" || status === "success") {
      return {
        amount: Number(b.amount ?? params.amountLocal),
        flw_ref: String(tx.transactionId ?? ""),
        tx_ref: reference,
        reference,
        extra: extractToken(b),
      };
    }
    if (status === "failed" || status === "reversed" || status === "refunded" || status === "cancelled") {
      throw notVended(`VTpass vend ${status}`, b);
    }
    // initiated / pending / processing / empty: not final — the pipeline requeries before deciding.
    throw new FlwError(`VTpass vend not final yet (${status || "no status"})`, b);
  }
  if (PENDING_CODES.has(code)) throw new FlwError(`VTpass vend unconfirmed (code ${code})`, b);
  if (CONFIG_CODES[code]) throw notVended(`${CONFIG_CODES[code]} (code ${code})`, b);
  const desc = String(b?.response_description ?? b?.content?.error ?? "").slice(0, 120);
  throw notVended(`VTpass vend failed (code ${code || "?"}${desc ? `: ${desc}` : ""})`, b);
}

// ───────────────────────── status + wallet ─────────────────────────

export type VtState = "success" | "failed" | "pending" | "not_found";
export interface VtStatus {
  found: boolean;
  state: VtState;
  token: string | null;
  code: string;
  detail: string;
}

export async function vtStatus(requestId: string): Promise<VtStatus> {
  const b = await vt("/requery", { method: "POST", body: { request_id: requestId } });
  const code = codeOf(b);
  const tx = b?.content?.transactions;
  const status = String(tx?.status ?? "").toLowerCase();
  const token = extractToken(b);

  let state: VtState;
  if (status) {
    if (status === "delivered" || status === "successful" || status === "success") state = "success";
    else if (status === "failed" || status === "reversed" || status === "refunded" || status === "cancelled") state = "failed";
    else state = "pending";
  } else if (code === "015") state = "not_found"; // VTpass: this request_id was never used
  else if (code === "016" || code === "040" || code === "091") state = "failed";
  else state = "pending"; // anything unclear is treated as unknown, never as a reason to refund

  return { found: state !== "not_found", state, token: state === "success" ? token : null, code, detail: status || code || "unknown" };
}

export async function vtBalance(): Promise<number> {
  const b = await vt("/balance");
  const n = Number(b?.contents?.balance);
  if (!Number.isFinite(n)) throw new FlwError("VTpass balance unavailable", b);
  return n;
}
