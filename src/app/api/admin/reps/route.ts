import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { adminGate } from "@/lib/admin-auth";
import { REP_RE, repReport } from "@/lib/rep";

export const dynamic = "force-dynamic";

const appUrl = (req: Request) => process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin;

// Founder-only: each sales rep's visits, orders, new customers, money brought in. Nothing is owed or paid from here.
export async function GET(req: Request) {
  const denied = await adminGate(req);
  if (denied) return denied;
  const days = Number(new URL(req.url).searchParams.get("days") ?? 30);
  return NextResponse.json(await repReport(days, appUrl(req)), { headers: { "Cache-Control": "no-store" } });
}

// Add a rep, or change their name, note, or switch them off. A switched-off rep's link stops tagging new orders.
export async function POST(req: Request) {
  const denied = await adminGate(req);
  if (denied) return denied;
  let b: any; try { b = await req.json(); } catch { return NextResponse.json({ error: "Bad request" }, { status: 400 }); }
  const code = String(b?.code ?? "").trim().toLowerCase();
  if (!REP_RE.test(code)) return NextResponse.json({ error: "Code must be 3 to 20 letters or numbers, no spaces." }, { status: 400 });
  const name = String(b?.name ?? "").trim().slice(0, 60);
  const db = supabaseAdmin();
  const { data: existing, error: readErr } = await db.from("reps").select("code").eq("code", code).maybeSingle();
  if (readErr) return NextResponse.json({ error: "The reps table is missing.", hint: "Run supabase/migrations/0026_reps.sql in Supabase first." }, { status: 500 });
  if (!existing && !name) return NextResponse.json({ error: "Give the rep a name." }, { status: 400 });
  const row: Record<string, unknown> = { code };
  if (name) row.name = name;
  if (typeof b?.active === "boolean") row.active = b.active;
  if (typeof b?.note === "string") row.note = b.note.slice(0, 200) || null;
  const { error } = existing ? await db.from("reps").update(row).eq("code", code) : await db.from("reps").insert(row);
  if (error) return NextResponse.json({ error: "Could not save.", hint: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
