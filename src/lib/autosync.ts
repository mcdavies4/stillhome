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

  // UNVERIFIED path: the docs paste showed the body but not the URL. Confirm before any live purchase.
  const r = await asCall("/elect", {
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
