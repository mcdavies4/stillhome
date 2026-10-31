// src/lib/bills.ts
// One door for "the bills provider" (catalogue, lookup, vend, status, wallet).
// BILLS_PROVIDER=vtpass or =paybeta switches Nolgic to that provider; anything else
// (or unset) keeps Flutterwave, so deploying this file changes nothing until you flip it.
//
// Order references identify their provider by shape, so status checks, the
// admin re-check and the daily reconcile keep working for old orders after a
// switch:  "NOLGIC-<uuid>" = Flutterwave,  "<12 digits><uuid>" = VTpass,
//          "PB<32 hex>" = Paybeta.

import * as flw from "@/lib/flutterwave";
import * as vtp from "@/lib/vtpass";
import * as pb from "@/lib/paybeta";

export { FlwError } from "@/lib/flutterwave";
export type { BillerItem, ValidateResult, BillPaymentResult } from "@/lib/flutterwave";

export type BillsProviderName = "flutterwave" | "vtpass" | "paybeta";

export function activeProvider(): BillsProviderName {
  const v = (process.env.BILLS_PROVIDER ?? "").trim().toLowerCase();
  return v === "vtpass" ? "vtpass" : v === "paybeta" ? "paybeta" : "flutterwave";
}

export const providerLabel = (p: BillsProviderName = activeProvider()) =>
  p === "vtpass" ? "VTpass" : p === "paybeta" ? "Paybeta" : "Flutterwave";

export function providerForReference(ref: string): BillsProviderName {
  if (pb.isPbReference(ref)) return "paybeta";
  return vtp.isVtRequestId(ref) ? "vtpass" : "flutterwave";
}

/** True when vends are not real (Flutterwave TEST key, or a provider sandbox). */
export function billsTestMode(): boolean {
  const p = activeProvider();
  if (p === "vtpass") return vtp.vtpassIsSandbox();
  if (p === "paybeta") return pb.paybetaIsSandbox();
  return (process.env.FLW_SECRET_KEY ?? "").startsWith("FLWSECK_TEST");
}

export function billsConfigured(): boolean {
  const p = activeProvider();
  if (p === "vtpass") return vtp.vtpassConfigured();
  if (p === "paybeta") return pb.paybetaConfigured();
  return !!(process.env.FLW_SECRET_KEY ?? "").trim();
}

/**
 * Reference for this order's vend. An existing reference is reused (so a replayed
 * webhook can never create a second vend) as long as it belongs to the active provider.
 */
export function makeReference(orderId: string, existing?: unknown): string {
  const want = activeProvider();
  if (typeof existing === "string" && existing && providerForReference(existing) === want) return existing;
  if (want === "paybeta") return pb.pbReference(orderId);
  return want === "vtpass" ? vtp.vtRequestId(orderId) : `NOLGIC-${orderId}`;
}

// ───────────────────────── catalogue + lookup ─────────────────────────

export async function getBillCategories(country: string = "NG"): Promise<flw.BillerItem[]> {
  const p = activeProvider();
  if (p === "vtpass") return country.toUpperCase() === "NG" ? vtp.vtGetBillCategories() : [];
  if (p === "paybeta") return country.toUpperCase() === "NG" ? pb.pbGetBillCategories() : [];
  return flw.getBillCategories(country);
}

export async function validateCustomer(
  itemCode: string,
  billerCode: string,
  identifier: string
): Promise<flw.ValidateResult> {
  const p = activeProvider();
  if (p === "vtpass") return vtp.vtValidate(itemCode, billerCode, identifier);
  if (p === "paybeta") return pb.pbValidate(itemCode, billerCode, identifier);
  return flw.validateCustomer(itemCode, billerCode, identifier);
}

// ───────────────────────── purchase rules ─────────────────────────

export type PurchaseCheck = { ok: true } | { ok: false; error: string };

/**
 * Re-checks, on the server and BEFORE any payment is taken, that this product exists, that fixed-price
 * plans are bought at their catalogue price, and that variable amounts respect the provider's min/max.
 * (VTpass ignores the amount on data/TV plans and charges the plan price, so the browser must never be trusted.)
 * Flutterwave keeps its existing behaviour (it validates amounts itself).
 */
