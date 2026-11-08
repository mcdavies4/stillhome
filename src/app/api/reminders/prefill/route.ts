import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { UUID_RE } from "@/lib/security";
import { rateLimit } from "@/lib/ratelimit";
import { kindOfOrder } from "@/lib/reminders";

export const dynamic = "force-dynamic";

// The "Top up now" button in a reminder email carries that email's private token. This hands back just enough of the
// customer's last order to fill the pay form: provider, plan, meter/smartcard number, amount and their email.
// It is read-only and moves no money; the account name is still checked and the customer still pays on the normal page.
export async function GET(req: Request) {
  const t = new URL(req.url).searchParams.get("t") ?? "";
  if (!UUID_RE.test(t)) return NextResponse.json({ error: "Bad link" }, { status: 400 });
  const rl = await rateLimit(req, "reminder-prefill", 30, 10);
  if (!rl.ok) return NextResponse.json({ error: "Too many tries. Please wait a few minutes." }, { status: 429 });

  const db = supabaseAdmin();
  const { data: log } = await db.from("reminder_log").select("order_id,email").eq("token", t).maybeSingle();
  if (!log) return NextResponse.json({ error: "This link is not valid." }, { status: 404 });
  const { data: o } = await db.from("orders")
    .select("email,identifier,biller_code,item_code,biller_name,amount_ngn")
    .eq("id", (log as any).order_id).maybeSingle();
  if (!o) return NextResponse.json({ error: "This link is not valid." }, { status: 404 });

  const kind = kindOfOrder(o as any);
  if (!kind) return NextResponse.json({ error: "This link is not valid." }, { status: 404 });
  const r = o as any;
  return NextResponse.json({
    tab: kind === "tv" ? "cable" : "electricity",
    billerCode: String(r.biller_code ?? ""),
    itemCode: String(r.item_code ?? ""),
    billerName: String(r.biller_name ?? ""),
    identifier: String(r.identifier ?? ""),
    amount: Math.round(Number(r.amount_ngn) || 0),
    email: String(r.email ?? (log as any).email ?? ""),
  }, { headers: { "Cache-Control": "no-store" } });
}
