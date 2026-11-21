// GET /api/admin/recurring — owner view of monthly plans that need attention, plus recent charge events.
// Auth: admin password (adminGate). Addresses are shown here only; nothing is logged.
import { NextResponse } from "next/server";
import { adminGate } from "@/lib/admin-auth";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const denied = await adminGate(req);
  if (denied) return denied;
  const db = supabaseAdmin();

  const [{ data: counts }, { data: attention }, { data: events }] = await Promise.all([
    db.from("recurring_plans").select("status"),
    db.from("recurring_plans")
      .select("id, email, biller_name, identifier, amount_ngn, status, failures, next_run_on, paused_at, cancelled_at, updated_at")
      .in("status", ["needs_action", "paused", "on_hold", "declined", "pending"])
      .order("updated_at", { ascending: false })
      .limit(200),
    db.from("recurring_charge_log")
      .select("plan_id, order_id, outcome, note, created_at")
      .order("created_at", { ascending: false })
      .limit(100),
  ]);

  const byStatus: Record<string, number> = {};
  for (const r of counts ?? []) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;

  // Plans that need a human: the reason is the latest log note for that plan.
  const latestNote = new Map<string, string>();
  for (const e of events ?? []) if (e.plan_id && !latestNote.has(e.plan_id)) latestNote.set(e.plan_id, `${e.outcome}${e.note ? ": " + e.note : ""}`);

  return NextResponse.json({
    byStatus,
    needsAttention: (attention ?? []).map((p) => ({ ...p, lastEvent: latestNote.get(p.id) ?? null })),
    recentEvents: events ?? [],
  });
}
