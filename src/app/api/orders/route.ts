import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

// Order status lookup by id (used by the success page to poll fulfilment).
// Returns only safe fields — no PII beyond what the payer already entered.
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const db = supabaseAdmin();
  const { data, error } = await db
    .from("orders")
    .select("id,status,biller_name,identifier,identifier_label,customer_name,amount_ngn,amount_gbp_pence,flw_token,created_at")
    .eq("id", id)
    .single();

  if (error || !data) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(data);
}
