// Sales reps: who brought which orders, and what each rep is owed. Reads and writes beside the payment path only:
// tagging an order is best-effort and can never stop a payment.
import { supabaseAdmin } from "@/lib/supabase";
import { REP_RE, cleanRepCode } from "@/lib/rep-client";

export { REP_RE, cleanRepCode };
export const cleanRep = cleanRepCode;

/** Put a rep's code on an order, only if that rep exists and is active. Never throws, never blocks payment. */
export async function tagRep(orderId: string, rep: string | null | undefined): Promise<boolean> {
  const code = cleanRepCode(rep);
  if (!code || !orderId) return false;
  try {
    const db = supabaseAdmin();
    const { data: r } = await db.from("reps").select("code").eq("code", code).eq("active", true).maybeSingle();
    if (!r) return false;
    const { error } = await db.from("orders").update({ rep: code }).eq("id", orderId).is("rep", null);
    if (error) { console.error("[rep] tag failed (has migration 0026_reps.sql been run?)", error.message); return false; }
    return true;
  } catch (e: any) {
    console.error("[rep] tag failed", e?.message ?? e);
    return false;
  }
}

export const maskEmail = (e: string): string => {
  const [u = "", d = ""] = String(e).split("@");
  return `${u.slice(0, 2)}${"•".repeat(Math.max(1, Math.min(4, u.length - 2)))}@${d}`;
};

export type RepRow = {
  code: string; name: string; active: boolean; commission_ngn: number; note: string | null; link: string;
  visits: number; lookups: number; checkoutClicks: number;
  orders: number; delivered: number; customers: number; newCustomers: number; deliveredNgn: number; owedNgn: number;
  recent: { id: string; email: string; status: string; amount_ngn: number; created_at: string; isNew: boolean }[];
};

const DELIVERED = "fulfilled";

type OrderRow = { id: string; email: string; status: string; amount_ngn: number | string; created_at: string; rep: string | null; is_test?: boolean | null };

/** Pure maths for one rep's numbers, so it can be tested without a database. */
export function repNumbers(orders: OrderRow[], firstDeliveredAt: Map<string, string>, commissionNgn: number) {
  const real = orders.filter((o) => !o.is_test);
  const delivered = real.filter((o) => o.status === DELIVERED);
  const customers = new Set(delivered.map((o) => o.email.toLowerCase()));
  // A NEW customer: this rep's delivered order is the very first delivered order that email ever had, anywhere.
  const isNew = (o: OrderRow) => o.status === DELIVERED && firstDeliveredAt.get(o.email.toLowerCase()) === o.created_at;
  const newEmails = new Set(delivered.filter(isNew).map((o) => o.email.toLowerCase()));
  return {
    orders: real.length,
    delivered: delivered.length,
    customers: customers.size,
    newCustomers: newEmails.size,
    deliveredNgn: Math.round(delivered.reduce((s, o) => s + Number(o.amount_ngn || 0), 0)),
    owedNgn: newEmails.size * Math.max(0, Math.round(commissionNgn || 0)),
    isNew,
  };
}

export async function repReport(days: number, appUrl: string): Promise<{ days: number; reps: RepRow[]; tableReady: boolean }> {
  const db = supabaseAdmin();
  const d = Math.min(365, Math.max(1, Math.floor(days) || 30));
  const since = new Date(Date.now() - d * 86400_000).toISOString();
  const { data: reps, error } = await db.from("reps").select("code,name,active,commission_ngn,note").order("created_at", { ascending: true });
  if (error) return { days: d, reps: [], tableReady: false };
  const list = (reps ?? []) as any[];
  if (!list.length) return { days: d, reps: [], tableReady: true };
  const codes = list.map((r) => r.code);

  const [{ data: ords }, { data: ev }] = await Promise.all([
    db.from("orders").select("id,email,status,amount_ngn,created_at,rep,is_test").in("rep", codes).gte("created_at", since).order("created_at", { ascending: false }).limit(5000),
    db.from("site_events").select("kind,name,campaign,vid,created_at").eq("src", "rep").in("campaign", codes).gte("created_at", since).limit(20000),
  ]);
  const orders = (ords ?? []) as OrderRow[];

  // When did each of these customers first get something delivered (from anyone)? Decides who is "new".
  const emails = Array.from(new Set(orders.filter((o) => o.status === DELIVERED).map((o) => o.email.toLowerCase())));
  const first = new Map<string, string>();
  for (let i = 0; i < emails.length; i += 200) {
    const { data: all } = await db.from("orders").select("email,created_at").in("email", emails.slice(i, i + 200)).eq("status", DELIVERED).order("created_at", { ascending: true }).limit(5000);
    for (const r of (all ?? []) as any[]) { const k = String(r.email).toLowerCase(); if (!first.has(k)) first.set(k, r.created_at); }
  }

  const out: RepRow[] = list.map((r) => {
    const mine = orders.filter((o) => o.rep === r.code);
    const n = repNumbers(mine, first, r.commission_ngn);
    const e = ((ev ?? []) as any[]).filter((x) => x.campaign === r.code);
    // Visitors are counted as one anonymous daily id per day, so this is "visits", not people.
    const visits = new Set(e.filter((x) => x.kind === "view").map((x) => `${x.vid}|${String(x.created_at).slice(0, 10)}`)).size;
    return {
      code: r.code, name: r.name, active: !!r.active, commission_ngn: Number(r.commission_ngn) || 0, note: r.note ?? null,
      link: `${appUrl.replace(/\/$/, "")}/?rep=${r.code}`,
      visits,
      lookups: e.filter((x) => x.kind === "event" && x.name === "lookup_ok").length,
      checkoutClicks: e.filter((x) => x.kind === "event" && x.name === "checkout_click").length,
      orders: n.orders, delivered: n.delivered, customers: n.customers, newCustomers: n.newCustomers, deliveredNgn: n.deliveredNgn, owedNgn: n.owedNgn,
      recent: mine.filter((o) => !o.is_test).slice(0, 15).map((o) => ({ id: o.id, email: maskEmail(o.email), status: o.status, amount_ngn: Math.round(Number(o.amount_ngn) || 0), created_at: o.created_at, isNew: n.isNew(o) })),
    };
  });
  return { days: d, reps: out, tableReady: true };
}
