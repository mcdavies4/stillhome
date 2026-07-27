// src/lib/reconcile.ts
// Reusable daily reconciliation. Computes the three-way check
// (Stripe collected ⟷ orders ⟷ Flutterwave vended) and returns both a
// structured result and an email-ready HTML body.
//
// Call from a cron route (see /api/cron/reconcile) or fold runReconcile()
// into an existing cron. Read-only: never writes, refunds, or vends.

import Stripe from "stripe";
import { supabaseAdmin } from "@/lib/supabase";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

export interface ReconResult {
  date: string;
  orderCount: number;
  byStatus: Record<string, number>;
  collectedPence: number;
  vendedNgn: number;
  refundedPence: number;
  marginPence: number;
  flags: { level: "danger" | "warn"; msg: string }[];
  ok: boolean;
}

const gbp = (p: number) => `£${(p / 100).toFixed(2)}`;
const ngn = (n: number) => `₦${Number(n).toLocaleString()}`;

function yesterdayUTC(): string {
  return new Date(Date.now() - 24 * 3600_000).toISOString().slice(0, 10);
}

async function stripeCharges(start: Date, end: Date) {
  const out: { id: string; amount: number; orderId: string | null; refunded: boolean }[] = [];
  for await (const ch of stripe.charges.list({
    created: { gte: Math.floor(start.getTime() / 1000), lte: Math.floor(end.getTime() / 1000) },
    limit: 100,
  })) {
    if (ch.status !== "succeeded") continue;
    out.push({ id: ch.id, amount: ch.amount, orderId: (ch.metadata?.order_id as string) ?? null, refunded: ch.refunded });
  }
  return out;
}

async function flwVended(reference: string): Promise<{ found: boolean; status: string | null }> {
  try {
    const res = await fetch(`https://api.flutterwave.com/v3/bills/${encodeURIComponent(reference)}`, {
      headers: { Authorization: `Bearer ${process.env.FLW_SECRET_KEY}` },
    });
    const data = (await res.json()) as { status?: string; data?: { status?: string } };
    if (data?.status === "success" && data?.data) {
      return { found: true, status: String(data.data.status ?? "").toLowerCase() };
    }
    return { found: false, status: null };
  } catch {
    return { found: false, status: null };
  }
}

export async function runReconcile(dateStr = yesterdayUTC(), deep = true): Promise<ReconResult> {
  const db = supabaseAdmin();
  const start = new Date(`${dateStr}T00:00:00.000Z`);
  const end = new Date(`${dateStr}T23:59:59.999Z`);

  const [{ data: orders }, charges] = await Promise.all([
    db.from("orders")
      .select("id, status, source, biller_name, identifier, amount_ngn, amount_gbp_pence, flw_reference, created_at")
      .gte("created_at", start.toISOString())
      .lte("created_at", end.toISOString()),
    stripeCharges(start, end),
  ]);

  const rows = orders ?? [];
  const byStatus: Record<string, number> = {};
  const flags: ReconResult["flags"] = [];
  let collectedPence = 0, vendedNgn = 0, refundedPence = 0;

  const fulfilled = rows.filter((o) => o.status === "fulfilled");
  for (const o of rows) byStatus[o.status] = (byStatus[o.status] ?? 0) + 1;
  for (const o of fulfilled) {
    collectedPence += Number(o.amount_gbp_pence ?? 0);
    vendedNgn += Number(o.amount_ngn ?? 0);
  }

  const chargeByOrder = new Map(charges.filter((c) => c.orderId).map((c) => [c.orderId!, c]));
  for (const c of charges) {
    if (c.refunded) refundedPence += c.amount;
    if (!c.orderId) { flags.push({ level: "warn", msg: `Stripe charge ${c.id} (${gbp(c.amount)}) has no order_id` }); continue; }
    const o = rows.find((x) => x.id === c.orderId);
    if (!o) { flags.push({ level: "warn", msg: `Stripe charge ${c.id} (${gbp(c.amount)}) → order not in this day` }); continue; }
    if (!c.refunded && o.status !== "fulfilled")
      flags.push({ level: "danger", msg: `Paid but not fulfilled: order ${o.id} status=${o.status}, ${gbp(c.amount)} charged & not refunded` });
  }
  for (const o of fulfilled) if (!chargeByOrder.get(o.id))
    flags.push({ level: "danger", msg: `Fulfilled order ${o.id} has NO matching Stripe charge` });

  if (deep) {
    for (const o of fulfilled) {
      if (!o.flw_reference) { flags.push({ level: "warn", msg: `Fulfilled order ${o.id} has no flw_reference to verify` }); continue; }
      const v = await flwVended(o.flw_reference);
      if (!v.found) flags.push({ level: "danger", msg: `DANGER: order ${o.id} fulfilled but Flutterwave has no record of ${o.flw_reference}` });
      else if (v.status && !v.status.includes("success") && !v.status.includes("completed"))
        flags.push({ level: "danger", msg: `order ${o.id}: FLW status "${v.status}" (expected success)` });
    }
  }
  for (const o of rows.filter((o) => o.status === "needs_review"))
    flags.push({ level: "warn", msg: `needs_review UNRESOLVED: order ${o.id} (${o.biller_name} ${ngn(o.amount_ngn)})` });
  for (const o of rows.filter((o) => o.status === "refund_failed"))
    flags.push({ level: "danger", msg: `refund_failed: order ${o.id} — manual refund needed` });

  const rate = Number(process.env.NGN_PER_GBP ?? 2050);
  const marginPence = collectedPence - Math.round((vendedNgn / rate) * 100);

  return {
    date: dateStr, orderCount: rows.length, byStatus,
    collectedPence, vendedNgn, refundedPence, marginPence,
    flags, ok: flags.length === 0,
  };
}

