// src/lib/fx.ts
// Country-aware pricing. You set "<local currency> per GBP" BELOW mid-market;
// the spread + flat service fee is your margin.
//
// BACKWARD COMPATIBLE: quoteGbp(amountNgn) still works exactly as before
// (defaults to Nigeria), so no existing NG caller needs changing. New callers
// pass a country code: quoteGbp(amountLocal, "GH").

import { getCountry, type CountryCode } from "./countries";

export type Quote = {
  amountLocal: number;
  currency: string;         // "NGN" | "GHS"
  country: CountryCode;
  fxLocalPerGbp: number;
  serviceFeePence: number;
  subtotalPence: number;
  totalPence: number;
  // legacy aliases so existing code reading .amountNgn / .ngnPerGbp keeps working
  amountNgn: number;
  ngnPerGbp: number;
};

export function quoteGbp(amountLocal: number, countryCode: string = "NG"): Quote {
  const country = getCountry(countryCode);
  const fx = Number(process.env[country.fxEnvVar] ?? country.fxDefault);
  const serviceFeePence = Number(process.env.SERVICE_FEE_PENCE ?? "99");
  const min = country.minLocal;
  const max = country.maxLocal;

  if (!Number.isFinite(amountLocal) || amountLocal < min || amountLocal > max) {
    throw new Error(
      `Amount must be between ${country.currencySymbol}${min.toLocaleString()} and ${country.currencySymbol}${max.toLocaleString()}`
    );
  }

  const subtotalPence = Math.ceil((amountLocal / fx) * 100);
  const totalPence = subtotalPence + serviceFeePence;

  return {
    amountLocal,
    currency: country.currency,
    country: country.code,
    fxLocalPerGbp: fx,
    serviceFeePence,
    subtotalPence,
    totalPence,
    // legacy aliases
    amountNgn: amountLocal,
    ngnPerGbp: fx,
  };
}

export const gbp = (pence: number) => `£${(pence / 100).toFixed(2)}`;
export const ngn = (n: number) => `₦${Number(n).toLocaleString("en-NG")}`;
export function money(amount: number, countryCode: string = "NG"): string {
  const c = getCountry(countryCode);
  return `${c.currencySymbol}${Number(amount).toLocaleString()}`;
}
