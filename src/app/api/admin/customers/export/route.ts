// GET /api/admin/customers/export?scope=all|buyers&from=YYYY-MM-DD&to=YYYY-MM-DD
// Downloads a CSV of customers, one row per email address, built from the orders table.
// Columns: email, first_order, last_order, orders, fulfilled. No phone numbers, meter numbers or names are included.
// scope=all (default): every email that has ever placed an order (test orders excluded).
// scope=buyers: only emails with at least one fulfilled order.
// from / to (optional, inclusive, UTC dates): only count orders placed in that range.
// With scope=buyers and a range, this gives "people who bought in these days".
// Auth: the same admin password as the rest of /api/admin. The export is logged with its row count, never its contents.

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { adminGate } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const PAGE = 1000;
const TEST_EMAILS = new Set(["test@example.com"]);

// Stop spreadsheet apps from running a cell as a formula (CSV injection).
function cell(v: string | number): string {
  let s = String(v ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

type Row = { created_at: string; status: string; email: string | null; is_test?: boolean };

async function fetchAllOrders(): Promise<Row[]> {
  const db = supabaseAdmin();
  const out: Row[] = [];
  // Try with is_test (migration 0017). If the column isn't there yet, fall back to the plain query.
  let withTest = true;
  for (let from = 0; ; from += PAGE) {
    const cols = withTest ? "email,status,created_at,is_test" : "email,status,created_at";
    const { data, error } = await db.from("orders").select(cols as any).order("created_at", { ascending: true }).range(from, from + PAGE - 1);
    if (error && withTest && /is_test/.test(error.message ?? "")) { withTest = false; from -= PAGE; continue; }
    if (error) throw new Error("orders query failed");
    const rows = ((data ?? []) as unknown) as Row[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

export async function GET(req: Request) {
  const denied = await adminGate(req);
  if (denied) return denied;

  const params = new URL(req.url).searchParams;
  const scope = params.get("scope") === "buyers" ? "buyers" : "all";
  const from = params.get("from");
  const to = params.get("to");
  const dateOk = (d: string | null) => !d || /^\d{4}-\d{2}-\d{2}$/.test(d);
  if (!dateOk(from) || !dateOk(to)) {
    return NextResponse.json({ error: "Dates must be YYYY-MM-DD" }, { status: 400 });
  }

  let orders: Row[];
  try {
    orders = await fetchAllOrders();
  } catch {
    return NextResponse.json({ error: "Couldn't load customers" }, { status: 500 });
  }

  type Agg = { first: string; last: string; orders: number; fulfilled: number };
  const byEmail = new Map<string, Agg>();
  for (const o of orders) {
    if ((o as any).is_test) continue;
    const day = (o.created_at ?? "").slice(0, 10);
    if (from && day < from) continue;
    if (to && day > to) continue;
    const email = (o.email ?? "").trim().toLowerCase();
    if (!email || !email.includes("@") || TEST_EMAILS.has(email) || email.endsWith("@example.com")) continue;
    const a = byEmail.get(email) ?? { first: o.created_at, last: o.created_at, orders: 0, fulfilled: 0 };
    a.orders += 1;
    if (o.status === "fulfilled") a.fulfilled += 1;
    if (o.created_at < a.first) a.first = o.created_at;
    if (o.created_at > a.last) a.last = o.created_at;
    byEmail.set(email, a);
  }

  const rows = Array.from(byEmail.entries())
    .filter(([, a]) => scope === "all" || a.fulfilled > 0)
    .sort((x, y) => (x[1].last < y[1].last ? 1 : -1));

  const lines = ["email,first_order,last_order,orders,fulfilled"];
  for (const [email, a] of rows) {
    lines.push([cell(email), cell(a.first.slice(0, 10)), cell(a.last.slice(0, 10)), cell(a.orders), cell(a.fulfilled)].join(","));
  }
  const csv = "﻿" + lines.join("\n") + "\n";

  console.log(`[admin/customers/export] scope=${scope} from=${from ?? "-"} to=${to ?? "-"} rows=${rows.length}`);

  const day = new Date().toISOString().slice(0, 10);
  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="nolgic-customers-${scope}-${from ?? "all"}_${to ?? "today"}-${day}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
