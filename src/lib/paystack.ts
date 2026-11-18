// src/lib/paystack.ts
// Minimal Paystack client for the Nigeria-domestic (₦) payment path.
// Used by /api/checkout (initialise) and /api/paystack/webhook (verify + refund).
//
// Env:
//   PAYSTACK_SECRET_KEY   sk_test_… (test mode) or sk_live_… (after Paystack approves)
//                         Must be the key of the *Nolgic* Paystack business — keys and
//                         webhooks are separate per Paystack business.

import crypto from "crypto";

const BASE = "https://api.paystack.co";

export class PaystackError extends Error {
  constructor(message: string, public raw?: unknown, public http = 0) {
    super(message);
    this.name = "PaystackError";
  }
}

export function paystackConfigured(): boolean {
  return !!process.env.PAYSTACK_SECRET_KEY;
}

export function paystackIsTestMode(): boolean {
  return (process.env.PAYSTACK_SECRET_KEY ?? "").startsWith("sk_test");
}

async function ps<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const key = process.env.PAYSTACK_SECRET_KEY;
  if (!key) throw new PaystackError("PAYSTACK_SECRET_KEY is not set");

  const res = await fetch(`${BASE}${path}`, {
    ...init,
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  let body: any = null;
  try {
    body = JSON.parse(text);
  } catch {
    /* non-JSON */
  }
  if (!res.ok || body?.status === false) {
    console.error(`[paystack] ${path} -> ${res.status}: ${text.slice(0, 500)}`);
    throw new PaystackError(body?.message ?? `Paystack HTTP ${res.status}`, body, res.status);
  }
  return body as T;
}

/** Order references are deterministic so the webhook can cross-check them. */
export const paystackReferenceFor = (orderId: string) => `NLG-${orderId}`;

/** Create a hosted-checkout transaction. `amountNgn` is whole naira. */
export async function initializeTransaction(p: {
  email: string;
  amountNgn: number;
  orderId: string;
  callbackUrl: string;
  /** Pay for Me: its own reference and metadata (one payment covers several orders). Everything else leaves these unset. */
  reference?: string;
  metadata?: Record<string, unknown>;
  /** Repeat-monthly first payments are card-only, so Paystack returns a card token we can reuse. */
  channels?: string[];
}): Promise<{ authorizationUrl: string; reference: string }> {
  const reference = p.reference ?? paystackReferenceFor(p.orderId);
  const r = await ps<{ data: { authorization_url: string; reference: string } }>(
    "/transaction/initialize",
    {
      method: "POST",
      body: JSON.stringify({
        email: p.email,
        amount: Math.round(p.amountNgn * 100), // kobo
        currency: "NGN",
        reference,
        callback_url: p.callbackUrl,
        channels: p.channels ?? ["card", "bank", "ussd", "bank_transfer"],
        metadata: p.metadata ?? { order_id: p.orderId },
      }),
    }
  );
  return { authorizationUrl: r.data.authorization_url, reference: r.data.reference };
}

/**
 * Charge a card the customer already authorised (monthly repeat). Only works for an authorization whose
 * `reusable` flag was true, and only with the email that made the first payment.
 * Returns Paystack's status; a challenged charge comes back with paused=true and an authorization_url.
 */
export async function chargeAuthorization(p: {
  email: string;
  amountNgn: number;
  authorizationCode: string;
  reference: string;
  metadata?: Record<string, unknown>;
}): Promise<{ status: string; paused: boolean; authorizationUrl: string | null; reference: string }> {
  const r = await ps<{ data: { status?: string; paused?: boolean; authorization_url?: string; reference?: string } }>(
    "/transaction/charge_authorization",
    {
      method: "POST",
      body: JSON.stringify({
        email: p.email,
        amount: Math.round(p.amountNgn * 100), // kobo
        currency: "NGN",
        authorization_code: p.authorizationCode,
        reference: p.reference,
        metadata: p.metadata ?? {},
      }),
    }
  );
  return {
    status: String(r.data?.status ?? "").toLowerCase(),
    paused: r.data?.paused === true,
    authorizationUrl: r.data?.authorization_url ?? null,
    reference: String(r.data?.reference ?? p.reference),
  };
}

/** Server-side re-check of a transaction (belt and braces after the webhook). */
export async function verifyTransaction(reference: string): Promise<{
  status: string;
  amountKobo: number;
  currency: string;
  reference: string;
  feeKobo: number;
}> {
  const r = await ps<{ data: { status: string; amount: number; currency: string; reference?: string; fees?: number | null } }>(
    `/transaction/verify/${encodeURIComponent(reference)}`
  );
  // `fees` is what Paystack actually charged us on this payment, in kobo (0 if Paystack hasn't reported it yet).
  return { status: String(r.data.status ?? "").toLowerCase(), amountKobo: Number(r.data.amount), currency: String(r.data.currency ?? "").toUpperCase(), reference: String(r.data.reference ?? ""), feeKobo: Math.max(0, Math.round(Number(r.data.fees ?? 0))) };
}

/** "No such transaction yet" is an answer (the customer has not paid), not an error. */
export const paystackNotFound = (e: unknown) => e instanceof PaystackError && (e.http === 404 || /not found|transaction reference/i.test(e.message));

/**
 * Full refund of a transaction by reference. Paystack refunds come out of your
 * Paystack balance; if it can't cover it yet, the refund stays "pending" until it can.
 * Throws if Paystack rejects the request outright.
 */
export async function refundTransaction(reference: string, amountNgn?: number): Promise<{ status: string }> {
  // No amount = refund everything. With an amount (whole or fractional naira) = a PARTIAL refund of that much
  // (Pay for Me refunds one item of a multi-item payment).
  if (amountNgn !== undefined && (!Number.isFinite(amountNgn) || amountNgn <= 0)) throw new PaystackError("Bad refund amount");
  const r = await ps<{ data: { status?: string } }>("/refund", {
    method: "POST",
    body: JSON.stringify(amountNgn === undefined ? { transaction: reference } : { transaction: reference, amount: Math.round(amountNgn * 100) }),
  });
  return { status: r.data?.status ?? "unknown" };
}

/** x-paystack-signature = HMAC-SHA512(raw body, secret key). Constant-time compare. */
export function verifyWebhookSignature(rawBody: string, signature: string | null): boolean {
  const key = process.env.PAYSTACK_SECRET_KEY;
  if (!key || !signature) return false;
  const expected = crypto.createHmac("sha512", key).update(rawBody, "utf8").digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(signature, "hex"));
  } catch {
    return false;
  }
}
