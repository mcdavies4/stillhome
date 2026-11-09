import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { readSession } from "@/lib/account";
import { buildStatement, monthRange, statementCsv, statementPdf, STATEMENT_MAX_ROWS } from "@/lib/statement";

export const dynamic = "force-dynamic";

// A signed-in customer's statement for one month: ?month=2026-11&format=csv|pdf. Their own orders only (matched on the session email).
export async function GET(req: Request) {
  const email = readSession(req.headers.get("cookie"));
  if (!email) return NextResponse.json({ error: "Sign in to download a statement." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  const u = new URL(req.url);
  const month = u.searchParams.get("month") ?? "";
  const format = u.searchParams.get("format") === "pdf" ? "pdf" : "csv";
  const range = monthRange(month);
  if (!range) return NextResponse.json({ error: "Choose a month from the last two years." }, { status: 400 });

  const { data, error } = await supabaseAdmin().from("orders")
    .select("id,biller_name,identifier,customer_name,amount_ngn,service_fee_local,status,created_at,currency,is_test")
    .eq("email", email).gte("created_at", range.from).lt("created_at", range.to)
    .order("created_at", { ascending: true }).limit(STATEMENT_MAX_ROWS);
  if (error) { console.error("[statement] query failed", error.message); return NextResponse.json({ error: "Could not build the statement. Try again." }, { status: 500 }); }

  const s = buildStatement(email, month, range.label, (data ?? []) as any[]);
  const base = `nolgic-statement-${month}`;
  const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
  if (format === "pdf") {
    const bytes = await statementPdf(s);
    return new Response(bytes as unknown as BodyInit, { headers: { ...headers, "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${base}.pdf"` } });
  }
  return new Response(statementCsv(s), { headers: { ...headers, "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${base}.csv"` } });
}
