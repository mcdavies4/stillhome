// src/lib/wa/extract.ts
// Claude-powered extraction of bill-purchase intent (electricity, TV, data).

import { catalogueForPrompt } from "./billers";
import type { Beneficiary, Draft } from "./db";

export interface Extraction {
  intent: "buy_bill" | "check_status" | "list_beneficiaries" | "repeat_last" | "cancel" | "help" | "other";
  updates: {
    biller_key?: string;       // electricity only
    brand?: string;            // tv/data only
    package_query?: string;    // tv/data only
    identifier?: string;
    amount_ngn?: number;       // electricity only
    beneficiary_alias?: string;
  };
  resolved_beneficiary_id: string | null;
  missing: string[];
  reply_if_other: string | null;
}

const SYSTEM_PROMPT = (catalogue: string, beneficiaries: Beneficiary[], draft: Draft) => `You extract structured bill-purchase orders from WhatsApp messages sent to Nolgic, a UK→Nigeria bill payment service. Users are typically UK-based Nigerians paying for themselves or relatives in Nigeria: electricity, TV subscriptions (DStv/GOtv/StarTimes), and mobile data. Messages are informal: "10k light for mum", "renew dstv compact 1034567890", "2gb mtn for 08031234567", "same as last time".

CATALOGUE:
${catalogue}

SAVED BENEFICIARIES for this user (resolve phrases like "mum", "the shop"):
${
  beneficiaries.length
    ? beneficiaries.map((b) => `- id: ${b.id} | alias: "${b.alias}" | number: ${b.identifier} | product: ${b.biller_name ?? b.biller_code}`).join("\n")
    : "(none saved yet)"
}

CURRENT DRAFT (already collected — do not re-ask for these):
${JSON.stringify(draft)}

Respond with ONLY a JSON object, no prose, no markdown fences:
{
  "intent": "buy_bill" | "check_status" | "list_beneficiaries" | "repeat_last" | "cancel" | "help" | "other",
  "updates": {
    "biller_key": string?,       // ELECTRICITY ONLY: exact key from the catalogue
    "brand": string?,            // TV/DATA ONLY: brand name exactly as listed
    "package_query": string?,    // TV/DATA ONLY: the package/bundle the user asked for, e.g. "compact", "2gb", "jolli", "premium". Empty string if they named the brand but no package.
    "identifier": string?,       // meter/smartcard/phone number, digits only as given (keep leading zeros)
    "amount_ngn": number?,       // ELECTRICITY ONLY: integer naira
    "beneficiary_alias": string? // if the user names someone new, lowercase
  },
  "resolved_beneficiary_id": string | null,
  "missing": string[],  // what's still needed for a complete order, considering BOTH the draft and your updates. Electricity needs: biller_key, identifier, amount_ngn. TV/data needs: brand, package_query, identifier. If resolved_beneficiary_id is set, the product and identifier come from it.
  "reply_if_other": string | null
}

STRICT RULES:
- NEVER invent meter numbers, smartcard numbers, phone numbers, or amounts. If not explicitly present, leave them out and list in "missing".
- identifier is a STRING — preserve leading zeros exactly (e.g. "08031234567", "047001297002").
- Amount parsing (electricity): "10k" = 10000, "N5000" = 5000, "10,000" = 10000. A bare number under 100 with no context is AMBIGUOUS — omit and mark missing.
- "light", "nepa", "electricity", "units" → electricity. "dstv", "gotv", "startimes", "cable", "decoder" → TV. "data", "GB", "MB" with a network name → data.
- For data, an 11-digit number starting 0 in the message is the recipient phone number (identifier).
- "again", "repeat", "same as last time" → intent "repeat_last".
- "cancel", "stop", "forget it" → intent "cancel".
- Greetings/thanks → "other" with a brief warm reply_if_other (under 2 sentences). "How does this work" → "help".`;

export async function extractOrder(
  message: string,
  beneficiaries: Beneficiary[],
  draft: Draft
): Promise<Extraction> {
  const catalogue = await catalogueForPrompt();
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY!,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5",
      max_tokens: 500,
      system: SYSTEM_PROMPT(catalogue, beneficiaries, draft),
      messages: [{ role: "user", content: message }],
    }),
  });

  if (!res.ok) {
    console.error("[extract] anthropic error", res.status, await res.text());
    return fallbackExtraction();
  }

  const data = await res.json();
  const text: string = (data.content ?? [])
    .filter((c: { type: string }) => c.type === "text")
    .map((c: { text: string }) => c.text)
    .join("");

  try {
    const parsed = JSON.parse(text.replace(/```json|```/g, "").trim()) as Extraction;

    // Server-side hardening — never trust model output blindly:
    if (parsed.updates?.identifier) {
      const digits = String(parsed.updates.identifier).replace(/\D/g, "");
      if (digits.length < 8 || digits.length > 15) {
        delete parsed.updates.identifier;
        if (!parsed.missing.includes("identifier")) parsed.missing.push("identifier");
      } else {
        parsed.updates.identifier = digits;
      }
    }
    if (parsed.updates?.amount_ngn != null) {
      const n = Math.round(Number(parsed.updates.amount_ngn));
      if (!Number.isFinite(n) || n <= 0 || n > 1_000_000) {
        delete parsed.updates.amount_ngn;
        if (!parsed.missing.includes("amount_ngn")) parsed.missing.push("amount_ngn");
      } else {
        parsed.updates.amount_ngn = n;
      }
    }
    if (parsed.updates?.brand) parsed.updates.brand = String(parsed.updates.brand).trim();
    if (parsed.updates?.package_query != null) parsed.updates.package_query = String(parsed.updates.package_query).trim();
    return parsed;
  } catch (err) {
    console.error("[extract] parse failed", err, text);
    return fallbackExtraction();
  }
}

function fallbackExtraction(): Extraction {
  return {
    intent: "other",
    updates: {},
    resolved_beneficiary_id: null,
    missing: [],
    reply_if_other:
      "Sorry, I didn't catch that. Try: *IKEDC 10k meter 04123456789*, *DStv Compact 1034567890*, or *MTN 2GB 08031234567* — or say *help*.",
  };
}
