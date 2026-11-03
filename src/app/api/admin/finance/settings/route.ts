// GET / POST /api/admin/finance/settings — the commission rates, processor-fee estimate, VAT position and company details the reports use.
import { NextResponse } from "next/server";
import { adminGate } from "@/lib/admin-auth";
import { supabaseAdmin } from "@/lib/supabase";
import { loadSettings, logAudit, mergeSettings } from "@/lib/finance";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const denied = await adminGate(req);
  if (denied) return denied;
  return NextResponse.json(await loadSettings());
}

export async function POST(req: Request) {
  const denied = await adminGate(req);
  if (denied) return denied;
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Bad request" }, { status: 400 }); }
  const next = mergeSettings(body); // anything invalid falls back to the default, so a typo can't poison the reports
  const before = await loadSettings();
  const { error } = await supabaseAdmin().from("finance_settings").upsert({ key: "main", value: next, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) return NextResponse.json({ error: "Couldn't save. Has migration 0020 been run in Supabase?" }, { status: 500 });
  await logAudit(req, "settings", "finance_settings", { before: before.settings, after: next });
  return NextResponse.json({ settings: next, saved: true });
}
