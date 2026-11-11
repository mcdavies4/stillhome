import { NextResponse } from "next/server";

// nolgic.com/telegram opens the Nolgic bot in Telegram. Put this link in bios, posts and the rep brief: it keeps
// working if the bot's username ever changes (change NEXT_PUBLIC_TELEGRAM_BOT_USERNAME, nothing else).
export const dynamic = "force-dynamic";

export function GET(req: Request) {
  const user = (process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME ?? "").replace(/^@/, "").trim();
  const home = (process.env.NEXT_PUBLIC_APP_URL ?? new URL(req.url).origin).replace(/\/+$/, "");
  return NextResponse.redirect(/^[A-Za-z0-9_]{4,32}$/.test(user) ? `https://t.me/${user}` : `${home}/`, 307);
}
