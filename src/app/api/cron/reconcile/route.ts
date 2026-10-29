// src/app/api/cron/reconcile/route.ts
// Emails the daily reconciliation report. The email logic lives in
// @/lib/reconcile (route files may only export GET/POST/etc).

import { NextRequest } from "next/server";
import { sendReconcileEmail } from "@/lib/reconcile";
import { cronAuthorized } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  if (!cronAuthorized(req)) {
    return new Response("Unauthorized", { status: 401 });
  }
  const r = await sendReconcileEmail();
  return Response.json({ sent: true, ...r });
}