export function reconEmailHtml(r: ReconResult): string {
  const statusLine = Object.entries(r.byStatus).map(([k, v]) => `${k}: ${v}`).join(" · ") || "no orders";
  const flagsHtml = r.ok
    ? `<p style="color:#0a7d34;font-size:16px;font-weight:600">✓ All matched — Stripe, orders and Flutterwave agree.</p>`
    : `<p style="color:#b40000;font-weight:600">${r.flags.length} thing(s) to look at:</p><ul>` +
      r.flags.map((f) => `<li style="color:${f.level === "danger" ? "#b40000" : "#8a6d00"};margin-bottom:6px">${f.level === "danger" ? "⚠ " : ""}${f.msg}</li>`).join("") +
      `</ul>`;
  return `
  <div style="font-family:system-ui,Arial,sans-serif;max-width:560px;margin:0 auto;color:#12151e">
    <h2 style="margin:0 0 4px">Nolgic reconciliation — ${r.date}</h2>
    <p style="color:#666;margin:0 0 16px">Daily three-way check</p>
    <table style="width:100%;border-collapse:collapse;font-size:15px">
      <tr><td style="padding:6px 0;color:#666">Orders</td><td style="text-align:right">${r.orderCount} <span style="color:#999">(${statusLine})</span></td></tr>
      <tr><td style="padding:6px 0;color:#666">Collected (fulfilled)</td><td style="text-align:right;font-weight:600;color:#0a7d34">${gbp(r.collectedPence)}</td></tr>
      <tr><td style="padding:6px 0;color:#666">Vended</td><td style="text-align:right">${ngn(r.vendedNgn)}</td></tr>
      <tr><td style="padding:6px 0;color:#666">Refunded (Stripe)</td><td style="text-align:right">${gbp(r.refundedPence)}</td></tr>
      <tr><td style="padding:6px 0;color:#666">Rough gross margin</td><td style="text-align:right">~${gbp(r.marginPence)}</td></tr>
    </table>
    <hr style="border:none;border-top:1px solid #eee;margin:16px 0"/>
    ${flagsHtml}
    <p style="color:#999;font-size:12px;margin-top:20px">Margin is indicative (flat ₦${process.env.NGN_PER_GBP ?? 2050}/£), not accounting. Read-only report.</p>
  </div>`;
}
