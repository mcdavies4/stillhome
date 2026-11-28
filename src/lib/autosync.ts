// AutoSyncNG client (v1 API) for electricity, and the requery and balance calls the other bills need.
//
// Documented here (from AutoSyncNG's v1 docs):
//   GET  /api/v1/me                          → user.wallet_balance, user.wallet.spendable_balance
//   POST /api/v1/elect (purchase electricity) body: request_ref, meter_number, product_id, type, amount, pin
//   GET  /api/v1/transaction/{reference}     → transaction.status: successful | failed | pending
//
// Not documented / not yet confirmed (so NOT built as purchases here):
//   - the response to a failed purchase (docs show only {status:"error", message})
//   - whether a failed purchase is refunded to the AutoSync wallet
//   - whether purchases need the transaction PIN (electricity docs say yes; the webhook hash also uses it)
//   - the webhook signature scheme (docs: sha256("<pin>:<reference>"))
//
// Safety rules (same as smeplug.ts):
//   - Only a clean, documented 4xx rejection is "not vended" (safe to refund). Anything else is unknown.
//   - The requery never reports "not found" as failed. A missing or unreadable answer is pending.
//   - Request and response bodies are never logged: the transaction log in AutoSync's sample holds a PIN.
//
// Config (Vercel): AUTOSYNC_API_KEY (Bearer token), AUTOSYNC_PIN (transaction PIN, read only at purchase),
//   optional AUTOSYNC_BASE (default https://autosyncng.com/api/v1).
// The whole provider stays off until BILLS_PROVIDER or BILLS_FAILOVER_PROVIDER names "autosync".

import { FlwError } from "@/lib/flutterwave";
import type { BillerItem, ValidateResult, BillPaymentResult } from "@/lib/flutterwave";

const base = () => (process.env.AUTOSYNC_BASE ?? "https://autosyncng.com/api/v1").trim().replace(/\/+$/, "");
const apiKey = () => (process.env.AUTOSYNC_API_KEY ?? "").trim();
const pin = () => (process.env.AUTOSYNC_PIN ?? "").trim();

export const autosyncConfigured = () => !!apiKey();

function notVended(message: string, raw?: unknown): FlwError {
  const e = new FlwError(message, raw);
  e.notVended = true;
  return e;
}

