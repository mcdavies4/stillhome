// Flutterwave Bills API client (v3, current endpoints)
const FLW_BASE = "https://api.flutterwave.com/v3";

export class FlwError extends Error {
  raw: unknown;
  constructor(message: string, raw?: unknown) {
    super(message);
    this.name = "FlwError";
    this.raw = raw;
  }
}

async function flw<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${FLW_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${(process.env.FLW_SECRET_KEY ?? "").trim()}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const text = await res.text();
  let body: any = {};
  try { body = JSON.parse(text); } catch { /* keep raw text */ }
  if (!res.ok || body?.status === "error") {
    console.error(`[flw] ${path} -> ${res.status}: ${text.slice(0, 500)}`);
    throw new FlwError(
      body?.message ?? `Flutterwave HTTP ${res.status}: ${text.slice(0, 200)}`,
      text
    );
  }
  return body as T;
}

export type BillerItem = {
  id: number;
  biller_code: string;
  item_code: string;
  name: string;
  biller_name: string;
  short_name: string;
  amount: number;
  fee: number;
  country: string;
  is_airtime: boolean;
  label_name: string;
};

export async function getBillCategories(): Promise<BillerItem[]> {
  const body = await flw<{ data: BillerItem[] }>(`/bill-categories?country=NG`);
  return (body.data ?? []).filter((b) => b.country === "NG");
}

export type ValidateResult = {
  response_code: string;
  response_message: string;
  name: string | null;
  customer: string;
  minimum: number;
  maximum: number;
  fee: number;
};

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
  if (body.data?.response_code && body.data.response_code !== "00") {
    throw new FlwError(body.data?.response_message ?? "Validation failed", body);
  }
  return body.data;
}

export type BillPaymentResult = {
  amount: number;
  flw_ref: string;
  tx_ref: string;
  reference: string | null;
  extra?: string | null;
};

// Current documented endpoint: POST /billers/{biller_code}/items/{item_code}/payment
export async function createBillPayment(params: {
  country?: string;
  identifier: string;
  amountNgn: number;
  billerName: string; // kept for signature compatibility; not sent
  itemCode: string;
  billerCode: string;
  reference: string;
}): Promise<BillPaymentResult> {
  const body = await flw<{ data: BillPaymentResult }>(
    `/billers/${encodeURIComponent(params.billerCode)}/items/${encodeURIComponent(
      params.itemCode
    )}/payment`,
    {
      method: "POST",
      body: JSON.stringify({
        country: params.country ?? "NG",
        customer_id: params.identifier,
        amount: params.amountNgn,
        reference: params.reference,
      }),
    }
  );
  return body.data;
}

export async function getBillStatus(reference: string) {
  return flw<{ data: Record<string, unknown> }>(
    `/bills/${encodeURIComponent(reference)}`
  );
}

export async function getNgnBalance(): Promise<number> {
  const body = await flw<{ data: { available_balance: number } }>(`/balances/NGN`);
  return Number(body.data?.available_balance ?? 0);
}
