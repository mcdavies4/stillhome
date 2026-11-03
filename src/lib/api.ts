import Constants from "expo-constants";

// The app talks to the same backend as nolgic.com. Override in app.json -> expo.extra.apiBase.
export const API_BASE: string =
  ((Constants.expoConfig?.extra as any)?.apiBase as string | undefined) ?? "https://www.nolgic.com";

export type BillerItem = {
  biller_code: string; item_code: string; name: string; biller_name: string; short_name: string;
  amount: number; is_airtime: boolean; label_name: string;
};
export type FeeSettings = { pct: number; min: number; max: number };
export type Config = {
  ngnEnabled: boolean;
  fee: FeeSettings; // electricity (also the safe default for anything unrecognised)
  fees?: { airtime_data: FeeSettings; tv: FeeSettings; electricity: FeeSettings };
  minNgn: number;
  maxNgn: number;
};
export type Order = {
  id: string; status: string; biller_name: string; identifier: string; identifier_label: string;
  customer_name: string | null; amount_ngn: number; amount_gbp_pence: number; flw_token: string | null;
  currency?: string | null; payment_provider?: string | null; service_fee_local?: number | null;
};

export const DEFAULT_CONFIG: Config = { ngnEnabled: true, fee: { pct: 1.5, min: 100, max: 500 }, minNgn: 100, maxNgn: 500000 };

export class ApiError extends Error {}

async function call<T>(path: string, init?: RequestInit, timeoutMs = 25000): Promise<T> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, { ...init, signal: ctl.signal, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  } catch {
    throw new ApiError("Can’t reach Nolgic. Check your connection and try again.");
  } finally {
    clearTimeout(t);
  }
  let body: any = null;
  try { body = await res.json(); } catch { /* non-JSON */ }
  if (!res.ok || (body && body.error)) {
    throw new ApiError(body?.error ?? `Something went wrong (${res.status}). Please try again.`);
  }
  return body as T;
}

export const getConfig = () => call<Config>("/api/config", undefined, 10000);
export type RecentNotice = { text: string; when: string };
// Real, delivered orders only (anonymous). Empty until the site has enough real orders.
export const getRecent = () =>
  call<{ items: RecentNotice[] }>("/api/recent", undefined, 8000).then((d) => d.items ?? []);
export const getBillers = () => call<{ items: BillerItem[] }>("/api/billers?country=NG").then((d) => d.items ?? []);
export const getOrder = (id: string) => call<Order>(`/api/orders?id=${encodeURIComponent(id)}`, undefined, 15000);

export async function validate(item: BillerItem, identifier: string): Promise<{ name: string | null }> {
  const d = await call<{ ok: boolean; name: string | null; error?: string }>("/api/validate", {
    method: "POST",
    body: JSON.stringify({ itemCode: item.item_code, billerCode: item.biller_code, identifier }),
  });
  if (!d.ok) throw new ApiError(d.error ?? "Couldn’t verify that number.");
  return { name: d.name };
}

export function checkout(p: {
  email: string; item: BillerItem; identifier: string; amount: number; recipientPhone: string | null;
}) {
  return call<{ url: string; orderId: string; total: string }>("/api/checkout", {
    method: "POST",
    body: JSON.stringify({
      country: "NG",
      payIn: "ngn",
      email: p.email,
      billerCode: p.item.biller_code,
      itemCode: p.item.item_code,
      billerName: p.item.biller_name,
      identifier: p.identifier,
      identifierLabel: p.item.label_name || "Account number",
      amountLocal: p.amount,
      recipientWhatsapp: p.recipientPhone || null,
    }),
  });
}

// ───────── bulk airtime ─────────
export type BulkConfig = {
  enabled: boolean; minEach: number; maxEach: number; maxRecipients: number; maxTotal: number; firstCap: number;
  fee: FeeSettings;
};
export const DEFAULT_BULK: BulkConfig = {
  enabled: false, minEach: 50, maxEach: 5000, maxRecipients: 100, maxTotal: 200000, firstCap: 20000,
  fee: { pct: 1, min: 20, max: 500 },
};
export const getBulkConfig = () => call<BulkConfig>("/api/bulk/config", undefined, 8000);

export type BulkRecipientView = { row: number; network: string; phone: string; amount: number; status: "queued" | "delivered" | "failed" };
export type BulkView = {
  id: string; status: string; count: number; amount_total: number; service_fee: number;
  delivered: number; failed: number; delivered_ngn: number; refunded_ngn: number; created_at: string;
  recipients: BulkRecipientView[];
};
export const getBulk = (id: string) => call<BulkView>(`/api/bulk?id=${encodeURIComponent(id)}`, undefined, 30000);
export const bulkCheckout = (email: string, recipients: { phone: string; amount: number; network: string }[]) =>
  call<{ url: string; bulkId: string; total: number }>("/api/bulk/checkout", { method: "POST", body: JSON.stringify({ email, recipients }) }, 40000);
