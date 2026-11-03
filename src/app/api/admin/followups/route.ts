import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { adminGate } from "@/lib/admin-auth";
import { reasonLabel } from "@/lib/followup";

export const dynamic = "force-dynamic";

// Founder-only: who was followed up, what they said, and who came back and paid afterwards.
export async function GET(req: Request) {
  const denied = await adminGate(req);
  if (denied) return denied;
  const db = supabaseAdmin();
  const since = new Date(Date.now() - 90 * 86400_000).toISOString();
  const { data: f, error } = await db.from("order_followups").select("order_id,email,sent_at,reason,note,responded_at").gte("sent_at", since).order("sent_at", { ascending: false }).limit(500);
  if (error) return NextResponse.json({ error: error.message, hint: "Has migration 0021_followups.sql been run?" }, { status: 500 });
  const rows = (f ?? []) as any[];
  const ids = rows.map((r) => r.order_id);
  const emails = Array.from(new Set(rows.map((r) => String(r.email).toLowerCase())));
  const [{ data: ords }, { data: later }] = await Promise.all([
    ids.length ? db.from("orders").select("id,biller_name,amount_ngn,created_at,status").in("id", ids) : Promise.resolve({ data: [] as any[] }),
    emails.length ? db.from("orders").select("email,created_at,status,amount_ngn").in("email", emails).eq("status", "fulfilled").gte("created_at", since) : Promise.resolve({ data: [] as any[] }),
  ]);
  const byId = new Map(((ords ?? []) as any[]).map((o) => [o.id, o]));
  const items = rows.map((r) => {
    const o = byId.get(r.order_id);
    const back = ((later ?? []) as any[]).some((l) => String(l.email).toLowerCase() === String(r.email).toLowerCase() && new Date(l.created_at) > new Date(r.sent_at));
    return {
      order_id: r.order_id, email: r.email, sent_at: r.sent_at, item: o?.biller_name ?? "", amount: Number(o?.amount_ngn ?? 0),
      reason: r.reason, reason_label: reasonLabel(r.reason), note: r.note, responded_at: r.responded_at, came_back: back,
    };
  });
  const answered = items.filter((i) => i.reason);
  const counts: Record<string, number> = {};
  for (const i of answered) counts[i.reason_label] = (counts[i.reason_label] ?? 0) + 1;
  const { count: optouts } = await db.from("followup_optout").select("email", { count: "exact", head: true });
  return NextResponse.json({
    summary: {
      sent: items.length, answered: answered.length, came_back: items.filter((i) => i.came_back).length, opted_out: optouts ?? 0,
      reasons: Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([reason, n]) => ({ reason, n })),
    },
    items,
  });
}
