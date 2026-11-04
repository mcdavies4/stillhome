import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { UUID_RE } from "@/lib/security";

export const dynamic = "force-dynamic";

// The "Stop these reminders" button. A button (POST), not a link, so an email scanner opening the link cannot unsubscribe anyone.
export async function POST(req: Request) {
  let body: any; try { body = await req.json(); } catch { return NextResponse.json({ error: "Bad request" }, { status: 400 }); }
  const token = String(body?.token ?? "");
  if (!UUID_RE.test(token)) return NextResponse.json({ error: "Bad link" }, { status: 400 });
  const db = supabaseAdmin();
  const { data } = await db.from("reminder_log").select("email").eq("token", token).maybeSingle();
  if (!data) return NextResponse.json({ error: "This link is not valid." }, { status: 404 });
  await db.from("reminder_optout").upsert({ email: String((data as any).email).toLowerCase() }, { onConflict: "email" });
  return NextResponse.json({ ok: true });
}
