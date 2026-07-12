// src/lib/wa/billers.ts
// Supported billers for the WhatsApp channel.
//
// ⚠️ INTEGRATION: Nolgic already has live Flutterwave biller_code / item_code
// values from GET /v3/bill-categories. Copy the real codes from your existing
// config into this table — the codes below are PLACEHOLDERS and differ per
// Flutterwave account/environment. Keep `aliases` rich: it's what makes
// "ikeja electric", "ie", "ikedc" all resolve.

export interface BillerDef {
  key: string;            // stable internal key
  label: string;          // shown to users
  biller_code: string;    // Flutterwave biller_code  ← REPLACE
  item_code: string;      // Flutterwave item_code    ← REPLACE
  meter_type: "prepaid" | "postpaid";
  aliases: string[];
  min_ngn: number;
}

export const BILLERS: BillerDef[] = [
  { key: "ikedc_prepaid", label: "IKEDC Prepaid (Ikeja Electric)", biller_code: "BIL_REPLACE", item_code: "ITEM_REPLACE", meter_type: "prepaid",  aliases: ["ikedc", "ikeja", "ikeja electric", "ie"], min_ngn: 1000 },
  { key: "ikedc_postpaid", label: "IKEDC Postpaid (Ikeja Electric)", biller_code: "BIL_REPLACE", item_code: "ITEM_REPLACE", meter_type: "postpaid", aliases: ["ikedc postpaid", "ikeja postpaid"], min_ngn: 1000 },
  { key: "ekedc_prepaid", label: "EKEDC Prepaid (Eko Electric)", biller_code: "BIL_REPLACE", item_code: "ITEM_REPLACE", meter_type: "prepaid",  aliases: ["ekedc", "eko", "eko electric"], min_ngn: 1000 },
  { key: "aedc_prepaid",  label: "AEDC Prepaid (Abuja)",         biller_code: "BIL_REPLACE", item_code: "ITEM_REPLACE", meter_type: "prepaid",  aliases: ["aedc", "abuja", "abuja electric"], min_ngn: 1000 },
  { key: "phed_prepaid",  label: "PHED Prepaid (Port Harcourt)", biller_code: "BIL_REPLACE", item_code: "ITEM_REPLACE", meter_type: "prepaid",  aliases: ["phed", "ph", "port harcourt"], min_ngn: 1000 },
  { key: "eedc_prepaid",  label: "EEDC Prepaid (Enugu)",         biller_code: "BIL_REPLACE", item_code: "ITEM_REPLACE", meter_type: "prepaid",  aliases: ["eedc", "enugu"], min_ngn: 1000 },
  { key: "ibedc_prepaid", label: "IBEDC Prepaid (Ibadan)",       biller_code: "BIL_REPLACE", item_code: "ITEM_REPLACE", meter_type: "prepaid",  aliases: ["ibedc", "ibadan"], min_ngn: 1000 },
  { key: "bedc_prepaid",  label: "BEDC Prepaid (Benin)",         biller_code: "BIL_REPLACE", item_code: "ITEM_REPLACE", meter_type: "prepaid",  aliases: ["bedc", "benin"], min_ngn: 1000 },
  { key: "kedco_prepaid", label: "KEDCO Prepaid (Kano)",         biller_code: "BIL_REPLACE", item_code: "ITEM_REPLACE", meter_type: "prepaid",  aliases: ["kedco", "kano"], min_ngn: 1000 },
  { key: "jed_prepaid",   label: "JED Prepaid (Jos)",            biller_code: "BIL_REPLACE", item_code: "ITEM_REPLACE", meter_type: "prepaid",  aliases: ["jed", "jos"], min_ngn: 1000 },
];

export function billerByCode(billerCode: string, itemCode: string): BillerDef | undefined {
  return BILLERS.find((b) => b.biller_code === billerCode && b.item_code === itemCode);
}

export function billerByKey(key: string): BillerDef | undefined {
  return BILLERS.find((b) => b.key === key);
}

/** Compact list injected into the Claude extraction prompt. */
export function billersForPrompt(): string {
  return BILLERS.map((b) => `- key: ${b.key} | label: ${b.label} | aliases: ${b.aliases.join(", ")}`).join("\n");
}

/** Human list for the `help` command. */
export function billersForHelp(): string {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const b of BILLERS) {
    const short = b.label.split(" ")[0];
    if (!seen.has(short)) { seen.add(short); names.push(short); }
  }
  return names.join(", ");
}