export async function checkPurchase(billerCode: string, itemCode: string, amountLocal: number): Promise<PurchaseCheck> {
  const prov = activeProvider();
  if (prov === "flutterwave") return { ok: true };
  const { item, min, max } = prov === "paybeta"
    ? await pb.pbLookupItem(billerCode, itemCode)
    : await vtp.vtLookupItem(billerCode, itemCode);
  if (!item) return { ok: false, error: "That plan isn't available right now — please pick it again." };
  const amount = Math.round(Number(amountLocal));
  if (item.amount > 0) {
    if (amount !== Math.round(item.amount)) {
      return { ok: false, error: "That plan's price has changed — please reload the page and try again." };
    }
    return { ok: true };
  }
  const fmt = (n: number) => `₦${n.toLocaleString("en-NG")}`;
  if (min && amount < min) return { ok: false, error: `The minimum for this provider is ${fmt(min)}.` };
  if (max && amount > max) return { ok: false, error: `The maximum for this provider is ${fmt(max)}.` };
  return { ok: true };
}

// ───────────────────────── vend ─────────────────────────

export async function createBillPayment(params: {
  country?: string;
  identifier: string;
  amountLocal: number;
  billerName: string;
  itemCode: string;
  billerCode: string;
  reference: string;
  /** Recipient mobile — VTpass requires one on every vend; Flutterwave ignores it. */
  phone?: string | null;
}): Promise<flw.BillPaymentResult> {
  const p = activeProvider();
  if (p === "vtpass") return vtp.vtPay(params);
  if (p === "paybeta") return pb.pbPay(params);
  return flw.createBillPayment(params);
}

// ───────────────────────── status ─────────────────────────

export type BillState = "success" | "failed" | "pending" | "not_found";
export interface BillStatus {
  provider: BillsProviderName;
  found: boolean;
  state: BillState;
  token: string | null;
  detail: string;
}

/**
 * Provider-neutral status of a vend, looked up on whichever provider made the reference.
 * Throws only when the provider can't be reached/understood (callers treat that as "unknown").
 */
export async function checkBillStatus(reference: string): Promise<BillStatus> {
  const provider = providerForReference(reference);
  if (provider === "paybeta") {
    // No requery endpoint at Paybeta: this reads the webhook events we recorded (never "not_found").
    const s = await pb.pbStatus(reference);
    return { provider, found: s.found, state: s.state, token: s.token, detail: s.detail };
  }
  if (provider === "vtpass") {
    const s = await vtp.vtStatus(reference);
    return { provider, found: s.found, state: s.state, token: s.token, detail: s.detail };
  }
  try {
    const r = await flw.getBillStatus(reference);
    const d = (r.data ?? {}) as Record<string, unknown>;
    const st = String(d.status ?? "").toLowerCase();
    const state: BillState =
      st.includes("success") || st.includes("completed") ? "success" : st.includes("fail") ? "failed" : "pending";
    const token = (d.extra as string | undefined) ?? (d.token as string | undefined) ?? null;
    return { provider, found: true, state, token: state === "success" ? token : null, detail: st || "unknown" };
  } catch (e) {
    const msg = e instanceof flw.FlwError ? e.message.toLowerCase() : "";
    if (msg.includes("not found") || msg.includes("no transaction") || msg.includes("404")) {
      return { provider, found: false, state: "not_found", token: null, detail: "not found" };
    }
    throw e;
  }
}

// ───────────────────────── wallet ─────────────────────────

export async function getBalance(currency: string = "NGN"): Promise<number> {
  const p = activeProvider();
  if (p === "vtpass" || p === "paybeta") {
    if (currency.toUpperCase() !== "NGN") throw new flw.FlwError(`${providerLabel(p)} wallet is NGN only`);
    return p === "vtpass" ? vtp.vtBalance() : pb.pbBalance();
  }
  return flw.getBalance(currency);
}
