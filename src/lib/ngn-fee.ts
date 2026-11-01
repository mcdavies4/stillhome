// Service fee for naira orders, set per kind of product.
//
// fee = pct% of the bill amount, never below MIN, never above MAX (whole naira).
// Paybeta pays us different commissions per product, so the fee is different too:
//
//   airtime and data  1%   min ₦20   max ₦100    (Paybeta commission 2.5% to 4%)
//   TV                1.5% min ₦50   max ₦300    (Paybeta commission 1.5%)
//   electricity       1.5% min ₦100  max ₦500    (Paybeta commission 0.5% to 1.2%)
//
// One set of settings is used by BOTH the server and the page, so the fee shown
// is always the fee charged. NEXT_PUBLIC_ variables are readable on both sides
// (they are baked in at build time — redeploy after changing them).
//
//   Electricity (and anything unrecognised — the safe default):
//     NEXT_PUBLIC_NG_FEE_PCT / NEXT_PUBLIC_NG_FEE_MIN / NEXT_PUBLIC_NG_FEE_MAX
//     (fallback for the minimum: the old NEXT_PUBLIC_NG_LOCAL_FEE_NGN)
//   Airtime and data:  NEXT_PUBLIC_NG_FEE_AIRTIME_PCT / _MIN / _MAX
//   TV:                NEXT_PUBLIC_NG_FEE_TV_PCT / _MIN / _MAX
//
//   Biggest single order in naira:  NEXT_PUBLIC_NG_MAX_ORDER   (default ₦30,000 — raise it when you are ready)
//
// NOTE: each variable is read by its full name on purpose. Next.js only bakes in
// NEXT_PUBLIC_ values it can see written out in full.

export type FeeKind = "airtime_data" | "tv" | "electricity";
export type FeeSettings = { pct: number; min: number; max: number };

function num(v: string | undefined, d: number): number {
  const n = Number(v);
  return v !== undefined && v !== "" && Number.isFinite(n) && n >= 0 ? n : d;
}

function shape(pct: number, min: number, maxRaw: number): FeeSettings {
  return { pct, min, max: Math.max(min, maxRaw) };
}

export function feeSettingsFor(kind: FeeKind): FeeSettings {
  if (kind === "airtime_data") {
    return shape(
      num(process.env.NEXT_PUBLIC_NG_FEE_AIRTIME_PCT, 1),
      num(process.env.NEXT_PUBLIC_NG_FEE_AIRTIME_MIN, 20),
      num(process.env.NEXT_PUBLIC_NG_FEE_AIRTIME_MAX, 100)
    );
  }
  if (kind === "tv") {
    return shape(
      num(process.env.NEXT_PUBLIC_NG_FEE_TV_PCT, 1.5),
      num(process.env.NEXT_PUBLIC_NG_FEE_TV_MIN, 50),
      num(process.env.NEXT_PUBLIC_NG_FEE_TV_MAX, 300)
    );
  }
  return shape(
    num(process.env.NEXT_PUBLIC_NG_FEE_PCT, 1.5),
    num(process.env.NEXT_PUBLIC_NG_FEE_MIN ?? process.env.NEXT_PUBLIC_NG_LOCAL_FEE_NGN, 100),
    num(process.env.NEXT_PUBLIC_NG_FEE_MAX, 500)
  );
}

/** The electricity settings (kept for anything that still asks for "the" fee). */
export function ngnFeeSettings(): FeeSettings {
  return feeSettingsFor("electricity");
}

export function ngnServiceFee(amountNgn: number, kind: FeeKind = "electricity"): number {
  const { pct, min, max } = feeSettingsFor(kind);
  const raw = Math.round((Number(amountNgn) * pct) / 100);
  return Math.min(max, Math.max(min, raw));
}

/** Lowest and highest fee across all kinds — for the "What does it cost?" line. */
export function ngnFeeRange(): { from: number; to: number } {
  const all = (["airtime_data", "tv", "electricity"] as FeeKind[]).map(feeSettingsFor);
  return { from: Math.min(...all.map((s) => s.min)), to: Math.max(...all.map((s) => s.max)) };
}

/** Biggest naira order allowed. Applies on top of the country limit. */
export function ngnMaxOrder(countryMax: number): number {
  const v = num(process.env.NEXT_PUBLIC_NG_MAX_ORDER, 30000);
  return v > 0 ? Math.min(countryMax, v) : countryMax;
}

type ItemLike = {
  biller_code?: string | null;
  item_code?: string | null;
  biller_name?: string | null;
  name?: string | null;
  short_name?: string | null;
  is_airtime?: boolean | null;
} | null | undefined;

/**
 * Which fee applies to this product. Works from the provider's own catalogue entry, so the server
 * never has to trust a name typed by the browser. Anything it cannot recognise is treated as
 * electricity, which has the highest fee, so a surprise product never gets the cheapest one.
 */
export function feeKindOf(i: ItemLike): FeeKind {
  if (!i) return "electricity";
  const code = String(i.item_code ?? "").toLowerCase();
  const biller = String(i.biller_code ?? "");
  const text = `${i.biller_name ?? ""} ${i.name ?? ""} ${i.short_name ?? ""}`;
  if (i.is_airtime || code === "airtime") return "airtime_data";
  if (code === "prepaid" || code === "postpaid" || /ELECTRIC|POWER|DISCO|PREPAID METER/i.test(text)) return "electricity";
  if (/[_-]data$/i.test(biller) || /VTU|AIRTIME|DATA|BROADBAND|SURFLINE|BUNDLE/i.test(text)) return "airtime_data";
  if (/DSTV|GOTV|STARTIMES|CABLE|\bTV\b/i.test(text)) return "tv";
  return "electricity";
}
