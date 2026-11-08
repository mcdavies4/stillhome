// src/app/api/cron/reconcile/route.ts
// Emails the daily reconciliation report. The email logic lives in
// @/lib/reconcile (route files may only export GET/POST/etc).

import { NextRequest } from "next/server";
import { sendReconcileEmail } from "@/lib/reconcile";
import { cronAuthorized } from "@/lib/security";
import { sweepBulk } from "@/lib/bulk";
import { sweepPayRequests } from "@/lib/payforme";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  if (!cronAuthorized(req)) {
    return new Response("Unauthorized", { status: 401 });
  }
  // Safety net: nudge any bulk airtime batch that isn't finished (a webhook missed, a customer who closed the page).
  try { await sweepBulk(); } catch (e) { console.error("[reconcile] bulk sweep failed", e); }
  // Same for "Pay for Me" requests (nothing to do while the feature has never been used).
  try { await sweepPayRequests(); } catch (e) { console.error("[reconcile] pay-for-me sweep failed", e); }
  const r = await sendReconcileEmail();
  return Response.json({ sent: true, ...r });
}
