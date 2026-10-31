// src/lib/flwpay.ts
// Flutterwave (v3 Standard) as a naira PAY-IN rail — the alternative to Paystack.
// Chosen with NGN_PAY_PROVIDER=flutterwave (default is paystack). Not to be confused with
// src/lib/flutterwave.ts, which is Flutterwave BILLS (buying airtime/electricity).
//
// Docs: https://developer.flutterwave.com/docs/collecting-payments/standard
//   create   POST /v3/payments                      -> data.link (hosted checkout)
//   verify   GET  /v3/transactions/{id}/verify      (also /v3/transactions/verify_by_reference?tx_ref=)
//   refund   POST /v3/transactions/{id}/refund
//   webhook  header `verif-hash` == FLW_SECRET_HASH (dashboard "Secret Hash"); a `flutterwave-signature`
//            HMAC is also accepted. A webhook is only a nudge: every payment is re-verified with the API.
//
// Uses the same FLW_SECRET_KEY as Flutterwave bills, and the same optional relay (FLW_BASE).

import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { flwBase, flwExtraHeaders } from "@/lib/flutterwave";

export type NgnPayProvider = "paystack" | "flutterwave";

/** Which rail takes naira. Anything but "flutterwave" keeps Paystack, so deploying changes nothing. */
export function ngnPayProvider(): NgnPayProvider {
  return (process.env.NGN_PAY_PROVIDER ?? "").trim().toLowerCase() === "flutterwave" ? "flutterwave" : "paystack";
}

export const payProviderLabel = (p: string | null | undefined) =>
  p === "flutterwave" ? "Flutterwave" : p === "paystack" ? "Paystack" : "Stripe";

const secretKey = () => (process.env.FLW_SECRET_KEY ?? "").trim();

export const flwPayConfigured = () => !!secretKey();
/** Flutterwave test keys start FLWSECK_TEST — nobody is really charged. */
export const flwPayIsTestMode = () => secretKey().startsWith("FLWSECK_TEST");

export class FlwPayError extends Error {
  http: number;
  raw: unknown;
  constructor(message: string, http = 0, raw?: unknown) {
    super(message);
    this.name = "FlwPayError";
    this.http = http;
    this.raw = raw;
  }
}

/** tx_ref is deterministic, so the webhook and the verify call can cross-check it. */
export const flwPayReferenceFor = (orderId: string) => `NLGFW-${orderId}`;
export const orderIdFromFlwPayRef = (ref: string): string | null => {
  const m = /^NLGFW-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(ref);
  return m ? m[1].toLowerCase() : null;
};

