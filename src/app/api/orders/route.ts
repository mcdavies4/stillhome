import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { tryRecoverToken, expectsToken } from "@/lib/fulfilment";
import { UUID_RE } from "@/lib/security";
import { confirmFlutterwavePayment } from "@/lib/flwpay-process";
import { confirmPaystackPayment } from "@/lib/paystack-process";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // a payment confirmed from here (Flutterwave or Paystack) may run the vend

const lastPayCheck = new Map<string, number>();

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

  // Safety net for naira payments: if the customer is back but the webhook hasn't landed (or was rejected),
  // ask the payment provider directly. Recent orders only, at most one check per order every 4 seconds.
  const viaFlw = data.payment_provider === "flutterwave", viaPs = data.payment_provider === "paystack";
  const lapsed = data.status === "expired" && viaPs; // a Paystack payment can still land after we marked it expired
  if ((data.status === "pending_payment" || lapsed) && (viaFlw || viaPs) && Date.now() - new Date(data.created_at).getTime() < 3 * 3600_000) {
    const last = lastPayCheck.get(id) ?? 0;
    if (Date.now() - last > 4000) {
      lastPayCheck.set(id, Date.now());
      if (lastPayCheck.size > 500) lastPayCheck.clear();
      try {
        await (viaFlw ? confirmFlutterwavePayment(id) : confirmPaystackPayment(id));
      } catch (e) {
        console.error(`[orders] ${data.payment_provider} confirm failed`, (e as any)?.message ?? e);
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
