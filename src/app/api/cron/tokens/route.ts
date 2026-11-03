import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { tryRecoverToken, expectsToken } from "@/lib/fulfilment";
import { sendReconcileEmail } from "@/lib/reconcile";
import { cronAuthorized } from "@/lib/security";
import { sweepBulk } from "@/lib/bulk";
import { sweepFollowups } from "@/lib/followup";

// Daily backstop: recover tokens for fulfilled orders still missing one
// (last 72h). Vercel Cron calls this with Authorization: Bearer CRON_SECRET.
//
// Also sends the daily reconciliation email — folded in here rather than as a
// separate cron, because Vercel Hobby allows only two cron jobs and both slots
// (this + the 7am FX guard) are already used.
export async function GET(req: Request) {
  if (!cronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Bulk airtime safety net: nudge any batch that isn't finished (missed webhook, customer closed the page).
  try { await sweepBulk(); } catch (e) { console.error("[cron] bulk sweep failed", e); }

  // Abandoned-order follow-ups: this daily run is the fallback. For faster emails (about an hour after the order is
  // abandoned) call /api/cron/followups every 30 minutes from an outside scheduler (see FOLLOWUPS_SETUP.md).
  let followups: unknown = null;
  try { followups = await sweepFollowups(); } catch (e) { console.error("[cron] follow-up sweep failed", e); }

  const db = supabaseAdmin();
  const since = new Date(Date.now() - 72 * 3600 * 1000).toISOString();
  const { data: orders } = await db
    .from("orders")
    .select("*")
    .eq("status", "fulfilled")
    .is("flw_token", null)
    .gte("created_at", since)
    .limit(50);

  let recovered = 0;
  for (const order of orders ?? []) {
    if (!expectsToken(order)) continue;
    const token = await tryRecoverToken(db, order);
    if (token) recovered++;
  }

  let reconcile: { ok: boolean; flags: number } | { error: string };
  try {
    reconcile = await sendReconcileEmail();
  } catch (e) {
    console.error("[cron/tokens] reconcile email failed", e);
    reconcile = { error: String(e) };
  }

  return NextResponse.json({ checked: orders?.length ?? 0, recovered, reconcile, followups });
}
