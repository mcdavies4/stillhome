// GET /api/admin/orders?status=&q=&before=&limit=
// Searchable, filterable order list for the dashboard (read-only).
// Auth: Bearer <ADMIN_PASSWORD>.

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { adminGate } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

const STATUSES = ["pending_payment", "paid", "fulfilled", "failed_refunded", "refund_failed", "needs_review", "expired"];

export async function GET(req: Request) {
  const denied = await adminGate(req);
  if (denied) return denied;

  const url = new URL(req.url);
  const status = url.searchParams.get("status") ?? "";
  const before = url.searchParams.get("before") ?? "";
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? "50") || 50, 1), 100);
  // Search text goes into a PostgREST filter string: allow only a safe alphabet so
  // commas / parentheses / dots can't inject extra filter clauses.
  const q = (url.searchParams.get("q") ?? "").replace(/[^A-Za-z0-9@._+\- ]/g, "").trim().slice(0, 60);

  let query = supabaseAdmin()
    .from("orders")
    .select(
      "id,email,status,biller_name,identifier,identifier_label,customer_name,amount_ngn,amount_gbp_pence,service_fee_local,payment_provider,currency,country,error,flw_reference,flw_token,paystack_reference,source,created_at"
    )
    .order("created_at", { ascending: false })
    .limit(limit + 1);

  if (STATUSES.includes(status)) query = query.eq("status", status);
  if (before && !Number.isNaN(Date.parse(before))) query = query.lt("created_at", before);
  // Order number from the order page or the email (first 6-8 characters of the order id, "NLG-" prefix allowed).
  const orderNo = q.replace(/^nlg-/i, "").toLowerCase();
  if (/^[0-9a-f]{6,8}$/.test(orderNo)) {
    const fill = (c: string) => { const h = orderNo.padEnd(32, c); return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`; };
    query = query.gte("id", fill("0")).lte("id", fill("f"));
  } else if (q) {
    const like = `%${q.replace(/ /g, "%")}%`;
    query = query.or(`email.ilike.${like},identifier.ilike.${like},biller_name.ilike.${like},customer_name.ilike.${like}`);
  }

  const { data, error } = await query;
  if (error) {
    console.error("[admin/orders]", error);
    return NextResponse.json({ error: "Failed to load orders" }, { status: 500 });
  }
  const rows = data ?? [];
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit).map((o: any) => ({
    ...o,
    // Show that a token exists without putting it in list payloads.
    has_token: !!o.flw_token,
    flw_token: undefined,
  }));
  return NextResponse.json({
    orders: page,
    next_before: hasMore ? page[page.length - 1].created_at : null,
  });
}
