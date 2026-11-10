// Public trust numbers for /proof. Read straight from our own order records, never edited by hand.
// Only naira orders that were really paid count; test orders and abandoned checkouts never do.
//
//   delivered   status "fulfilled"
//   refunded    status "failed_refunded"     delivery failed and the customer was refunded in full
//   by hand     status "refund_failed"       delivery failed and the automatic refund did not go through (we fix these manually)
//   in progress status "paid" or "needs_review"   paid, still being delivered or checked
//   rate        delivered / (delivered + refunded + by hand)   in-progress orders are not counted either way

import { supabaseAdmin } from "@/lib/supabase";

export type ProofRow = { status: string; amount_ngn: number | string | null; created_at: string; biller_name?: string | null };
export type ProofWindow = { delivered: number; refunded: number; byHand: number; inProgress: number; resolved: number; ratePct: number | null; deliveredNgn: number };
export type Proof = { generatedAt: string; firstOrderAt: string | null; last30: ProofWindow; all: ProofWindow; bulk: { batches: number; numbersDelivered: number; numbersFailed: number } | null };

const DAY = 86400_000;
const COUNTED = ["fulfilled", "failed_refunded", "refund_failed", "paid", "needs_review"];

export function emptyWindow(): ProofWindow { return { delivered: 0, refunded: 0, byHand: 0, inProgress: 0, resolved: 0, ratePct: null, deliveredNgn: 0 }; }

/** Pure: totals for a set of orders. */
export function summarise(rows: ProofRow[], sinceMs = 0): ProofWindow {
  const w = emptyWindow();
  for (const r of rows) {
    if (new Date(r.created_at).getTime() < sinceMs) continue;
    if (r.status === "fulfilled") { w.delivered++; w.deliveredNgn += Number(r.amount_ngn) || 0; }
    else if (r.status === "failed_refunded") w.refunded++;
    else if (r.status === "refund_failed") w.byHand++;
    else if (r.status === "paid" || r.status === "needs_review") w.inProgress++;
  }
  w.resolved = w.delivered + w.refunded + w.byHand;
  w.ratePct = w.resolved > 0 ? Math.round((w.delivered / w.resolved) * 1000) / 10 : null;
  return w;
}

async function readOrders(): Promise<ProofRow[]> {
  const db = supabaseAdmin();
  const run = async (excludeTests: boolean) => {
    const out: ProofRow[] = [];
    for (let p = 0; p < 20; p++) {
      let q = db.from("orders").select("status,amount_ngn,created_at,biller_name").in("status", COUNTED).in("payment_provider", ["paystack", "flutterwave"]);
      if (excludeTests) q = q.eq("is_test", false);
      const { data, error } = await q.order("created_at", { ascending: true }).range(p * 1000, p * 1000 + 999);
      if (error) throw error;
      out.push(...((data ?? []) as ProofRow[]));
      if (!data || data.length < 1000) break;
    }
    return out;
  };
  try { return await run(true); }
  catch (e: any) { if (/is_test/.test(String(e?.message ?? ""))) return run(false); throw e; }
}

async function readBulk(): Promise<Proof["bulk"]> {
  try {
    const { data, error } = await supabaseAdmin().from("bulk_orders").select("delivered_count,failed_count,status,is_test").eq("status", "settled").limit(5000);
    if (error) return null;
    const rows = ((data ?? []) as any[]).filter((b) => !b.is_test);
    if (!rows.length) return null;
    return { batches: rows.length, numbersDelivered: rows.reduce((s, b) => s + (Number(b.delivered_count) || 0), 0), numbersFailed: rows.reduce((s, b) => s + (Number(b.failed_count) || 0), 0) };
  } catch { return null; }
}

let cache: { at: number; value: Proof } | null = null;
const TTL_MS = 5 * 60_000;

/** Cached for 5 minutes so a busy page never hammers the database. Returns null if the records cannot be read. */
export async function getProof(now = Date.now()): Promise<Proof | null> {
  if (cache && now - cache.at < TTL_MS) return cache.value;
  try {
    const [rows, bulk] = await Promise.all([readOrders(), readBulk()]);
    const value: Proof = {
      generatedAt: new Date(now).toISOString(),
      firstOrderAt: rows.length ? rows[0].created_at : null,
      last30: summarise(rows, now - 30 * DAY),
      all: summarise(rows),
      bulk,
    };
    cache = { at: now, value };
    return value;
  } catch (e) {
    console.error("[proof] could not read orders", (e as any)?.message ?? e);
    return cache?.value ?? null;
  }
}

export const __resetProofCache = () => { cache = null; };
