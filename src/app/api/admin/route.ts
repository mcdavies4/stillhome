import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

// Admin stats API. Auth: Authorization: Bearer <ADMIN_PASSWORD>.
// Read-only aggregates for the founder dashboard.
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const secret = process.env.ADMIN_PASSWORD;
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = supabaseAdmin();
  const { data: orders, error } = await db
    .from("orders")
    .select("id,email,biller_name,identifier,customer_name,amount_ngn,amount_gbp_pence,fx_ngn_per_gbp,status,error,created_at")
    .order("created_at", { ascending: false })
    .limit(2000);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const all = orders ?? [];
  const fulfilled = all.filter((o) => o.status === "fulfilled");
  const now = Date.now();
  const inWindow = (o: any, days: number) =>
    now - new Date(o.created_at).getTime() < days * 86400 * 1000;

  const sum = (list: any[], f: (o: any) => number) => list.reduce((a, o) => a + f(o), 0);
  const windowStats = (days: number) => {
    const w = fulfilled.filter((o) => inWindow(o, days));
    return {
      orders: w.length,
      revenue_gbp: sum(w, (o) => o.amount_gbp_pence) / 100,
      delivered_ngn: sum(w, (o) => Number(o.amount_ngn)),
    };
  };

  // Monthly rollup
  const monthly: Record<string, { orders: number; revenue_gbp: number; delivered_ngn: number }> = {};
  for (const o of fulfilled) {
    const m = o.created_at.slice(0, 7);
    monthly[m] ??= { orders: 0, revenue_gbp: 0, delivered_ngn: 0 };
    monthly[m].orders += 1;
    monthly[m].revenue_gbp += o.amount_gbp_pence / 100;
    monthly[m].delivered_ngn += Number(o.amount_ngn);
  }

  // Top customers
  const byEmail: Record<string, { orders: number; total_gbp: number }> = {};
  for (const o of fulfilled) {
    byEmail[o.email] ??= { orders: 0, total_gbp: 0 };
    byEmail[o.email].orders += 1;
    byEmail[o.email].total_gbp += o.amount_gbp_pence / 100;
  }
  const topCustomers = Object.entries(byEmail)
    .map(([email, v]) => ({ email, ...v }))
    .sort((a, b) => b.total_gbp - a.total_gbp)
    .slice(0, 10);

  const problems = all
    .filter((o) => o.status === "refund_failed" || o.status === "failed_refunded")
    .slice(0, 15);

  return NextResponse.json({
    today: windowStats(1),
    week: windowStats(7),
    month: windowStats(30),
    statusCounts: all.reduce((acc: Record<string, number>, o) => {
      acc[o.status] = (acc[o.status] ?? 0) + 1;
      return acc;
    }, {}),
    monthly: Object.entries(monthly)
      .map(([month, v]) => ({ month, ...v }))
      .sort((a, b) => b.month.localeCompare(a.month))
      .slice(0, 12),
    topCustomers,
    problems,
  });
}
