// GET /api/admin — founder dashboard summary (read-only).
// Auth: Authorization: Bearer <ADMIN_PASSWORD>  (see src/lib/admin-auth.ts)

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { adminGate } from "@/lib/admin-auth";
import { getBalance, activeProvider, billsConfigured, billsTestMode } from "@/lib/bills";
import { paystackIsTestMode } from "@/lib/paystack";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

type Row = {
  id: string;
  email: string | null;
  status: string;
  biller_name: string;
  identifier: string;
  amount_ngn: number | string;
  amount_gbp_pence: number | null;
  service_fee_local: number | string | null;
  payment_provider: string | null;
  currency: string | null;
  created_at: string;
  error: string | null;
};

const COLS =
  "id,email,status,biller_name,identifier,amount_ngn,amount_gbp_pence,service_fee_local,payment_provider,currency,created_at,error";

// Supabase returns at most 1000 rows per request, so page through the window.
async function fetchOrders(sinceIso: string): Promise<Row[]> {
  const db = supabaseAdmin();
  const out: Row[] = [];
  for (let page = 0; page < 8; page++) {
    const { data, error } = await db
      .from("orders")
      .select(COLS)
      .gte("created_at", sinceIso)
      .order("created_at", { ascending: false })
      .range(page * 1000, page * 1000 + 999);
    if (error) throw error;
    out.push(...((data ?? []) as Row[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}

// Paystack local-card pricing (estimate): 1.5%, +₦100 on transactions of ₦2,500+, capped at ₦2,000.
const paystackFeeEstimate = (totalNgn: number) =>
  Math.min(2000, totalNgn * 0.015 + (totalNgn >= 2500 ? 100 : 0));

const num = (v: unknown) => Number(v ?? 0) || 0;
const ymd = (iso: string) => iso.slice(0, 10);

export async function GET(req: Request) {
  const denied = await adminGate(req);
  if (denied) return denied;

  try {
    const now = Date.now();
    const since = new Date(now - 35 * 86400_000).toISOString();
    const all = await fetchOrders(since);

    const isNgnPaystack = (o: Row) => o.payment_provider === "paystack";
    const fulfilled = all.filter((o) => o.status === "fulfilled");
    const inWindow = (o: Row, days: number) => now - new Date(o.created_at).getTime() < days * 86400_000;

    const windowStats = (days: number) => {
      const w = fulfilled.filter((o) => inWindow(o, days));
      const ps = w.filter(isNgnPaystack);
      const feeNgn = ps.reduce((a, o) => a + num(o.service_fee_local), 0);
      const collectedNgn = ps.reduce((a, o) => a + num(o.amount_ngn) + num(o.service_fee_local), 0);
      const paystackCosts = ps.reduce((a, o) => a + paystackFeeEstimate(num(o.amount_ngn) + num(o.service_fee_local)), 0);
      const gbp = w.filter((o) => !isNgnPaystack(o));
      return {
        orders: w.length,
        delivered_ngn: w.reduce((a, o) => a + num(o.amount_ngn), 0),
        fee_ngn: feeNgn,
        collected_ngn: collectedNgn,
        est_net_ngn: Math.round(feeNgn - paystackCosts),
        gbp_orders: gbp.length,
        gbp_revenue: gbp.reduce((a, o) => a + num(o.amount_gbp_pence), 0) / 100,
      };
    };

    // 14-day series (UTC days)
    const series: { day: string; orders: number; delivered_ngn: number }[] = [];
    for (let i = 13; i >= 0; i--) {
      const day = new Date(now - i * 86400_000).toISOString().slice(0, 10);
      const d = fulfilled.filter((o) => ymd(o.created_at) === day);
      series.push({ day, orders: d.length, delivered_ngn: d.reduce((a, o) => a + num(o.amount_ngn), 0) });
    }

    const statusCounts = all.filter((o) => inWindow(o, 30)).reduce((acc: Record<string, number>, o) => {
      acc[o.status] = (acc[o.status] ?? 0) + 1;
      return acc;
    }, {});

    // Needs attention: unresolved states, plus orders stuck in "paid" for > 5 minutes.
    const attention = all
      .filter(
        (o) =>
          o.status === "needs_review" ||
          o.status === "refund_failed" ||
          (o.status === "paid" && now - new Date(o.created_at).getTime() > 5 * 60_000)
      )
      .slice(0, 25);

    const recentFailures = all.filter((o) => o.status === "failed_refunded" && inWindow(o, 7)).slice(0, 10);

    // Top billers (30d, fulfilled)
    const byBiller: Record<string, { orders: number; ngn: number }> = {};
    for (const o of fulfilled.filter((o) => inWindow(o, 30))) {
      const k = o.biller_name || "Unknown";
      byBiller[k] ??= { orders: 0, ngn: 0 };
      byBiller[k].orders += 1;
      byBiller[k].ngn += num(o.amount_ngn);
    }
    const topBillers = Object.entries(byBiller)
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.ngn - a.ngn)
      .slice(0, 8);

    // Wallet balances (live from Flutterwave)
    const wallet = async (cur: string, low: number) => {
      try {
        const balance = await getBalance(cur);
        return { currency: cur, balance, low, ok: balance >= low, error: null as string | null };
      } catch (e: any) {
        return { currency: cur, balance: null as number | null, low, ok: false, error: String(e?.message ?? e).slice(0, 120) };
      }
    };
    const wallets = [await wallet("NGN", Number(process.env.LOW_BALANCE_NGN ?? "100000"))];
    if (process.env.NEXT_PUBLIC_GH_ENABLED === "1") {
      wallets.push(await wallet("GHS", Number(process.env.LOW_BALANCE_GHS ?? "500")));
    }

    // Config health — booleans only, never values.
    const flwKey = process.env.FLW_SECRET_KEY ?? "";
    const provider = activeProvider();
    const health = {
      bills_provider: provider,
      // Status of the ACTIVE bills provider: missing | test | live
      bills: !billsConfigured() ? "missing" : billsTestMode() ? "test" : "live",
      vtpass_phone: !!(process.env.VTPASS_DEFAULT_PHONE ?? "").trim(),
      flutterwave: flwKey ? (flwKey.startsWith("FLWSECK_TEST") ? "test" : "live") : "missing",
      paystack: process.env.PAYSTACK_SECRET_KEY ? (paystackIsTestMode() ? "test" : "live") : "missing",
      stripe: process.env.STRIPE_SECRET_KEY ? "set" : "missing",
      resend: process.env.RESEND_API_KEY ? "set" : "missing",
      cron_secret: !!process.env.CRON_SECRET,
      admin_secret: !!process.env.ADMIN_SECRET,
      app_url: process.env.NEXT_PUBLIC_APP_URL ?? null,
      ngn_pay_enabled: process.env.NEXT_PUBLIC_NGN_PAY_ENABLED === "1",
      uk_pay_enabled: process.env.NEXT_PUBLIC_UK_PAY_ENABLED === "1",
      gh_enabled: process.env.NEXT_PUBLIC_GH_ENABLED === "1",
      fee: {
        pct: Number(process.env.NEXT_PUBLIC_NG_FEE_PCT ?? "2"),
        min: Number(process.env.NEXT_PUBLIC_NG_FEE_MIN ?? process.env.NEXT_PUBLIC_NG_LOCAL_FEE_NGN ?? "100"),
        max: Number(process.env.NEXT_PUBLIC_NG_FEE_MAX ?? "500"),
      },
    };

    return NextResponse.json({
      generated_at: new Date().toISOString(),
      today: windowStats(1),
      week: windowStats(7),
      month: windowStats(30),
      statusCounts,
      series,
      topBillers,
      attention,
      recentFailures,
      wallets,
      health,
    });
  } catch (e: any) {
    console.error("[admin] stats failed", e);
    return NextResponse.json({ error: "Failed to load stats" }, { status: 500 });
  }
}
