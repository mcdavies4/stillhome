import { NextResponse } from "next/server";
import { cronAuthorized } from "@/lib/security";
import { sweepReminders } from "@/lib/reminders";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Sends the top-up reminder emails (rules in lib/reminders.ts). Auth: Authorization: Bearer <CRON_SECRET>.
// Safe to call as often as you like: each delivered order is reminded about once. Once or twice a day is plenty.
export async function GET(req: Request) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try { return NextResponse.json(await sweepReminders()); }
  catch (e: any) { console.error("[cron/reminders] failed", e?.message ?? e); return NextResponse.json({ error: "failed" }, { status: 500 }); }
}
