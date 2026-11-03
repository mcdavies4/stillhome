import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { rateLimit } from "@/lib/ratelimit";
import { cap } from "@/lib/security";
import { REASONS } from "@/lib/followup";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The link in the follow-up email. GET only shows what the link is for (it records nothing, so an email scanner
// opening the link cannot fake an answer); POST saves the reason, or the opt-out.
export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("token") ?? "";
  if (!UUID.test(token)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const db = supabaseAdmin();
  const { data: f } = await db.from("order_followups").select("order_id,reason,responded_at").eq("token", token).maybeSingle();
  if (!f) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { data: o } = await db.from("orders").select("biller_name,amount_ngn").eq("id", (f as any).order_id).maybeSingle();
  return NextResponse.json({
    item: (o as any)?.biller_name ?? "your order",
    amount: Number((o as any)?.amount_ngn ?? 0),
    answered: !!(f as any).responded_at,
    reasons: REASONS,
  });
}

export async function POST(req: Request) {
  if (!(await rateLimit(req, "feedback", 20, 10)).ok) return NextResponse.json({ error: "Too many tries. Please wait a few minutes." }, { status: 429 });
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Bad request" }, { status: 400 }); }
  const token = String(body?.token ?? "");
  if (!UUID.test(token)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const db = supabaseAdmin();
  const { data: f } = await db.from("order_followups").select("order_id,email").eq("token", token).maybeSingle();
  if (!f) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (body?.stop === true) {
    await db.from("followup_optout").upsert({ email: String((f as any).email).toLowerCase() }, { onConflict: "email" });
    return NextResponse.json({ ok: true, stopped: true });
  }
  const reason = String(body?.reason ?? "");
  if (!REASONS.some((r) => r.key === reason)) return NextResponse.json({ error: "Choose one of the options." }, { status: 400 });
  const note = cap(body?.note, 1000) || null;
  await db.from("order_followups").update({ reason, note, responded_at: new Date().toISOString() }).eq("token", token);
  return NextResponse.json({ ok: true });
}
