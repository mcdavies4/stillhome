// POST /api/push/register  { token: "ExponentPushToken[...]", platform?: "android" | "ios" }
// Called by the Nolgic app after the user allows notifications. Stores only the device token, no email or name.
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const TOKEN_RE = /^Expo(nent)?PushToken\[[A-Za-z0-9_\-.]{10,200}\]$/;

export async function POST(req: Request) {
  const body = await req.json().catch(() => null) as null | { token?: string; platform?: string };
  const token = String(body?.token ?? "").trim();
  if (!TOKEN_RE.test(token)) return NextResponse.json({ error: "Invalid token" }, { status: 400 });
  const platform = body?.platform === "ios" ? "ios" : "android";
  const { error } = await supabaseAdmin()
    .from("push_tokens")
    .upsert({ token, platform, last_seen: new Date().toISOString() }, { onConflict: "token" });
  if (error) return NextResponse.json({ error: "Could not save" }, { status: 500 });
  return NextResponse.json({ ok: true });
}
