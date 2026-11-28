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
import * as sme from "@/lib/smeplug";
import * as asn from "@/lib/autosync";

export { FlwError } from "@/lib/flutterwave";
export type { BillerItem, ValidateResult, BillPaymentResult } from "@/lib/flutterwave";

export type BillsProviderName = "flutterwave" | "vtpass" | "paybeta" | "smeplug" | "autosync";

export function activeProvider(): BillsProviderName {
  const v = (process.env.BILLS_PROVIDER ?? "").trim().toLowerCase();
  return v === "vtpass" ? "vtpass" : v === "paybeta" ? "paybeta" : v === "smeplug" ? "smeplug" : v === "autosync" ? "autosync" : "flutterwave";
}

const PROVIDER_NAMES: BillsProviderName[] = ["flutterwave", "vtpass", "paybeta", "smeplug", "autosync"];
const TV_BILLER_CODES = new Set(["dstv", "gotv", "showmax", "startimes"]);

function routeEnv(name: string): BillsProviderName | null {
  const v = (process.env[name] ?? "").trim().toLowerCase();
  return PROVIDER_NAMES.find((x) => x === v) ?? null;
}

/**
 * Which provider sells this product. Optional per-category overrides:
 *   BILLS_PROVIDER_AIRTIME      airtime (SMEPlug)
 *   BILLS_PROVIDER_ELECTRICITY  the 12 DISCOs (AutoSyncNG)
 *   BILLS_PROVIDER_TV           DSTV, GOtv, Showmax, StarTimes (AutoSyncNG, once its TV catalogue is built)
 * Unset, or a product outside these groups, uses BILLS_PROVIDER as before.
 */
export function providerForBiller(billerCode: string, itemCode: string = ""): BillsProviderName {
  const code = String(billerCode ?? "").trim().toLowerCase();
  if (asn.AUTOSYNC_DISCO_IDS[code]) return routeEnv("BILLS_PROVIDER_ELECTRICITY") ?? activeProvider();
  if (TV_BILLER_CODES.has(code)) return routeEnv("BILLS_PROVIDER_TV") ?? activeProvider();
  if (itemCode === "airtime") return routeEnv("BILLS_PROVIDER_AIRTIME") ?? activeProvider();
  return activeProvider();
}

export const providerLabel = (p: BillsProviderName = activeProvider()) =>
  p === "vtpass" ? "VTpass" : p === "paybeta" ? "Paybeta" : p === "smeplug" ? "SMEPlug" : p === "autosync" ? "AutoSyncNG" : "Flutterwave";

export function providerForReference(ref: string): BillsProviderName {
  if (pb.isPbReference(ref)) return "paybeta";
  if (sme.isSmeReference(ref)) return "smeplug";
  if (asn.isAutosyncReference(ref)) return "autosync";
  return vtp.isVtRequestId(ref) ? "vtpass" : "flutterwave";
}

/** True when vends are not real (Flutterwave TEST key, or a provider sandbox). */
export function billsTestMode(): boolean {
  const p = activeProvider();
  if (p === "vtpass") return vtp.vtpassIsSandbox();
  if (p === "paybeta") return pb.paybetaIsSandbox();
  if (p === "smeplug") return false; // SMEPlug publishes no sandbox
  if (p === "autosync") return false; // AutoSyncNG publishes no sandbox
  return (process.env.FLW_SECRET_KEY ?? "").startsWith("FLWSECK_TEST");
}

export function billsConfigured(): boolean {
  const p = activeProvider();
  if (p === "vtpass") return vtp.vtpassConfigured();
  if (p === "paybeta") return pb.paybetaConfigured();
  if (p === "smeplug") return sme.smeplugConfigured();
  if (p === "autosync") return asn.autosyncConfigured();
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
  if (want === "smeplug") return sme.smeReference(orderId);
  if (want === "autosync") return asn.autosyncReference(orderId);
  return want === "vtpass" ? vtp.vtRequestId(orderId) : `NOLGIC-${orderId}`;
}

// ───────────────────────── catalogue + lookup ─────────────────────────

