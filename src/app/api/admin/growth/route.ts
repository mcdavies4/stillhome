import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { adminGate } from "@/lib/admin-auth";
import { MAX_STATUS_LEN, readStatus, resetStatusCache, writeStatus } from "@/lib/site-status";
import { referralsEnabled } from "@/lib/referral";

export const dynamic = "force-dynamic";

// Founder-only: the status line, plus a quick look at reminders and referrals.
export async function GET(req: Request) {
  const denied = await adminGate(req);
  if (denied) return denied;
  resetStatusCache();
  const db = supabaseAdmin();
  const since = new Date(Date.now() - 30 * 86400_000).toISOString();
  const [status, rem, opt, refs] = await Promise.all([
    readStatus(),
    db.from("reminder_log").select("order_id,email,identifier,sent_at").gte("sent_at", since).order("sent_at", { ascending: false }).limit(200),
    db.from("reminder_optout").select("email", { count: "exact", head: true }),
    db.from("referrals").select("id,referrer_email,referee_email,referee_waived_ngn,referrer_waived_ngn,created_at").order("created_at", { ascending: false }).limit(200),
  ]);
  const reminders = ((rem.data ?? []) as any[]);
  // Who came back and paid after a reminder.
  let back = 0;
  if (reminders.length) {
    const emails = Array.from(new Set(reminders.map((r) => String(r.email).toLowerCase())));
    const { data: later } = await db.from("orders").select("email,created_at,status").in("email", emails).eq("status", "fulfilled").gte("created_at", since);
    back = reminders.filter((r) => ((later ?? []) as any[]).some((l) => String(l.email).toLowerCase() === String(r.email).toLowerCase() && new Date(l.created_at) > new Date(r.sent_at))).length;
  }
  const referrals = ((refs.data ?? []) as any[]);
  const cost = referrals.reduce((s, r) => s + Number(r.referee_waived_ngn ?? 0) + Number(r.referrer_waived_ngn ?? 0), 0);
  return NextResponse.json({
    status: status ?? { level: "info", message: "" },
    maxLen: MAX_STATUS_LEN,
    reminders: { sent_30d: reminders.length, came_back: back, opted_out: opt.count ?? 0, tableReady: !rem.error },
    referrals: { enabled: referralsEnabled(), count: referrals.length, fees_waived_ngn: cost, tableReady: !refs.error, recent: referrals.slice(0, 20) },
  });
}

// Body: { level: "info" | "warn", message: "" } — an empty message clears the notice.
export async function POST(req: Request) {
  const denied = await adminGate(req);
  if (denied) return denied;
  let body: any; try { body = await req.json(); } catch { return NextResponse.json({ error: "Bad request" }, { status: 400 }); }
  try { return NextResponse.json({ ok: true, status: await writeStatus(body?.level, body?.message) }); }
  catch (e: any) { return NextResponse.json({ error: e?.message ?? "Failed", hint: "Has migration 0022_growth.sql been run?" }, { status: 500 }); }
}
