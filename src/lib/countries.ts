// src/lib/countries.ts
// Single source of truth for multi-country support. Adding a country later is
// a matter of adding one entry here (plus funding its Flutterwave float and
// setting its FX env var) — nothing else in the app hardcodes NG.

export type CountryCode = "NG" | "GH";

export interface CountryConfig {
  code: CountryCode;
  name: string;
  flag: string;
  currency: string;          // ISO — the vend currency
  currencySymbol: string;
  // Env var name holding "<local currency> per GBP" (set BELOW mid-market; gap = margin)
  fxEnvVar: string;
  fxDefault: number;         // fallback if env missing (keep realistic-ish)
  minLocal: number;          // min order in local currency
  maxLocal: number;          // max order in local currency
  // FLW returns some countries' fixed item amounts in minor units
  // (GH: pesewas — 115000 = ₵1,150). Divide catalogue `amount` by this
  // before display/quoting. NG amounts arrive in naira already (divisor 1).
  fixedAmountDivisor: number;
  // FLW biller_code prefixes / notes are handled in billers.ts CODE_MAP.
  identifierExamples: { electricity: string; tv: string; phone: string };
}

export const COUNTRIES: Record<CountryCode, CountryConfig> = {
  NG: {
    code: "NG",
    name: "Nigeria",
    flag: "🇳🇬",
    currency: "NGN",
    currencySymbol: "₦",
    fxEnvVar: "NGN_PER_GBP",
    fxDefault: 2050,
    minLocal: 1000,
    maxLocal: 500000,
    fixedAmountDivisor: 1,
    identifierExamples: { electricity: "04123456789", tv: "1034567890", phone: "08031234567" },
  },
  GH: {
    code: "GH",
    name: "Ghana",
    flag: "🇬🇭",
    currency: "GHS",
    currencySymbol: "₵",
    fxEnvVar: "GHS_PER_GBP",
    fxDefault: 19,             // ~mid is ~19-20 GHS/£; set env BELOW mid for margin
    minLocal: 5,
    maxLocal: 5000,
    fixedAmountDivisor: 100,   // pesewas → cedis. VERIFY with one real DStv GH price before launch.
    identifierExamples: { electricity: "P000123456", tv: "1034567890", phone: "0241234567" },
  },
};

export const DEFAULT_COUNTRY: CountryCode = "NG";

export function getCountry(code: string | null | undefined): CountryConfig {
  const c = (code ?? DEFAULT_COUNTRY).toUpperCase();
  return COUNTRIES[(c as CountryCode)] ?? COUNTRIES[DEFAULT_COUNTRY];
}

export function isSupportedCountry(code: string): code is CountryCode {
  return code in COUNTRIES;
}

export function allCountries(): CountryConfig[] {
  return Object.values(COUNTRIES);
}
