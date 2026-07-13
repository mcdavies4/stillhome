// src/lib/partners.ts
// Core helpers for the Nolgic Partner API (B2B layer).
// Everything here runs server-side only, with the Supabase service role.

import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { createHash, createHmac, randomBytes } from "node:crypto";

// ------------------------------------------------------------------
// Supabase (service role — bypasses RLS; never expose to the browser)
// ------------------------------------------------------------------

let _admin: SupabaseClient | null = null;
export function supabaseAdmin(): SupabaseClient {
  if (!_admin) {
    _admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } }
    );
  }
  return _admin;
}

// ------------------------------------------------------------------
// Types
// ------------------------------------------------------------------

export type Partner = {
  id: string;
  name: string;
  slug: string;
  status: "active" | "suspended";
  fee_bps: number;
  fee_min_pence: number;
  fx_margin_bps: number;
  max_order_ngn: number;
  daily_cap_pence: number;
  webhook_url: string | null;
  webhook_secret: string;
};

export type PartnerAuth = {
  partner: Partner;
  keyId: string;
  environment: "live" | "test";
};

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// ------------------------------------------------------------------
// API key auth
// Key format handed to a partner (shown once, never stored):
//   nolgic_live_<43 chars base64url>  /  nolgic_test_<...>
// We store: key_prefix = first 16 chars (indexed lookup),
//           key_hash   = sha256 hex of the full key.
// ------------------------------------------------------------------

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function generateApiKey(environment: "live" | "test"): {
  key: string;
  prefix: string;
  hash: string;
} {
  const key = `nolgic_${environment}_${randomBytes(32).toString("base64url")}`;
  return { key, prefix: key.slice(0, 16), hash: sha256Hex(key) };
}

export async function requirePartner(req: Request): Promise<PartnerAuth> {
  const header = req.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(nolgic_(live|test)_[A-Za-z0-9_-]+)$/);
  if (!match) {
    throw new ApiError(401, "unauthorized", "Missing or malformed API key.");
  }
  const key = match[1];
  const environment = match[2] as "live" | "test";
  const db = supabaseAdmin();

  const { data: keyRow, error } = await db
    .from("partner_api_keys")
    .select("id, partner_id, key_hash, environment, revoked_at")
    .eq("key_prefix", key.slice(0, 16))
    .is("revoked_at", null)
    .maybeSingle();

  if (error || !keyRow || keyRow.key_hash !== sha256Hex(key)) {
    throw new ApiError(401, "unauthorized", "Invalid API key.");
  }

  const { data: partner } = await db
    .from("partners")
    .select(
      "id, name, slug, status, fee_bps, fee_min_pence, fx_margin_bps, max_order_ngn, daily_cap_pence, webhook_url, webhook_secret"
    )
    .eq("id", keyRow.partner_id)
    .single();

  if (!partner) throw new ApiError(401, "unauthorized", "Partner not found.");
  if (partner.status !== "active") {
    throw new ApiError(403, "partner_suspended", "This partner account is suspended.");
  }

  // Fire-and-forget usage stamp.
  void db
    .from("partner_api_keys")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", keyRow.id)
    .then(() => {});

  return { partner: partner as Partner, keyId: keyRow.id, environment };
}

// ------------------------------------------------------------------
// Pricing
// Quote is a pure calculator; /vend recomputes with the same function
// at execution time, so quotes can never be tampered with or go stale.
// ------------------------------------------------------------------

export type Quote = {
  amount_ngn: number;
  fx_ngn_per_gbp: number; // effective rate for THIS partner
  base_gbp_pence: number;
  fee_pence: number;
  total_gbp_pence: number;
};

