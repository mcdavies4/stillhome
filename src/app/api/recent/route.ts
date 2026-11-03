import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { billsTestMode } from "@/lib/bills";
import { buildNotices, DELAY_MINUTES, WINDOW_HOURS } from "@/lib/recent-orders";

export const dynamic = "force-dynamic";

// Public, anonymous list of recent REAL deliveries for the site's "recent orders" notice.
// Never includes test orders, and returns an empty list on any doubt (test mode, missing is_test
// column, database error) — it is better to show nothing than something that did not happen.
export async function GET() {
  const headers = { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120" };
  if (billsTestMode()) return NextResponse.json({ items: [] }, { headers });
  try {
    const now = Date.now();
    const { data, error } = await supabaseAdmin()
      .from("orders")
      .select("biller_name, amount_ngn, created_at")
      .eq("status", "fulfilled")
      .eq("is_test", false)
      .in("payment_provider", ["flutterwave", "paystack"])
      .gte("created_at", new Date(now - WINDOW_HOURS * 3600_000).toISOString())
      .lte("created_at", new Date(now - DELAY_MINUTES * 60_000).toISOString())
      .order("created_at", { ascending: false })
      .limit(30);
    if (error || !data) return NextResponse.json({ items: [] }, { headers });
    return NextResponse.json({ items: buildNotices(data as any, now) }, { headers });
  } catch {
    return NextResponse.json({ items: [] }, { headers });
  }
}
