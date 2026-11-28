// SMEPlug client (smeplug.ng) for airtime, using the documented v1 API.
//
// Documented endpoints used here:
//   GET  /api/v1/account/balance          → { balance }
//   POST /api/v1/airtime/purchase         → { status: true, data: { reference, msg } }
//   GET  /api/v1/transactions/{reference} → { status, reference, customer_reference, ... }
//
// Safety rules (same idea as paybeta.ts):
//   - Only a clean, documented rejection is "not vended" (safe to refund).
//   - Timeouts, 5xx and unreadable answers are ambiguous: the money may have moved,
//     so they are NOT refundable and go to review.
//   - The requery never reports "not_found"; a missing record is treated as pending.
//
// Config (Vercel): SMEPLUG_API_KEY (secret key, sent as Bearer), optional SMEPLUG_BASE.

import { FlwError } from "@/lib/flutterwave";
import { toLocalPhone } from "@/lib/vtpass";

const base = () => (process.env.SMEPLUG_BASE ?? "https://smeplug.ng").trim().replace(/\/+$/, "");
const apiKey = () => (process.env.SMEPLUG_API_KEY ?? "").trim();

export const smeplugConfigured = () => !!apiKey();

/** Network IDs from GET /api/v1/networks: 1 MTN, 2 Airtel, 3 9Mobile, 4 Glo. */
export const SME_NETWORK_IDS = { MTN: 1, AIRTEL: 2, "9MOBILE": 3, GLO: 4 } as const;

/** Map one of our airtime biller codes/names to a SMEPlug network ID, or null if unknown. */
export function smeNetworkFor(billerCode: string, billerName: string, itemCode = ""): number | null {
  const s = `${billerCode} ${billerName} ${itemCode}`.toUpperCase();
  if (/\bMTN\b/.test(s)) return SME_NETWORK_IDS.MTN;
  if (/\bAIRTEL\b/.test(s)) return SME_NETWORK_IDS.AIRTEL;
  if (/\b9MOBILE\b|\bETISALAT\b/.test(s)) return SME_NETWORK_IDS["9MOBILE"];
  if (/\bGLO\b/.test(s)) return SME_NETWORK_IDS.GLO;
  return null;
}

/** Our order reference sent as SMEPlug's customer_reference: "SME" + the order UUID without dashes. */
export function smeReference(orderId: string): string {
  return `SME${orderId.replace(/-/g, "").toLowerCase()}`;
}

export function isSmeReference(ref: string): boolean {
  return /^SME[0-9a-f]{32}$/i.test(ref);
}

function notVended(message: string, raw?: unknown): FlwError {
  const e = new FlwError(message, raw);
  e.notVended = true;
  return e;
}

async function smeCall(
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
    // Timeout or network drop: we cannot tell whether SMEPlug processed it. Never refundable.
    const why = e?.name === "AbortError" ? "timed out" : "network error";
    console.error(`[smeplug] ${opts.method} ${path} -> ${why}: ${String(e?.message ?? e)}`);
    throw new FlwError(`SMEPlug did not respond (${why}); the vend outcome is unknown`);
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

/** Wallet balance in naira, used to refuse a sale before money moves. */
export async function smeBalance(): Promise<number> {
  const r = await smeCall("/api/v1/account/balance", { method: "GET" });
  const n = Number(r.body?.balance);
  if (r.http < 200 || r.http >= 300 || !Number.isFinite(n)) {
    throw new FlwError(`SMEPlug balance unavailable (HTTP ${r.http})`, r.body);
  }
  return n;
}

export interface SmeAirtimeResult {
  reference: string; // SMEPlug's own reference
  msg: string;
}

/**
 * Buy airtime. Throws notVended only on a clear rejection; anything unclear is a plain error
 * (which the order pipeline routes to review, never to an automatic refund).
 */
export async function smeBuyAirtime(params: {
  networkId: number;
  phone: string;
  amount: number;
  reference: string; // our customer_reference
}): Promise<SmeAirtimeResult> {
  const phone = toLocalPhone(params.phone);
  if (!phone) throw notVended("The phone number for this SMEPlug airtime vend isn't a valid Nigerian mobile");

  const r = await smeCall("/api/v1/airtime/purchase", {
    method: "POST",
    body: {
      network_id: params.networkId,
      phone,
      amount: Math.round(params.amount),
      customer_reference: params.reference,
    },
  });
  const msg = String(r.body?.data?.msg ?? r.body?.message ?? "");

  if (r.http >= 200 && r.http < 300 && r.body?.status === true && r.body?.data?.reference) {
    return { reference: String(r.body.data.reference), msg };
  }
  // 4xx (other than timeout/rate-limit) and an explicit status:false are clean rejections: nothing bought.
  if (r.http >= 400 && r.http < 500 && r.http !== 408 && r.http !== 429) {
    throw notVended(`SMEPlug rejected the airtime purchase (HTTP ${r.http})${msg ? `: ${msg}` : ""}`, r.body);
  }
  if (r.body?.status === false) {
    throw notVended(`SMEPlug rejected the airtime purchase${msg ? `: ${msg}` : ""}`, r.body);
  }
  // 5xx, 408, 429, or a 2xx we cannot read: the money may have moved. Not refundable.
  throw new FlwError(`SMEPlug airtime outcome unclear (HTTP ${r.http})`, r.body);
}

export interface SmeStatus {
  found: boolean;
  state: "success" | "failed" | "pending";
  detail: string;
}

/**
 * Requery a purchase by our customer_reference. Only an explicit failure is reported as failed.
 * A missing record or any unrecognised answer is pending, so nothing is refunded on a guess.
 */
export async function smeStatus(customerReference: string): Promise<SmeStatus> {
  const r = await smeCall(`/api/v1/transactions/${encodeURIComponent(customerReference)}`, { method: "GET" });
  if (r.http === 404) return { found: false, state: "pending", detail: "no SMEPlug record yet" };
  if (r.http < 200 || r.http >= 300) return { found: true, state: "pending", detail: `HTTP ${r.http}` };
  const st = String(r.body?.status ?? "").toLowerCase();
  if (st === "success" || st === "successful" || st === "completed") return { found: true, state: "success", detail: st };
  if (st.includes("fail")) return { found: true, state: "failed", detail: st };
  return { found: true, state: "pending", detail: st || "unknown" };
}
