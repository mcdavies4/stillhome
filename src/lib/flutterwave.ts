// Flutterwave Bills API client (v3)
// Docs: https://developer.flutterwave.com/docs/bill-payment
// All calls are server-side only. FLW_SECRET_KEY must never reach the client.

const FLW_BASE = "https://api.flutterwave.com/v3";

function headers() {
  return {
    Authorization: `Bearer ${process.env.FLW_SECRET_KEY}`,
    "Content-Type": "application/json",
  };
}

async function flw<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${FLW_BASE}${path}`, {
    ...init,
    headers: { ...headers(), ...(init?.headers ?? {}) },
    // Bills catalogue changes rarely; individual calls set their own cache
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body?.status === "error") {
    throw new FlwError(body?.message ?? `Flutterwave HTTP ${res.status}`, body);
  }
  return body as T;
}

export class FlwError extends Error {
  raw: unknown;
  constructor(message: string, raw?: unknown) {
    super(message);
    this.name = "FlwError";
    this.raw = raw;
  }
}

export type BillerItem = {
  id: number;
  biller_code: string;
  item_code: string;
  name: string;         // "DSTV Compact"
  biller_name: string;  // "DSTV"
  short_name: string;
  amount: number;       // 0 = variable amount (e.g. electricity)
  fee: number;
  country: string;
  is_airtime: boolean;
  label_name: string;   // "Smart Card Number" / "Meter Number"
};

// Categories we expose in the MVP
export const CATEGORIES = [
  { key: "AIRTIME", label: "Airtime" },
  { key: "MOBILEDATA", label: "Data" },
  { key: "CABLEBILLS", label: "Cable TV" },
  { key: "UTILITYBILLS", label: "Electricity" },
] as const;

/** Fetch the biller catalogue for Nigeria. Cache upstream (route handler). */
export async function getBillCategories(): Promise<BillerItem[]> {
  const body = await flw<{ data: BillerItem[] }>(`/bill-categories?country=NG`);
  return (body.data ?? []).filter((b) => b.country === "NG");
}

export type ValidateResult = {
  response_code: string;
  response_message: string;
  name: string | null;      // account holder name — show before charging
  customer: string;
  biller_code: string;
  product_code: string;
  minimum: number;
  maximum: number;
  fee: number;
};

/** Validate a meter / smartcard / phone against the biller BEFORE any charge. */
export async function validateCustomer(
  itemCode: string,
  billerCode: string,
  identifier: string
): Promise<ValidateResult> {
  const body = await flw<{ data: ValidateResult }>(
    `/bill-items/${encodeURIComponent(itemCode)}/validate?code=${encodeURIComponent(
      billerCode
    )}&customer=${encodeURIComponent(identifier)}`
  );
  if (body.data?.response_code !== "00") {
    throw new FlwError(body.data?.response_message ?? "Validation failed", body);
  }
  return body.data;
}

export type BillPaymentResult = {
  phone_number?: string;
  amount: number;
  network?: string;
  flw_ref: string;
  tx_ref: string;
  reference: string | null;
  extra?: string | null; // electricity token often lands here or in requery
};

/**
 * Execute the bill payment from the prefunded NGN wallet.
 * `reference` is OUR idempotency key (orders.flw_reference) — retries with the
 * same reference must not double-vend.
 */
export async function createBillPayment(params: {
  country?: string;
  identifier: string;
  amountNgn: number;
  billerName: string; // e.g. "DSTV", "AIRTIME"
  itemCode: string;
  billerCode: string;
  reference: string;
}): Promise<BillPaymentResult> {
  const body = await flw<{ data: BillPaymentResult }>(`/bills`, {
    method: "POST",
    body: JSON.stringify({
      country: params.country ?? "NG",
      customer: params.identifier,
      amount: params.amountNgn,
      type: params.billerName,
      reference: params.reference,
      biller_name: params.billerName,
    }),
  });
  return body.data;
}

/** Re-query a bill payment status by our reference (webhook fallback / token pickup). */
export async function getBillStatus(reference: string) {
  return flw<{ data: Record<string, unknown> }>(
    `/bills/${encodeURIComponent(reference)}`
  );
}

/** NGN wallet balance — checked before vending so an empty float fails fast. */
export async function getNgnBalance(): Promise<number> {
  const body = await flw<{ data: { available_balance: number } }>(`/balances/NGN`);
  return Number(body.data?.available_balance ?? 0);
}
