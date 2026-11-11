import { NextResponse } from "next/server";
import { cronAuthorized } from "@/lib/security";
import { tgSweep } from "@/lib/tg/notify";

// Sends any Telegram customer the outcome that couldn't go out live (a token that landed late, an order resolved by
// hand, a message Telegram refused once). Run it every 10 minutes from cron-job.org with
// "Authorization: Bearer <CRON_SECRET>". Safe to run as often as you like.

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function run(req: Request) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "Forbidden" }, { status: 401 });
  return NextResponse.json(await tgSweep());
}
export const GET = run;
export const POST = run;