async function fw(path: string, init: RequestInit = {}): Promise<any> {
  let res: Response;
  let text = "";
  try {
    res = await fetch(`${flwBase()}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${secretKey()}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        ...flwExtraHeaders(),
        ...(init.headers ?? {}),
      },
      signal: AbortSignal.timeout(20_000),
      redirect: "manual",
    });
    text = await res.text();
  } catch (e: any) {
    console.error(`[flwpay] ${init.method ?? "GET"} ${path} -> network error: ${String(e?.message ?? e)}`);
    throw new FlwPayError("Flutterwave could not be reached", 0, { network: true });
  }
  let body: any = {};
  try { body = JSON.parse(text); } catch { /* non-JSON */ }
  if (!res.ok || String(body?.status ?? "").toLowerCase() === "error") {
    console.error(`[flwpay] ${path} -> ${res.status}: ${text.slice(0, 400)}`);
    throw new FlwPayError(String(body?.message ?? `Flutterwave HTTP ${res.status}`).slice(0, 160), res.status, body);
  }
  return body;
}

/** Create a hosted-checkout payment. `amountNgn` is whole naira (Flutterwave takes naira, not kobo). */
export async function initializePayment(p: {
  email: string;
  name?: string | null;
  amountNgn: number;
  orderId: string;
  redirectUrl: string;
  description: string;
}): Promise<{ link: string; txRef: string }> {
  const txRef = flwPayReferenceFor(p.orderId);
  const body = await fw("/payments", {
    method: "POST",
    body: JSON.stringify({
      tx_ref: txRef,
      amount: p.amountNgn,
      currency: "NGN",
      redirect_url: p.redirectUrl,
      customer: { email: p.email, ...(p.name ? { name: p.name } : {}) },
      meta: { order_id: p.orderId },
      customizations: { title: "Nolgic", description: p.description.slice(0, 100) },
    }),
  });
  const link = body?.data?.link;
  if (typeof link !== "string" || !/^https:\/\//i.test(link)) throw new FlwPayError("Flutterwave returned no payment link", 0, body);
  return { link, txRef };
}

export interface FlwTx {
  id: string;
  status: string; // lower-cased: "successful" | "failed" | "pending" | …
  amount: number; // the amount WE asked for (fees are separate), in naira
  chargedAmount: number;
  currency: string;
  txRef: string;
}

function norm(d: any): FlwTx {
  return {
    id: String(d?.id ?? ""),
    status: String(d?.status ?? "").toLowerCase(),
    amount: Number(d?.amount),
    chargedAmount: Number(d?.charged_amount),
    currency: String(d?.currency ?? "").toUpperCase(),
    txRef: String(d?.tx_ref ?? ""),
  };
}

/** Authoritative status of a transaction by Flutterwave's own transaction id. */
export async function verifyById(id: string | number): Promise<FlwTx> {
  const safe = String(id).replace(/[^0-9]/g, "");
  if (!safe) throw new FlwPayError("Bad transaction id");
  const b = await fw(`/transactions/${safe}/verify`);
  return norm(b?.data);
}

/** Same, by our tx_ref — used when we don't have the id yet (customer came back before the webhook). */
export async function verifyByReference(txRef: string): Promise<FlwTx> {
  const b = await fw(`/transactions/verify_by_reference?tx_ref=${encodeURIComponent(txRef)}`);
  return norm(b?.data);
}

/** Full refund of a transaction. Throws if Flutterwave rejects it outright. */
export async function refundTransaction(id: string | number): Promise<{ status: string }> {
  const safe = String(id).replace(/[^0-9]/g, "");
  if (!safe) throw new FlwPayError("Bad transaction id");
  const b = await fw(`/transactions/${safe}/refund`, { method: "POST", body: JSON.stringify({}) });
  return { status: String(b?.data?.status ?? b?.status ?? "unknown") };
}

const eq = (a: string, b: string) => {
  const x = createHash("sha256").update(a).digest();
  const y = createHash("sha256").update(b).digest();
  return timingSafeEqual(x, y);
};

/**
 * Accepts either of Flutterwave's webhook proofs: `verif-hash` equal to your dashboard Secret Hash, or a
 * `flutterwave-signature` (base64 HMAC-SHA256 of the raw body keyed with that Secret Hash).
 * Fails closed without FLW_SECRET_HASH.
 */
export function flwVerifyWebhook(rawBody: string, h: { verifHash: string | null; signature: string | null }): boolean {
  const secret = (process.env.FLW_SECRET_HASH ?? "").trim();
  if (!secret) return false;
  let ok = false;
  if (h.verifHash && eq(h.verifHash.trim(), secret)) ok = true;
  if (h.signature) {
    const mac = createHmac("sha256", secret).update(rawBody, "utf8").digest("base64");
    if (eq(mac, h.signature.trim())) ok = true;
  }
  return ok;
}

export function parseFlwWebhook(payload: unknown): { event: string; id: string | null; txRef: string; status: string } | null {
  const p = (payload ?? {}) as any;
  const d = p.data ?? {};
  const txRef = typeof d.tx_ref === "string" ? d.tx_ref.trim() : "";
  if (!txRef || txRef.length > 100) return null;
  return {
    event: String(p.event ?? p.type ?? ""),
    id: d.id != null ? String(d.id) : null,
    txRef,
    status: String(d.status ?? "").toLowerCase(),
  };
}
