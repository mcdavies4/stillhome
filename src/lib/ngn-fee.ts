// Service fee for naira (Paystack) orders.
//
// fee = pct% of the bill amount, never below MIN, never above MAX (whole naira).
//
// One set of settings is used by BOTH the server and the page, so the fee shown
// is always the fee charged. NEXT_PUBLIC_ variables are readable on both sides
// (they are baked in at build time — redeploy after changing them).
//
//   NEXT_PUBLIC_NG_FEE_PCT   default 2     (percent of the amount)
//   NEXT_PUBLIC_NG_FEE_MIN   default 100   (₦ floor)
//   NEXT_PUBLIC_NG_FEE_MAX   default 500   (₦ cap)
//
// Fallback: if NEXT_PUBLIC_NG_FEE_MIN is unset, the old
// NEXT_PUBLIC_NG_LOCAL_FEE_NGN is used as the floor.

function num(v: string | undefined, d: number): number {
  const n = Number(v);
  return v !== undefined && v !== "" && Number.isFinite(n) && n >= 0 ? n : d;
}

export function ngnFeeSettings() {
  const pct = num(process.env.NEXT_PUBLIC_NG_FEE_PCT, 2);
  const min = num(process.env.NEXT_PUBLIC_NG_FEE_MIN ?? process.env.NEXT_PUBLIC_NG_LOCAL_FEE_NGN, 100);
  const maxRaw = num(process.env.NEXT_PUBLIC_NG_FEE_MAX, 500);
  const max = Math.max(min, maxRaw);
  return { pct, min, max };
}

export function ngnServiceFee(amountNgn: number): number {
  const { pct, min, max } = ngnFeeSettings();
  const raw = Math.round((Number(amountNgn) * pct) / 100);
  return Math.min(max, Math.max(min, raw));
}
