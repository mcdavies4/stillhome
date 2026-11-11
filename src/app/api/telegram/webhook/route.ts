import { NextResponse } from "next/server";
import { secretOk, telegramConfigured } from "@/lib/tg/api";
import { handleUpdate } from "@/lib/tg/engine";
import { realDeps } from "@/lib/tg/deps";

// Telegram bot webhook. Register it once with GET /api/telegram/setup (see TELEGRAM_SETUP.md).
// Telegram calls this for every message and button tap, with the secret we gave it in a header.
// We always answer 200 once the call is authentic, even if handling failed: a non-200 makes Telegram resend the
// same message again and again. Errors are logged, and the customer is told something went wrong.

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(req: Request) {
  if (!telegramConfigured()) return NextResponse.json({ error: "Telegram bot not configured" }, { status: 503 });
  if (!secretOk(req)) return NextResponse.json({ error: "Forbidden" }, { status: 401 });
  const update = await req.json().catch(() => null);
  if (!update || typeof update !== "object") return NextResponse.json({ ok: true });
  try {
    await handleUpdate(realDeps(), update);
  } catch (e: any) {
    console.error("[telegram] webhook failed", e?.message ?? e);
  }
  return NextResponse.json({ ok: true });
}
