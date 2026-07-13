// src/lib/wa/extract.ts
// Claude-powered extraction of bill-purchase intent from a WhatsApp message.

import { billersForPrompt, type WaBiller } from "./billers";
import type { Beneficiary, Draft } from "./db";

export interface Extraction {
  intent: "buy_bill" | "check_status" | "list_beneficiaries" | "repeat_last" | "cancel" | "help" | "other";
  updates: {
    biller_key?: string;
    identifier?: string;
    amount_ngn?: number;
    beneficiary_alias?: string;
  };
  resolved_beneficiary_id: string | null;
  missing: string[];
  reply_if_other: string | null;
}

const SYSTEM_PROMPT = (billers: WaBiller[], beneficiaries: Beneficiary[], draft: Draft) => `You extract structured electricity-purchase orders from WhatsApp messages sent to Nolgic, a UK→Nigeria utility bill payment service. Users are typically UK-based Nigerians buying electricity for themselves or relatives in Nigeria. Messages are informal: "10k light for mum", "abeg buy 5k ikedc 04123456789", "same as last time but 20k".

SUPPORTED BILLERS (match by name or alias; return the key exactly as shown):
${billersForPrompt(billers)}

SAVED BENEFICIARIES for this user (resolve phrases like "mum", "for my mum", "the shop"):
${
  beneficiaries.length
    ? beneficiaries.map((b) => `- id: ${b.id} | alias: "${b.alias}" | meter: ${b.identifier} | biller: ${b.biller_name ?? b.biller_code}`).join("\n")
    : "(none saved yet)"
}

CURRENT DRAFT (already collected — do not re-ask for these):
${JSON.stringify(draft)}

Respond with ONLY a JSON object, no prose, no markdown fences:
{
  "intent": "buy_bill" | "check_status" | "list_beneficiaries" | "repeat_last" | "cancel" | "help" | "other",
  "updates": {
    "biller_key": string?,        // key from the supported list above
    "identifier": string?,        // meter number, digits only as the user gave it
    "amount_ngn": number?,        // integer naira
    "beneficiary_alias": string?  // if the user names someone new, lowercase
  },
  "resolved_beneficiary_id": string | null,
  "missing": string[],  // among: "biller_key","identifier","amount_ngn" — required for a complete order considering BOTH the draft and your updates. If resolved_beneficiary_id is set, biller and identifier come from it, so only amount may be missing.
  "reply_if_other": string | null  // short friendly reply ONLY when intent is "other"
}

STRICT RULES:
- NEVER invent, guess, or autocomplete meter numbers or amounts. If not explicitly present, leave them out and list them in "missing".
- Amount parsing: "10k" = 10000, "10,000" = 10000, "₦5000" = 5000. A bare number under 100 with no k/naira context is AMBIGUOUS — leave amount out and include "amount_ngn" in missing.
- "again", "repeat", "same as last time" → intent "repeat_last" (a new amount in the same message goes in updates).
- "cancel", "stop", "forget it" → intent "cancel".
- Greetings/thanks → intent "other" with a brief warm reply_if_other (under 2 sentences). Questions about how the service works → intent "help".
- If the user mentions a person not in the saved list ("for mum" with none saved), set beneficiary_alias and treat biller/identifier as missing unless given.`;

export async function extractOrder(
  message: string,
  billers: WaBiller[],
  beneficiaries: Beneficiary[],
  draft: Draft
): Promise<Extraction> {
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
      system: SYSTEM_PROMPT(billers, beneficiaries, draft),
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
    if (parsed.updates?.biller_key && !billers.some((b) => b.key === parsed.updates.biller_key)) {
      delete parsed.updates.biller_key;
      if (!parsed.missing.includes("biller_key")) parsed.missing.push("biller_key");
    }
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
      "Sorry, I didn't catch that. Try something like: *IKEDC ₦10,000 meter 04123456789* — or say *help*.",
  };
}