export async function getBillCategories(country: string = "NG"): Promise<flw.BillerItem[]> {
  const overrides = [routeEnv("BILLS_PROVIDER_AIRTIME"), routeEnv("BILLS_PROVIDER_ELECTRICITY"), routeEnv("BILLS_PROVIDER_TV")]
    .filter((x): x is BillsProviderName => x !== null);
  if (overrides.length > 0) {
    // Per-category routing: each provider's catalogue contributes only the products routed to it.
    const provs = Array.from(new Set<BillsProviderName>([activeProvider(), ...overrides]));
    const lists = await Promise.all(provs.map((x) => catalogueOf(x, country).catch(() => [] as flw.BillerItem[])));
    return provs.flatMap((x, i) => lists[i].filter((it) => providerForBiller(it.biller_code, it.item_code) === x));
  }
  const p = activeProvider();
  if (p === "vtpass") return country.toUpperCase() === "NG" ? vtp.vtGetBillCategories() : [];
  if (p === "paybeta") return country.toUpperCase() === "NG" ? pb.pbGetBillCategories() : [];
  if (p === "smeplug") return country.toUpperCase() === "NG" ? sme.smeCatalogue() : [];
  if (p === "autosync") return country.toUpperCase() === "NG" ? [...asn.autosyncCatalogue(), ...asn.autosyncTvCatalogue()] : [];
  return flw.getBillCategories(country);
}

export async function validateCustomer(
  itemCode: string,
  billerCode: string,
  identifier: string
): Promise<flw.ValidateResult> {
  const p = providerForBiller(billerCode, itemCode);
  if (p === "vtpass") return vtp.vtValidate(itemCode, billerCode, identifier);
  if (p === "paybeta") return pb.pbValidate(itemCode, billerCode, identifier);
  if (p === "smeplug") return sme.smeValidate(identifier);
  if (p === "autosync") return asn.autosyncValidateAny(identifier, billerCode, itemCode);
  return flw.validateCustomer(itemCode, billerCode, identifier);
}

// ───────────────────────── purchase rules ─────────────────────────

/** `item` is the provider's own catalogue entry for the product (not set for Flutterwave). */
export type PurchaseCheck = { ok: true; item?: { biller_code: string; item_code: string; biller_name: string; name: string; short_name?: string; is_airtime?: boolean } } | { ok: false; error: string };

/**
 * Re-checks, on the server and BEFORE any payment is taken, that this product exists, that fixed-price
 * plans are bought at their catalogue price, and that variable amounts respect the provider's min/max.
 * (VTpass ignores the amount on data/TV plans and charges the plan price, so the browser must never be trusted.)
 * Flutterwave keeps its existing behaviour (it validates amounts itself).
 */