async function asCall(
  path: string,
  opts: { method: "GET" | "POST"; body?: Record<string, unknown>; timeoutMs?: number } = { method: "GET" },
): Promise<{ http: number; body: any }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 30000);
  let res: Response;
  try {
    res = await fetch(`${base()}${path}`, {
      method: opts.method,
      headers: {
        Authorization: `Bearer ${apiKey()}`,
        Accept: "application/json",
        ...(opts.body ? { "Content-Type": "application/json" } : {}),
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      cache: "no-store",
      signal: ctrl.signal,
    });
  } catch (e: any) {
    const why = e?.name === "AbortError" ? "timed out" : "network error";
    // Never log the body or the request: the request carries the transaction PIN.
    console.error(`[autosync] ${opts.method} ${path} -> ${why}`);
    throw new FlwError(`AutoSyncNG did not respond (${why}); the outcome is unknown`);
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  return { http: res.status, body };
}

/** Wallet balance, from GET /me. Used to refuse a sale before money moves. */
export async function autosyncBalance(): Promise<number> {
  const r = await asCall("/me", { method: "GET" });
  const n = Number(r.body?.data?.user?.wallet?.spendable_balance ?? r.body?.data?.user?.wallet_balance);
  if (r.http < 200 || r.http >= 300 || !Number.isFinite(n)) {
    throw new FlwError(`AutoSyncNG balance unavailable (HTTP ${r.http})`);
  }
  return n;
}

export type AutosyncStatus = "successful" | "failed" | "pending";

export interface AutosyncRequery {
  found: boolean;
  state: AutosyncStatus;
  detail: string;
}

/**
 * Requery a transaction by our request_ref (or AutoSync's reference). Only an explicit "failed" is failed.
 * Missing, unreadable or "pending" answers are pending, so nothing is refunded on a guess.
 */
export async function autosyncRequery(reference: string): Promise<AutosyncRequery> {
  const r = await asCall(`/transaction/${encodeURIComponent(reference)}`, { method: "GET" });
  if (r.http === 404) return { found: false, state: "pending", detail: "no AutoSyncNG record yet" };
  if (r.http < 200 || r.http >= 300) return { found: true, state: "pending", detail: `HTTP ${r.http}` };
  const st = String(r.body?.data?.transaction?.status ?? "").toLowerCase();
  if (st === "successful") return { found: true, state: "successful", detail: st };
  if (st === "failed") return { found: true, state: "failed", detail: st };
  return { found: true, state: "pending", detail: st || "unknown" };
}

export interface AutosyncMeterCheck {
  valid: boolean;
  customerName: string | null;
  outstanding: number | null;
}

/**
 * Check a meter number before taking money (POST /validate/electricity, from the v1 docs).
 * A missing or unreadable answer is "not valid", so nothing is sold on a guess.
 * The customer name is returned to the caller only; it is never logged.
 */
export async function autosyncValidateMeter(meterNumber: string, productId: string, type: "prepaid" | "postpaid"): Promise<AutosyncMeterCheck> {
  const r = await asCall("/validate/electricity", {
    method: "POST",
    body: { meter_number: meterNumber, product_id: productId, type },
  });
  const d = r.body?.data;
  if (r.http < 200 || r.http >= 300 || r.body?.status !== "ok" || d?.is_valid !== true) {
    return { valid: false, customerName: null, outstanding: null };
  }
  const out = Number(d?.outstanding_amount);
  return {
    valid: true,
    customerName: d?.customer_name ? String(d.customer_name).trim() : null,
    outstanding: Number.isFinite(out) ? out : null,
  };
}

export interface AutosyncCableCheck {
  valid: boolean;
  customerName: string | null;
  outstanding: number | null;
  accountStatus: string | null;
}

/**
 * Check a decoder IUC / smartcard number before taking money (POST /validate/cable, from the v1 docs).
 * product_id is the cable provider's id (DSTV 51, GOtv 50, Showmax 53, StarTimes 52 per GET /cable).
 * A missing or unreadable answer is "not valid". The customer name is never logged.
 */
export async function autosyncValidateCable(iucNumber: string, productId: string): Promise<AutosyncCableCheck> {
  const r = await asCall("/validate/cable", {
    method: "POST",
    body: { iuc_number: iucNumber, product_id: productId },
  });
  const d = r.body?.data;
  if (r.http < 200 || r.http >= 300 || r.body?.status !== "ok" || d?.is_valid !== true) {
    return { valid: false, customerName: null, outstanding: null, accountStatus: null };
  }
  const out = Number(d?.outstanding_amount);
  return {
    valid: true,
    customerName: d?.customer_name ? String(d.customer_name).trim() : null,
    outstanding: Number.isFinite(out) ? out : null,
    accountStatus: d?.account_status ? String(d.account_status) : null,
  };
}

export interface AutosyncCableRenewParams {
  requestRef: string; // our reference, sent as request_ref
  iucNumber: string;
  productId: string; // dstv | gotv | showmax | startimes (or the numeric id)
  amount: number; // the customer's outstanding_amount from validation
}

/**
 * Renew a cable (TV) subscription (POST /cable, from the v1 docs).
 * variation_code is "none" for a renewal, per the docs. Same safety rules as electricity:
 * only a clean 4xx is "not vended"; anything else is unknown and goes to requery, never an automatic refund.
 * Uses the transaction PIN from AUTOSYNC_PIN; the PIN is never logged or returned.
 */
export async function autosyncRenewCable(p: AutosyncCableRenewParams): Promise<{ reference: string }> {
  const secret = pin();
  if (!secret) throw new FlwError("AUTOSYNC_PIN is not set; AutoSyncNG purchases need the transaction PIN");

  const r = await asCall("/cable", {
    method: "POST",
    body: {
      request_ref: p.requestRef,
      iuc_number: p.iucNumber,
      product_id: p.productId,
      variation_code: "none",
      type: "renew",
      amount: p.amount,
      pin: secret,
    },
  });
  const tx = r.body?.data?.transaction;
  const msg = String(r.body?.message ?? "");

  if (r.http >= 200 && r.http < 300 && r.body?.status === "ok" && tx?.reference) {
    return { reference: String(tx.reference) };
  }
  if (r.http >= 400 && r.http < 500 && r.http !== 408 && r.http !== 429) {
    throw notVended(`AutoSyncNG rejected the cable renewal (HTTP ${r.http})${msg ? `: ${msg}` : ""}`);
  }
  throw new FlwError(`AutoSyncNG cable outcome unclear (HTTP ${r.http})`);
}

export interface AutosyncElectricityParams {
  requestRef: string; // our reference, sent as request_ref
  meterNumber: string;
  productId: string; // from the electricity category list
  type: "prepaid" | "postpaid";
  amount: number;
}

/**
 * Buy electricity. Throws notVended only on a clean 4xx rejection. A 5xx, a timeout, or an
 * "error" body is unknown: the money may have moved, so it goes to review, never to an automatic refund.
 * Uses the transaction PIN from AUTOSYNC_PIN; the PIN is never logged or returned.
 */
export async function autosyncBuyElectricity(p: AutosyncElectricityParams): Promise<{ reference: string; token: string | null }> {
  const secret = pin();
  if (!secret) throw new FlwError("AUTOSYNC_PIN is not set; AutoSyncNG purchases need the transaction PIN");

  // Path from the v1 docs ("POST electricity"). Product id/code from GET /electricity. Confirm with a test before live use.
  const r = await asCall("/electricity", {
    method: "POST",
    body: {
      request_ref: p.requestRef,
      meter_number: p.meterNumber,
      product_id: p.productId,
      type: p.type,
      amount: p.amount,
      pin: secret,
    },
  });
  const tx = r.body?.data?.transaction;
  const msg = String(r.body?.message ?? "");

  if (r.http >= 200 && r.http < 300 && r.body?.status === "ok" && tx?.reference) {
    return { reference: String(tx.reference), token: tx.token ? String(tx.token) : null };
  }
  // Clean rejection: a 4xx other than timeout or rate limit, and nothing was bought.
  if (r.http >= 400 && r.http < 500 && r.http !== 408 && r.http !== 429) {
    throw notVended(`AutoSyncNG rejected the electricity purchase (HTTP ${r.http})${msg ? `: ${msg}` : ""}`);
  }
  // Anything else is unknown. Requery before deciding anything.
  throw new FlwError(`AutoSyncNG electricity outcome unclear (HTTP ${r.http})`);
}

// ───────────────────────── bills-provider adapter (electricity) ─────────────────────────
// Electricity only for now. Cable renewals need a variable-amount flow that isn't wired yet.

/** AutoSync's disco product ids (from GET /electricity), keyed by the code we use as biller_code. */
export const AUTOSYNC_DISCO_IDS: Record<string, { id: number; name: string }> = {
  aba: { id: 49, name: "Aba Electricity Distribution Company [APLE]" },
  abuja: { id: 44, name: "Abuja Electricity Distribution Company [AEDC]" },
  benin: { id: 46, name: "Benin Electricity Distribution Company [BEDC]" },
  eko: { id: 45, name: "Eko Electricity Distribution Company [EKEDC]" },
  enugu: { id: 43, name: "Enugu Electricity Distribution Company [EEDC]" },
  ibadan: { id: 38, name: "Ibadan Electricity Distribution Company [IBEDC]" },
  ikeja: { id: 39, name: "Ikeja Electricity Distribution Company [IKEDC]" },
  jos: { id: 42, name: "Jos Electricity Distribution Company [JED]" },
  kaduna: { id: 48, name: "Kaduna Electricity Distribution Company [KAEDC]" },
  kano: { id: 40, name: "Kano Electricity Distribution Company [KEDCO]" },
  port: { id: 41, name: "Port Harcourt Electricity Distribution Company [PHED]" },
  yola: { id: 47, name: "Yola Electricity Distribution Company [YEDC]" },
};

export const autosyncReference = (orderId: string): string => `ASN${orderId.replace(/-/g, "").toLowerCase()}`;
export const isAutosyncReference = (ref: string): boolean => /^ASN[0-9a-f]{32}$/i.test(ref);

/** Electricity products for the catalogue: each distributor, prepaid or postpaid. Amount is chosen by the customer. */
export function autosyncCatalogue(): BillerItem[] {
  const out: BillerItem[] = [];
  for (const [code, d] of Object.entries(AUTOSYNC_DISCO_IDS)) {
    for (const [type, n] of [["prepaid", 1], ["postpaid", 2]] as const) {
      out.push({
        id: d.id * 10 + n,
        biller_code: code,
        item_code: type,
        name: `${d.name} (${type})`,
        biller_name: d.name,
        short_name: code.toUpperCase(),
        amount: 0,
        fee: 0,
        country: "NG",
        is_airtime: false,
        label_name: `${d.name} (${type})`,
      } as BillerItem);
    }
  }
  return out;
}

/** Meter check for the bills flow. A failed or unreadable check is "not valid", so nothing is sold on a guess. */
export async function autosyncValidateElectricity(identifier: string, billerCode: string, itemCode: string): Promise<ValidateResult> {
  const d = AUTOSYNC_DISCO_IDS[billerCode];
  const type = itemCode === "postpaid" ? "postpaid" : "prepaid";
  if (!d) return { response_code: "01", response_message: "Unknown distributor", name: null, customer: identifier, minimum: 0, maximum: 0, fee: 0 } as ValidateResult;
  const c = await autosyncValidateMeter(identifier, String(d.id), type);
  return {
    response_code: c.valid ? "00" : "01",
    response_message: c.valid ? "Verified" : "Meter not verified",
    name: c.customerName,
    customer: identifier,
    minimum: 0,
    maximum: 0,
    fee: 0,
  } as ValidateResult;
}

/** Vend one electricity order through the bills flow. Clean rejections are refundable; everything else is not. */
export async function autosyncVendElectricity(params: {
  billerCode: string;
  itemCode: string;
  identifier: string;
  amountLocal: number;
  reference: string;
}): Promise<BillPaymentResult> {
  const d = AUTOSYNC_DISCO_IDS[params.billerCode];
  if (!d) throw notVended(`AutoSyncNG has no distributor mapping for ${params.billerCode}`);
  const type = params.itemCode === "postpaid" ? "postpaid" : "prepaid";
  const r = await autosyncBuyElectricity({
    requestRef: params.reference,
    meterNumber: params.identifier,
    productId: String(d.id),
    type,
    amount: Math.round(params.amountLocal),
  });
  return {
    amount: params.amountLocal,
    flw_ref: r.reference,
    tx_ref: params.reference,
    reference: params.reference,
    extra: r.token,
  } as BillPaymentResult;
}
