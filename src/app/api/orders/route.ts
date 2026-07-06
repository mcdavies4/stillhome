import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { tryRecoverToken, expectsToken } from "@/lib/fulfilment";

// Order status lookup by id (the success page polls this).
// If the order is fulfilled but the electricity token hasn't landed yet,
// re-query FLW inline — the payer sees the token appear without waiting
// for any cron.
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const db = supabaseAdmin();
  const { data, error } = await db
    .from("orders")
    .select("id,status,biller_name,identifier,identifier_label,customer_name,email,recipient_whatsapp,amount_ngn,amount_gbp_pence,flw_token,flw_reference,created_at")
    .eq("id", id)
    .single();

  if (error || !data) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let flw_token = data.flw_token;
  if (data.status === "fulfilled" && !flw_token && expectsToken(data)) {
    flw_token = await tryRecoverToken(db, data);
  }

  const { email, recipient_whatsapp, flw_reference, ...safe } = data;
  return NextResponse.json({ ...safe, flw_token });
}