export async function checkPurchase(billerCode: string, itemCode: string, amountLocal: number): Promise<PurchaseCheck> {
  const prov = providerForBiller(billerCode, itemCode);
  if (prov === "flutterwave") return { ok: true };
  if (prov === "smeplug" || prov === "autosync") {
    // Fixed catalogue for these providers (the VTpass/Paybeta lookup does not apply to them).
    const cat = prov === "smeplug" ? sme.smeCatalogue() : [...asn.autosyncCatalogue(), ...asn.autosyncTvCatalogue()];
    const it = cat.find((c) => c.biller_code === billerCode && c.item_code === itemCode);
    if (!it) return { ok: false, error: "That plan isn't available right now — please pick it again." };
    return { ok: true, item: { biller_code: it.biller_code, item_code: it.item_code, biller_name: it.biller_name, name: it.name, short_name: it.short_name, is_airtime: it.is_airtime } };
  }
  const { item, min, max } = prov === "paybeta"
    ? await pb.pbLookupItem(billerCode, itemCode)
    : await vtp.vtLookupItem(billerCode, itemCode);
  if (!item) return { ok: false, error: "That plan isn't available right now — please pick it again." };
  const amount = Math.round(Number(amountLocal));
  if (item.amount > 0) {
    if (amount !== Math.round(item.amount)) {
      return { ok: false, error: "That plan's price has changed — please reload the page and try again." };
    }
    return { ok: true, item };
  }
  const fmt = (n: number) => `₦${n.toLocaleString("en-NG")}`;
  if (min && amount < min) return { ok: false, error: `The minimum for this provider is ${fmt(min)}.` };
  if (max && amount > max) return { ok: false, error: `The maximum for this provider is ${fmt(max)}.` };
  return { ok: true, item };
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
  const p = providerForBiller(params.billerCode, params.itemCode);
  if (p === "vtpass") return vtp.vtPay(params);
  if (p === "paybeta") return pb.pbPay(params);
  if (p === "smeplug") return sme.smeVend(params);
  if (p === "autosync") return asn.autosyncVendAny(params);
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
  if (provider === "autosync") {
    // AutoSyncNG requery: only an explicit "failed" refunds; pending or unclear stays pending.
    const s = await asn.autosyncRequery(reference);
    const state: BillState = s.state === "successful" ? "success" : s.state === "failed" ? "failed" : "pending";
    return { provider, found: s.found, state, token: null, detail: s.detail };
  }
  if (provider === "smeplug") {
    // SMEPlug requery: only an explicit failure refunds; anything unclear stays pending.
    const s = await sme.smeStatus(reference);
    return { provider, found: s.found, state: s.state, token: null, detail: s.detail };
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

export async function balanceOf(p: BillsProviderName, currency: string = "NGN"): Promise<number> {
  if (p === "smeplug") return sme.smeBalance();
  if (p === "autosync") return asn.autosyncBalance();
  if (p === "vtpass" || p === "paybeta") {
    if (currency.toUpperCase() !== "NGN") throw new flw.FlwError(`${providerLabel(p)} wallet is NGN only`);
    return p === "vtpass" ? vtp.vtBalance() : pb.pbBalance();
  }
  return flw.getBalance(currency);
}

export async function getBalance(currency: string = "NGN"): Promise<number> {
  return balanceOf(activeProvider(), currency);
}

// ───────────────────────── failover ─────────────────────────
// An optional second provider, used ONLY when the first has definitely not delivered:
//   (a) its wallet can't fund the vend, so nothing was attempted, or
//   (b) it rejected the purchase request synchronously (notVended), so nothing was bought.
// Never used on a timeout or an unclear answer, because the first provider may still deliver and a
// second vend would then be a double delivery. Off unless BILLS_FAILOVER_PROVIDER names a different,
// configured provider.

const ALL_PROVIDERS: BillsProviderName[] = ["flutterwave", "vtpass", "paybeta", "smeplug", "autosync"];

export function providerConfigured(p: BillsProviderName): boolean {
  if (p === "vtpass") return vtp.vtpassConfigured();
  if (p === "paybeta") return pb.paybetaConfigured();
  if (p === "smeplug") return sme.smeplugConfigured();
  if (p === "autosync") return asn.autosyncConfigured();
  return !!(process.env.FLW_SECRET_KEY ?? "").trim();
}

export function failoverProvider(from: BillsProviderName = activeProvider()): BillsProviderName | null {
  const v = (process.env.BILLS_FAILOVER_PROVIDER ?? "").trim().toLowerCase();
  const p = ALL_PROVIDERS.find((x) => x === v) ?? null;
  if (!p || p === from) return null;
  return providerConfigured(p) ? p : null;
}

export function makeReferenceFor(p: BillsProviderName, orderId: string): string {
  if (p === "paybeta") return pb.pbReference(orderId);
  if (p === "smeplug") return sme.smeReference(orderId);
  if (p === "autosync") return asn.autosyncReference(orderId);
  return p === "vtpass" ? vtp.vtRequestId(orderId) : `NOLGIC-${orderId}`;
}

export async function catalogueOf(p: BillsProviderName, country: string = "NG"): Promise<flw.BillerItem[]> {
  if (p === "vtpass") return country.toUpperCase() === "NG" ? vtp.vtGetBillCategories() : [];
  if (p === "paybeta") return country.toUpperCase() === "NG" ? pb.pbGetBillCategories() : [];
  if (p === "smeplug") return country.toUpperCase() === "NG" ? sme.smeCatalogue() : [];
  if (p === "autosync") return country.toUpperCase() === "NG" ? [...asn.autosyncCatalogue(), ...asn.autosyncTvCatalogue()] : [];
  return flw.getBillCategories(country);
}

export async function validateVia(p: BillsProviderName, itemCode: string, billerCode: string, identifier: string): Promise<flw.ValidateResult> {
  if (p === "vtpass") return vtp.vtValidate(itemCode, billerCode, identifier);
  if (p === "paybeta") return pb.pbValidate(itemCode, billerCode, identifier);
  if (p === "smeplug") return sme.smeValidate(identifier);
  if (p === "autosync") return asn.autosyncValidateAny(identifier, billerCode, itemCode);
  return flw.validateCustomer(itemCode, billerCode, identifier);
}

/**
 * Finds the same product on another provider's catalogue. Codes differ between providers, so the match is
 * by biller name (letters and digits only), then by kind (airtime or not) and, for fixed-price plans, by price.
 * Returns null unless exactly one product matches: a guess here would sell the wrong plan.
 */
export function findEquivalentItem(
  src: { biller_name: string; item_code: string; amount: number },
  catalogue: flw.BillerItem[]
): flw.BillerItem | null {
  const norm = (s: string) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  // Airtime names carry provider-specific suffixes ("MTN Airtime" vs "MTN Airtime VTU"), so compare the network only.
  const wantAirtime = src.item_code === "airtime";
  const key = (s: string) => (wantAirtime ? norm(String(s ?? "").toLowerCase().replace(/\b(airtime|vtu|top ?up|recharge)\b/g, "")) : norm(s));
  const name = key(src.biller_name);
  if (!name) return null;
  const amount = Math.round(Number(src.amount));
  const hits = catalogue.filter((i) => {
    // Flutterwave lists every airtime network under biller_name "AIRTIME" and names the network in name/short_name.
    const names = wantAirtime ? [i.biller_name, i.name, i.short_name] : [i.biller_name];
    if (!names.some((n) => key(n) === name)) return false;
    const isAirtime = i.item_code === "airtime" || !!i.is_airtime;
    if (isAirtime !== wantAirtime) return false;
    if (wantAirtime) return true;
    return !i.amount || Math.round(i.amount) === amount; // fixed-price plans must match the price paid; variable (0) matches any
  });
  return hits.length === 1 ? hits[0] : null;
}

/** Vend on a named provider (used by failover; createBillPayment is this for the active provider). */
export async function vendVia(p: BillsProviderName, params: Parameters<typeof createBillPayment>[0]): Promise<flw.BillPaymentResult> {
  if (p === "vtpass") return vtp.vtPay(params);
  if (p === "paybeta") return pb.pbPay(params);
  if (p === "smeplug") return sme.smeVend(params);
  if (p === "autosync") return asn.autosyncVendAny(params);
  return flw.createBillPayment(params);
}

/** Highest NGN wallet across the active provider and the failover provider, for "can we deliver this order?" */
export async function bestNgnBalance(): Promise<number> {
  const alt = failoverProvider();
  const reads = [balanceOf(activeProvider()), alt ? balanceOf(alt) : Promise.reject(new Error("no failover"))];
  const values = await Promise.all(reads.map((r) => r.catch(() => -Infinity)));
  return Math.max(...values);
}

/** The provider's current price for a fixed-price item, or null if unknown or not fixed. Used to ask a payer to approve a new price. */
export async function currentItemPrice(billerCode: string, itemCode: string): Promise<number | null> {
  const prov = providerForBiller(billerCode, itemCode);
  if (prov === "flutterwave" || prov === "smeplug" || prov === "autosync") return null; // SMEPlug publishes no fixed prices
  const { item } = prov === "paybeta"
    ? await pb.pbLookupItem(billerCode, itemCode)
    : await vtp.vtLookupItem(billerCode, itemCode);
  return item && item.amount > 0 ? Math.round(item.amount) : null;
}
