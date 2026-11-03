// GET (list) / POST (add) / DELETE (?id=) expenses.
import { NextResponse } from "next/server";
import { adminGate } from "@/lib/admin-auth";
import { supabaseAdmin } from "@/lib/supabase";
import { EXPENSE_CATEGORIES, fetchExpenses, logAudit, periodFrom, validYmd } from "@/lib/finance";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const denied = await adminGate(req);
  if (denied) return denied;
  const { from, to } = periodFrom(new URL(req.url));
  return NextResponse.json(await fetchExpenses(from, to));
}

export async function POST(req: Request) {
  const denied = await adminGate(req);
  if (denied) return denied;
  let b: any;
  try { b = await req.json(); } catch { return NextResponse.json({ error: "Bad request" }, { status: 400 }); }
  const amount = Math.round(Number(b?.amount_ngn) * 100) / 100;
  const vat = Math.round(Number(b?.vat_ngn ?? 0) * 100) / 100;
  const text = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
  if (!validYmd(b?.spent_on)) return NextResponse.json({ error: "Choose the date you paid." }, { status: 400 });
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1e10) return NextResponse.json({ error: "Enter the amount you paid." }, { status: 400 });
  if (!Number.isFinite(vat) || vat < 0 || vat > amount) return NextResponse.json({ error: "VAT can't be more than the amount paid." }, { status: 400 });
  const category = EXPENSE_CATEGORIES.includes(b?.category) ? b.category : "Other";
  const row = { spent_on: b.spent_on, category, vendor: text(b?.vendor, 120), description: text(b?.description, 240), amount_ngn: amount, vat_ngn: vat, receipt_ref: text(b?.receipt_ref, 80) };
  const { data, error } = await supabaseAdmin().from("expenses").insert(row).select("id").single();
  if (error || !data) return NextResponse.json({ error: "Couldn't save. Has migration 0020 been run in Supabase?" }, { status: 500 });
  await logAudit(req, "expense.add", data.id, row);
  return NextResponse.json({ ok: true, id: data.id });
}

export async function DELETE(req: Request) {
  const denied = await adminGate(req);
  if (denied) return denied;
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Bad id" }, { status: 400 });
  const db = supabaseAdmin();
  const { data } = await db.from("expenses").select("*").eq("id", id).maybeSingle();
  const { error } = await db.from("expenses").delete().eq("id", id);
  if (error) return NextResponse.json({ error: "Couldn't delete." }, { status: 500 });
  await logAudit(req, "expense.delete", id, data ?? null); // the deleted row is kept in the audit log
  return NextResponse.json({ ok: true });
}