export function priceOrder(partner: Partner, amountNgn: number): Quote {
  const baseRate = Number(process.env.NGN_PER_GBP);
  if (!baseRate || baseRate <= 0) {
    throw new ApiError(500, "config_error", "FX rate not configured.");
  }
  // Partner margin makes their rate slightly worse than your base rate.
  const effectiveRate = baseRate * (1 - partner.fx_margin_bps / 10_000);
  const basePence = Math.ceil((amountNgn / effectiveRate) * 100);
  const feePence = Math.max(
    partner.fee_min_pence,
    Math.ceil((basePence * partner.fee_bps) / 10_000)
  );
  return {
    amount_ngn: amountNgn,
    fx_ngn_per_gbp: Math.round(effectiveRate * 100) / 100,
    base_gbp_pence: basePence,
    fee_pence: feePence,
    total_gbp_pence: basePence + feePence,
  };
}

// ------------------------------------------------------------------
// Flutterwave bill vend (synchronous create + short requery loop)
// NOTE: field mapping mirrors the FLW v3 Bills API. If your existing
// consumer vend call maps biller_code/item_code differently, align
// this ONE function with it — everything else stays the same.
// ------------------------------------------------------------------

type VendResult =
  | { ok: true; token: string | null; flwRef: string }
  | { ok: false; error: string }
  | { ok: null; error: string }; // ambiguous — leave for review

export async function flwVend(params: {
  reference: string;
  billerCode: string;
  itemCode: string;
  identifier: string;
  amountNgn: number;
}): Promise<VendResult> {
  const secret = process.env.FLW_SECRET_KEY!;
  try {
    const res = await fetch(
      `https://api.flutterwave.com/v3/billers/${params.billerCode}/items/${params.itemCode}/payment`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${secret}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          country: "NG",
          customer_id: params.identifier,
          amount: params.amountNgn,
          reference: params.reference,
        }),
      }
    );
    const json = await res.json().catch(() => ({}));

    if (res.ok && json?.status === "success") {
      const token =
        json?.data?.token ?? json?.data?.extra ?? json?.data?.flw_ref ?? null;
      return { ok: true, token, flwRef: json?.data?.reference ?? params.reference };
    }

    // Explicit failure from FLW -> safe to refund.
    if (json?.status === "error") {
      return { ok: false, error: json?.message ?? "Vend rejected by provider." };
    }

    // Timeout / unknown -> ambiguous. Do NOT refund automatically.
    return { ok: null, error: json?.message ?? `Ambiguous response (HTTP ${res.status}).` };
  } catch (e: any) {
    return { ok: null, error: e?.message ?? "Network error during vend." };
  }
}

// ------------------------------------------------------------------
// Partner webhook outbox
// ------------------------------------------------------------------

export async function queueWebhookEvent(
  partnerId: string,
  orderId: string | null,
  eventType: "vend.success" | "vend.failed" | "vend.refunded" | "wallet.low_balance",
  payload: Record<string, unknown>
): Promise<void> {
  const db = supabaseAdmin();
  await db.from("partner_webhook_events").insert({
    partner_id: partnerId,
    order_id: orderId,
    event_type: eventType,
    payload,
  });
}

export function signWebhookPayload(secret: string, rawBody: string): string {
  return createHmac("sha256", secret).update(rawBody).digest("hex");
}

// ------------------------------------------------------------------
// Route helpers
// ------------------------------------------------------------------

export function jsonError(e: unknown): Response {
  if (e instanceof ApiError) {
    return Response.json(
      { error: { code: e.code, message: e.message } },
      { status: e.status }
    );
  }
  console.error("partner-api unhandled:", e);
  return Response.json(
    { error: { code: "internal_error", message: "Something went wrong." } },
    { status: 500 }
  );
}

export function publicOrder(o: any) {
  return {
    id: o.id,
    partner_ref: o.partner_ref,
    status: o.status,
    biller_name: o.biller_name,
    identifier: o.identifier,
    amount_ngn: Number(o.amount_ngn),
    amount_gbp_pence: o.amount_gbp_pence,
    fx_ngn_per_gbp: Number(o.fx_ngn_per_gbp),
    token: o.flw_token ?? null,
    error: o.error ?? null,
    created_at: o.created_at,
  };
}
