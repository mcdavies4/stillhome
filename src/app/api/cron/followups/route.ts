import { NextResponse } from "next/server";
import { cronAuthorized } from "@/lib/security";
import { sweepFollowups } from "@/lib/followup";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Sends the "did something go wrong?" email for abandoned orders (see lib/followup.ts for the rules).
// Auth: Authorization: Bearer <CRON_SECRET>. Safe to call as often as you like: each order is emailed once.
export async function GET(req: Request) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try { return NextResponse.json(await sweepFollowups()); }
  catch (e: any) { console.error("[cron/followups] failed", e?.message ?? e); return NextResponse.json({ error: "failed" }, { status: 500 }); }
}
