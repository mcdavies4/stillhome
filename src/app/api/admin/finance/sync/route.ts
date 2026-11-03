// POST /api/admin/finance/sync {from,to} — fills in the two real-money columns on delivered orders in the period:
//   commission_ngn      snapshot of the commission at the rates in Settings (so changing a rate later doesn't rewrite history)
//   processor_fee_ngn   what Flutterwave actually charged, read from Flutterwave's own record of the payment (app_fee)
// Touches nothing about payments or delivery. Up to 40 Flutterwave lookups per click; press again if "remaining" is above 0.
import { NextResponse } from "next/server";
import { adminGate } from "@/lib/admin-auth";
import { supabaseAdmin } from "@/lib/supabase";
import { flwBase, flwExtraHeaders } from "@/lib/flutterwave";
import { dayAfterIso, dayStartIso, estimateCommission, loadSettings, logAudit, periodFrom, productOf } from "@/lib/finance";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function flwFee(id: string): Promise<number | null> {
  const key = (process.env.FLW_SECRET_KEY ?? "").trim();
  if (!key || !/^\d+$/.test(id)) return null;
  try {
    const res = await fetch(`${flwBase()}/transactions/${id}/verify`, { cache: "no-store", headers: { Authorization: `Bearer ${key}`, ...flwExtraHeaders() } });
    const b: any = await res.json().catch(() => null);
    if (!res.ok || String(b?.data?.status ?? "").toLowerCase() !== "successful") return null;
    const fee = Number(b?.data?.app_fee);
    return Number.isFinite(fee) && fee >= 0 ? fee : null;
  } catch { return null; }
}

export async function POST(req: Request) {
  const denied = await adminGate(req);
  if (denied) return denied;
  let body: any = {};
  try { body = await req.json(); } catch { /* defaults */ }
  const u = new URL("http://x/?" + new URLSearchParams({ from: String(body?.from ?? ""), to: String(body?.to ?? "") }));
  const { from, to } = periodFrom(u);
  const db = supabaseAdmin();
  const { settings } = await loadSettings();
  const now = new Date().toISOString();

  const { data: orders, error } = await db.from("orders")
    .select("id,biller_code,item_code,biller_name,amount_ngn,service_fee_local,flw_pay_id,commission_ngn,processor_fee_ngn,is_test")
    .eq("status", "fulfilled").gte("created_at", dayStartIso(from)).lt("created_at", dayAfterIso(to)).limit(1000);
  if (error) return NextResponse.json({ error: "Couldn't read orders. Has migration 0020 been run in Supabase?" }, { status: 500 });

  let commissionSet = 0;
  for (const o of (orders ?? []) as any[]) {
    if (o.commission_ngn != null) continue;
    const c = estimateCommission(settings, productOf(o), Number(o.amount_ngn) || 0, o.biller_code);
    const { error: e } = await db.from("orders").update({ commission_ngn: c, econ_at: now }).eq("id", o.id);
    if (!e) commissionSet++;
  }

  const todo = ((orders ?? []) as any[]).filter((o) => o.processor_fee_ngn == null && o.flw_pay_id && !o.is_test);
  const batch = todo.slice(0, 40);
  let feesFetched = 0;
  for (let i = 0; i < batch.length; i += 4) {
    await Promise.all(batch.slice(i, i + 4).map(async (o) => {
      const fee = await flwFee(String(o.flw_pay_id));
      if (fee == null) return;
      const { error: e } = await db.from("orders").update({ processor_fee_ngn: fee, econ_at: now }).eq("id", o.id);
      if (!e) feesFetched++;
    }));
  }

  // Bulk batches: same idea for the Flutterwave fee (their commission is already exact from Paybeta's wallet debit).
  let bulkFetched = 0; let bulkRemaining = 0;
  try {
    const { data: bulk } = await db.from("bulk_orders").select("id,flw_pay_id,processor_fee_ngn,is_test").eq("status", "settled")
      .gte("created_at", dayStartIso(from)).lt("created_at", dayAfterIso(to)).limit(200);
    const pending = ((bulk ?? []) as any[]).filter((b) => b.processor_fee_ngn == null && b.flw_pay_id && !b.is_test);
    const room = Math.max(0, 40 - batch.length);
    for (const b of pending.slice(0, room)) {
      const fee = await flwFee(String(b.flw_pay_id));
      if (fee == null) continue;
      const { error: e } = await db.from("bulk_orders").update({ processor_fee_ngn: fee, econ_at: now }).eq("id", b.id);
      if (!e) bulkFetched++;
    }
    bulkRemaining = Math.max(0, pending.length - room);
  } catch { /* bulk tables not present */ }

  const remaining = Math.max(0, todo.length - batch.length) + bulkRemaining;
  await logAudit(req, "finance.sync", `${from}..${to}`, { commissionSet, feesFetched, bulkFetched, remaining });
  return NextResponse.json({ commissionSet, feesFetched: feesFetched + bulkFetched, remaining, checked: (orders ?? []).length });
}
