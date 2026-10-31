import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { tryRecoverToken, expectsToken } from "@/lib/fulfilment";
import { UUID_RE } from "@/lib/security";
import { confirmFlutterwavePayment } from "@/lib/flwpay-process";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // a Flutterwave payment confirmed from here may run the vend

const lastFlwCheck = new Map<string, number>();

// Order status lookup by id (the success page polls this).
// If the order is fulfilled but the electricity token hasn't landed yet,
// re-query FLW inline — the payer sees the token appear without waiting
// for any cron.
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id || !UUID_RE.test(id)) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const db = supabaseAdmin();
  const SELECT =
    "id,status,biller_name,identifier,identifier_label,customer_name,email,recipient_whatsapp,amount_ngn,amount_gbp_pence,flw_token,flw_reference,created_at,country,currency,payment_provider,service_fee_local";
  let { data, error } = await db
    .from("orders")
    .select(SELECT)
    .eq("id", id)
    .single();

  if (error || !data) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Safety net for Flutterwave payments: if the customer is back but the webhook hasn't landed (or was
  // rejected), ask Flutterwave directly. Recent orders only, at most one check per order every 4 seconds.
  if (data.status === "pending_payment" && data.payment_provider === "flutterwave" && Date.now() - new Date(data.created_at).getTime() < 3 * 3600_000) {
    const last = lastFlwCheck.get(id) ?? 0;
    if (Date.now() - last > 4000) {
      lastFlwCheck.set(id, Date.now());
      if (lastFlwCheck.size > 500) lastFlwCheck.clear();
      try {
        await confirmFlutterwavePayment(id);
      } catch (e) {
        console.error("[orders] flutterwave confirm failed", (e as any)?.message ?? e);
      }
      const again = await db.from("orders").select(SELECT).eq("id", id).single();
      if (again.data) data = again.data;
    }
  }

  let flw_token = data.flw_token;
  if (data.status === "fulfilled" && !flw_token && expectsToken(data)) {
    flw_token = await tryRecoverToken(db, data);
  }

  const { email, recipient_whatsapp, flw_reference, ...safe } = data;
  return NextResponse.json({ ...safe, flw_token });
}
