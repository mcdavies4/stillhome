// src/lib/breaker.ts
// Provider circuit breaker. Looks at the last few minutes of orders, grouped by the provider that vended them
// (the reference shape says which). When most of a provider's recent vends failed, new orders skip it and go
// straight to the failover provider. Nothing is sent to the failing provider while it's open, so this can't
// double-vend. If no failover is configured, or the failover is also unhealthy, orders carry on as before.
//
// Fails OPEN: if the health check can't run, the breaker stays closed.

import { supabaseAdmin } from "@/lib/supabase";
import { providerForReference, providerLabel, type BillsProviderName } from "@/lib/bills";
import { alertFounder } from "@/lib/alerts";

const WINDOW_MIN = Number(process.env.BREAKER_WINDOW_MIN ?? "15");
const MIN_ATTEMPTS = Number(process.env.BREAKER_MIN_ATTEMPTS ?? "5");
const FAIL_RATE = Number(process.env.BREAKER_FAIL_RATE ?? "0.5");
const FAILED = ["needs_review", "failed_refunded", "refund_failed"];
const SEEN = ["fulfilled", ...FAILED];

export interface Health { attempts: number; failures: number; open: boolean; }

/** Pure rule, so it can be tested without a database. */
export function isOpen(attempts: number, failures: number): boolean {
  return attempts >= MIN_ATTEMPTS && failures / attempts >= FAIL_RATE;
}

export async function providerHealth(p: BillsProviderName): Promise<Health> {
  try {
    const since = new Date(Date.now() - WINDOW_MIN * 60_000).toISOString();
    const { data, error } = await supabaseAdmin()
      .from("orders")
      .select("status,flw_reference")
      .gte("created_at", since)
      .in("status", SEEN);
    if (error) return { attempts: 0, failures: 0, open: false };
    const mine = (data ?? []).filter((o: any) => o.flw_reference && providerForReference(o.flw_reference) === p);
    const attempts = mine.length;
    const failures = mine.filter((o: any) => FAILED.includes(o.status)).length;
    return { attempts, failures, open: isOpen(attempts, failures) };
  } catch {
    return { attempts: 0, failures: 0, open: false };
  }
}

// Tell the founder when a breaker opens, at most once every 30 minutes per instance.
let lastOpenAlert = 0;
export function noteBreakerOpen(p: BillsProviderName, h: Health, backup: BillsProviderName) {
  if (Date.now() - lastOpenAlert < 30 * 60_000) return;
  lastOpenAlert = Date.now();
  alertFounder(
    `${providerLabel(p)} is failing: orders moved to ${providerLabel(backup)}`,
    `${h.failures} of the last ${h.attempts} vends on ${providerLabel(p)} failed (window ${WINDOW_MIN} min). New orders are going to ${providerLabel(backup)} until ${providerLabel(p)} recovers. Check the ${providerLabel(p)} dashboard and wallet.`
  );
}
