import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { tryRecoverToken, expectsToken } from "@/lib/fulfilment";

// Daily backstop: recover tokens for fulfilled orders still missing one
// (last 72h). Vercel Cron calls this with Authorization: Bearer CRON_SECRET.
export async function GET(req: Request) {
  const auth = req.headers.get("authorization");
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = supabaseAdmin();
  const since = new Date(Date.now() - 72 * 3600 * 1000).toISOString();
  const { data: orders } = await db
    .from("orders")
    .select("*")
    .eq("status", "fulfilled")
    .is("flw_token", null)
    .gte("created_at", since)
    .limit(50);

  let recovered = 0;
  for (const order of orders ?? []) {
    if (!expectsToken(order)) continue;
    const token = await tryRecoverToken(db, order);
    if (token) recovered++;
  }

  // housekeeping: purge rate-limit rows older than 24h
  await db.from("request_log").delete().lt("created_at", new Date(Date.now() - 86400 * 1000).toISOString());

  return NextResponse.json({ checked: orders?.length ?? 0, recovered });
}
