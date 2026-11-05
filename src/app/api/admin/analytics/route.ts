import { NextResponse } from "next/server";
import { adminGate } from "@/lib/admin-auth";
import { loadAnalytics } from "@/lib/analytics";
import { buildStats } from "@/lib/analytics-stats";

export const dynamic = "force-dynamic";

// Founder-only: the numbers behind /admin/analytics. ?days=1 (today) | 7 | 30
export async function GET(req: Request) {
  const denied = await adminGate(req);
  if (denied) return denied;
  const q = Number(new URL(req.url).searchParams.get("days"));
  const days = (q === 1 || q === 30 ? q : 7) as 1 | 7 | 30;
  const { error, rows, orders, capped } = await loadAnalytics(days === 30 ? 30 : days);
  if (error) {
    return NextResponse.json({ tableReady: false, hint: "Run supabase/migrations/0024_site_events.sql in Supabase, then reload." });
  }
  return NextResponse.json({ tableReady: true, capped, generated_at: new Date().toISOString(), ...buildStats(rows, orders, { days }) });
}
