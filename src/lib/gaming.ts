// src/lib/gaming.ts
// Betting / gaming operators through Paybeta's Gaming API.
//   POST /v2/gaming/validate  -> the account holder's name, so the customer can confirm before paying
//   POST /v2/gaming/purchase  -> funds the account (NOT wired up yet: Paybeta has not documented its response)
// Validation moves no money, so it is safe to retry.

import { pb, paybetaConfigured } from "@/lib/paybeta";
import { FlwError } from "@/lib/flutterwave";

export type GamingAccount = { customerName: string; customerId: string; service: string; minimumNaira: number };

const SERVICE_RE = /^[a-z0-9][a-z0-9-]{1,39}$/;   // operator slug, e.g. "bet9ja", "nairabet"
const CUSTOMER_RE = /^[A-Za-z0-9]{4,24}$/;        // betting user id: digits/letters only

export function cleanGamingInput(service: unknown, customerId: unknown): { service: string; customerId: string } | null {
  if (typeof service !== "string" || typeof customerId !== "string") return null;
  const s = service.trim().toLowerCase();
  const c = customerId.trim();
  if (!SERVICE_RE.test(s) || !CUSTOMER_RE.test(c)) return null;
  return { service: s, customerId: c };
}

export async function validateGamingAccount(service: string, customerId: string): Promise<GamingAccount> {
  if (!paybetaConfigured()) throw new FlwError("Betting payments are not set up yet");
  const input = cleanGamingInput(service, customerId);
  if (!input) throw new FlwError("Enter a valid betting ID");

  const r = await pb("/v2/gaming/validate", { method: "POST", body: { service: input.service, customerId: input.customerId }, timeoutMs: 20000 });
  const d = (r.data ?? {}) as Record<string, unknown>;
  const name = typeof d.customerName === "string" ? d.customerName.trim() : "";
  if (!r.ok || !name) {
    // Paybeta's own message is safe to show; anything else gets a plain line.
    throw new FlwError(r.message && r.http >= 400 && r.http < 500 ? r.message : "Could not find that betting account. Check the ID and operator.");
  }
  return {
    customerName: name,
    customerId: typeof d.customerId === "string" || typeof d.customerId === "number" ? String(d.customerId) : input.customerId,
    service: typeof d.service === "string" ? d.service : input.service,
    minimumNaira: Math.max(0, Math.round(Number(d.minimumAmount) || 0)),
  };
}
