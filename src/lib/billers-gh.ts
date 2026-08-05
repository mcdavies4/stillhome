// src/lib/wa/billers-gh.ts
// Ghana biller code map — merge these entries into the CODE_MAP in billers.ts.
// Codes verified live from Flutterwave GH bill-categories (2026-08).
//
// Notes:
//  - ECG is Ghana's single national electricity biller (one entry, variable amount).
//  - DStv GH amounts arrive in PESEWAS (280000 = ₵2,800). Divide by 100 for cedis.
//  - Airtime (MTN/Tigo/Vodafone) is variable-amount, phone-number identifier.
//
// This file documents the mapping; the actual CODE_MAP lives in billers.ts.
// If you keep billers dynamic (built from getBillCategories), you only need the
// category+brand hints below — the codes are read live.

// Self-contained — no imports, so it builds anywhere in the repo.
type Category = "electricity" | "tv" | "data" | "airtime";

// biller_code → { category, brand, country }
export const GH_CODE_MAP: Record<string, { category: Category; brand: string; country: "GH" }> = {
  BIL142: { category: "electricity", brand: "ECG (Ghana)", country: "GH" },
  BIL137: { category: "tv", brand: "DStv Ghana", country: "GH" },
  BIL138: { category: "tv", brand: "GOtv Ghana", country: "GH" },
  BIL132: { category: "airtime", brand: "MTN Ghana", country: "GH" },
  BIL133: { category: "airtime", brand: "Tigo Ghana", country: "GH" },
  BIL134: { category: "airtime", brand: "Vodafone Ghana", country: "GH" },
  BIL141: { category: "data", brand: "Surfline", country: "GH" },
  BIL139: { category: "data", brand: "Vodafone Broadband", country: "GH" },
  BIL140: { category: "data", brand: "Vodafone Postpaid", country: "GH" },
};

// Ghana-specific alias hints for text matching in the catalogue builder.
export const GH_ALIAS_HINTS: [RegExp, string[]][] = [
  [/ELECTRICITY COMPANY OF GHANA|ECG/i, ["ecg", "light", "electricity", "ghana electricity"]],
  [/DSTV/i, ["dstv", "dstv ghana"]],
  [/GOTV/i, ["gotv", "gotv ghana"]],
  [/MTN/i, ["mtn", "mtn ghana"]],
  [/TIGO/i, ["tigo", "airteltigo"]],
  [/VODAFONE VTU/i, ["vodafone", "voda"]],
  [/SURFLINE/i, ["surfline"]],
];

// DStv GH fixed prices arrive in pesewas — normalise to cedis for display/quote.
export function pesewasToCedis(amount: number): number {
  return amount / 100;
}
