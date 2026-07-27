// scripts/reconcile.ts
// Daily three-way reconciliation for Nolgic.
//
//   Stripe (GBP collected)  ⟷  orders table (what the app thinks)  ⟷  Flutterwave (NGN vended)
//
// Run:
//   npx tsx scripts/reconcile.ts            # yesterday (UTC)
//   npx tsx scripts/reconcile.ts 2026-07-13 # a specific day
//   npx tsx scripts/reconcile.ts 2026-07-01 2026-07-13   # a range
//
// Env needed (same names the app uses):
//   STRIPE_SECRET_KEY, FLW_SECRET_KEY,
//   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//
// Read-only: this script never writes, refunds, or vends. Safe to run anytime.

import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

// ---------- date window ----------
function dayBounds(dateStr: string): { start: Date; end: Date; label: string } {
  const start = new Date(`${dateStr}T00:00:00.000Z`);
  const end = new Date(`${dateStr}T23:59:59.999Z`);
  return { start, end, label: dateStr };
}
function yesterdayUTC(): string {
  const d = new Date(Date.now() - 24 * 3600_000);
  return d.toISOString().slice(0, 10);
}
function datesInRange(from: string, to: string): string[] {
  const out: string[] = [];
  const d = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (d <= end) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

const gbp = (pence: number) => `£${(pence / 100).toFixed(2)}`;
const ngn = (n: number) => `₦${Number(n).toLocaleString()}`;
const C = {
  reset: "\x1b[0m", red: "\x1b[31m", green: "\x1b[32m", yellow: "\x1b[33m",
  cyan: "\x1b[36m", grey: "\x1b[90m", bold: "\x1b[1m",
};

// ---------- Stripe: succeeded charges in window ----------
async function stripeCharges(start: Date, end: Date) {
  const charges: { id: string; amount: number; orderId: string | null; refunded: boolean }[] = [];
  for await (const ch of stripe.charges.list({
    created: { gte: Math.floor(start.getTime() / 1000), lte: Math.floor(end.getTime() / 1000) },
    limit: 100,
  })) {
    if (ch.status !== "succeeded") continue;
    charges.push({
      id: ch.id,
      amount: ch.amount,
      orderId: (ch.metadata?.order_id as string) ?? null,
      refunded: ch.refunded,
    });
  }
  return charges;
}

// ---------- Flutterwave: bill payments (debits) in window ----------
// FLW doesn't expose a clean "wallet debits by day" list across all accounts,
// so we reconcile against the orders we believe vended by requerying each by
// reference. This is authoritative per-order and avoids guessing wallet math.
async function flwVended(reference: string): Promise<{ found: boolean; status: string | null }> {
  try {
    const res = await fetch(
      `https://api.flutterwave.com/v3/bills/${encodeURIComponent(reference)}`,
      { headers: { Authorization: `Bearer ${process.env.FLW_SECRET_KEY}` } }
    );
    const data = (await res.json()) as { status?: string; data?: { status?: string } };
    if (data?.status === "success" && data?.data) {
      const st = String(data.data.status ?? "").toLowerCase();
      return { found: true, status: st };
    }
    return { found: false, status: null };
  } catch {
    return { found: false, status: null };
  }
}

// ---------- orders table for the day ----------
async function ordersForDay(start: Date, end: Date) {
  const { data, error } = await db
    .from("orders")
    .select("id, status, source, biller_name, identifier, amount_ngn, amount_gbp_pence, flw_reference, flw_token, stripe_payment_intent, error, created_at")
    .gte("created_at", start.toISOString())
    .lte("created_at", end.toISOString())
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

// ---------- reconcile one day ----------
async function reconcileDay(dateStr: string, deep: boolean) {
  const { start, end, label } = dayBounds(dateStr);
  const [orders, charges] = await Promise.all([
    ordersForDay(start, end),
    stripeCharges(start, end),
  ]);

  const byStatus: Record<string, number> = {};
  let collectedPence = 0, vendedNgn = 0, refundedPence = 0;
  const flags: string[] = [];

  const fulfilled = orders.filter((o) => o.status === "fulfilled");
  const needsReview = orders.filter((o) => o.status === "needs_review");
  const refundFailed = orders.filter((o) => o.status === "refund_failed");

  for (const o of orders) byStatus[o.status] = (byStatus[o.status] ?? 0) + 1;
  for (const o of fulfilled) {
    collectedPence += Number(o.amount_gbp_pence ?? 0);
    vendedNgn += Number(o.amount_ngn ?? 0);
  }

  // --- Stripe ⟷ orders ---
  const chargeByOrder = new Map(charges.filter((c) => c.orderId).map((c) => [c.orderId!, c]));
  for (const c of charges) {
    if (c.refunded) refundedPence += c.amount;
    if (!c.orderId) { flags.push(`${C.yellow}Stripe charge ${c.id} (${gbp(c.amount)}) has no order_id in metadata${C.reset}`); continue; }
    const o = orders.find((x) => x.id === c.orderId);
    if (!o) { flags.push(`${C.yellow}Stripe charge ${c.id} (${gbp(c.amount)}) → order ${c.orderId} not found in this day's orders${C.reset}`); continue; }
    if (!c.refunded && o.status !== "fulfilled") {
      flags.push(`${C.red}⚠ Paid but not fulfilled: order ${o.id} status=${o.status}, Stripe ${gbp(c.amount)} charged & NOT refunded${C.reset}`);
    }
  }

  // --- orders ⟷ Stripe (fulfilled must have a real charge) ---
  for (const o of fulfilled) {
    const c = chargeByOrder.get(o.id);
    if (!c) flags.push(`${C.red}⚠ Fulfilled order ${o.id} has NO matching succeeded Stripe charge${C.reset}`);
  }

  // --- orders ⟷ Flutterwave (deep: requery each fulfilled order) ---
  if (deep) {
    for (const o of fulfilled) {
      if (!o.flw_reference) { flags.push(`${C.yellow}Fulfilled order ${o.id} has no flw_reference to verify${C.reset}`); continue; }
      const v = await flwVended(o.flw_reference);
      if (!v.found) {
        flags.push(`${C.red}⚠ DANGER: order ${o.id} marked fulfilled but Flutterwave has NO record of ref ${o.flw_reference} — customer may have paid & got nothing${C.reset}`);
      } else if (v.status && !v.status.includes("success") && !v.status.includes("completed")) {
        flags.push(`${C.red}⚠ order ${o.id}: FLW status "${v.status}" for ref ${o.flw_reference} (expected success)${C.reset}`);
      }
    }
  }

  // --- always-flag piles ---
  for (const o of needsReview) flags.push(`${C.yellow}needs_review UNRESOLVED: order ${o.id} (${o.biller_name} ${ngn(o.amount_ngn)}) — check FLW dashboard${C.reset}`);
  for (const o of refundFailed) flags.push(`${C.red}⚠ refund_failed: order ${o.id} — manual refund needed${C.reset}`);

  // --- print ---
  console.log(`\n${C.bold}${C.cyan}━━━ ${label} ━━━${C.reset}`);
  console.log(`${C.grey}orders:${C.reset} ${orders.length}   ${Object.entries(byStatus).map(([k, v]) => `${k}:${v}`).join("  ")}`);
  console.log(`${C.grey}collected (fulfilled):${C.reset} ${C.green}${gbp(collectedPence)}${C.reset}   ${C.grey}vended:${C.reset} ${ngn(vendedNgn)}   ${C.grey}refunded (Stripe):${C.reset} ${gbp(refundedPence)}`);
  const marginPence = collectedPence - Math.round(vendedNgn / (Number(process.env.NGN_PER_GBP ?? 2050)) * 100);
  console.log(`${C.grey}rough gross margin:${C.reset} ~${gbp(marginPence)} ${C.grey}(at ₦${process.env.NGN_PER_GBP ?? 2050}/£; indicative only)${C.reset}`);

  if (flags.length === 0) {
    console.log(`${C.green}✓ all matched — Stripe, orders and Flutterwave agree${C.reset}`);
  } else {
    console.log(`${C.bold}${C.red}${flags.length} thing(s) to look at:${C.reset}`);
    for (const f of flags) console.log("  • " + f);
  }

  return { collectedPence, vendedNgn, refundedPence, flagCount: flags.length };
}

// ---------- main ----------
async function main() {
  const args = process.argv.slice(2);
  const deep = !args.includes("--fast");
  const dateArgs = args.filter((a) => /^\d{4}-\d{2}-\d{2}$/.test(a));

  let days: string[];
  if (dateArgs.length === 2) days = datesInRange(dateArgs[0], dateArgs[1]);
  else if (dateArgs.length === 1) days = [dateArgs[0]];
  else days = [yesterdayUTC()];

  console.log(`${C.bold}Nolgic reconciliation${C.reset} ${C.grey}(${deep ? "deep — verifies each vend with Flutterwave" : "fast — skips FLW requery"})${C.reset}`);

  let tC = 0, tR = 0, tFlags = 0;
  for (const day of days) {
    const r = await reconcileDay(day, deep);
    tC += r.collectedPence; tR += r.refundedPence; tFlags += r.flagCount;
  }

  if (days.length > 1) {
    console.log(`\n${C.bold}${C.cyan}━━━ TOTAL ${days[0]} → ${days[days.length - 1]} ━━━${C.reset}`);
    console.log(`collected ${C.green}${gbp(tC)}${C.reset}   refunded ${gbp(tR)}   flags ${tFlags === 0 ? C.green + "0 ✓" : C.red + tFlags}${C.reset}`);
  }
  console.log("");
  process.exit(tFlags > 0 ? 1 : 0); // non-zero exit if anything flagged (handy for alerts)
}

main().catch((e) => { console.error("reconcile failed:", e); process.exit(2); });
