import { NextResponse } from "next/server";
import { cronAuthorized } from "@/lib/security";
import { registerBot, telegramConfigured } from "@/lib/tg/api";

// One-time (and after any change of domain or secret): points Telegram at /api/telegram/webhook and sets the
// command menu. Protected with the same bearer secret as the cron jobs:
//   curl -H "Authorization: Bearer $CRON_SECRET" https://www.nolgic.com/api/telegram/setup

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "Forbidden" }, { status: 401 });
  if (!telegramConfigured()) return NextResponse.json({ error: "Set TELEGRAM_BOT_TOKEN first" }, { status: 400 });
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET ?? "";
  if (!/^[A-Za-z0-9_-]{16,256}$/.test(secret)) {
    return NextResponse.json({ error: "Set TELEGRAM_WEBHOOK_SECRET to a random string of 16+ letters, digits, _ or - (no spaces)" }, { status: 400 });
  }
  const app = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/+$/, "");
  if (!app.startsWith("https://")) return NextResponse.json({ error: "NEXT_PUBLIC_APP_URL must be the https site address" }, { status: 400 });
  try {
    const r = await registerBot(`${app}/api/telegram/webhook`, secret);
    return NextResponse.json({ ok: true, ...r, openBot: r.username ? `https://t.me/${r.username}` : null });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message ?? e) }, { status: 502 });
  }
}
