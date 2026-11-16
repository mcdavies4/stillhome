// POST /api/flutterwave/transfer-account  { orderId }
// Gives the customer a temporary bank account for an existing pending Flutterwave naira order.
// Only works for pending_payment orders on the Flutterwave rail. The amount is the order's full total
// (bill + service fee). The payment is confirmed by /api/flutterwave/webhook as for card payments.

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { createTransferAccount, flwPayConfigured } from "@/lib/flwpay";
import { UUID_RE } from "@/lib/security";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(req: Request) {
  if (!flwPayConfigured()) return NextResponse.json({ error: "Bank transfer isn't available yet. Please check back soon." }, { status: 503 });

  const body = await req.json().catch(() => null) as null | { orderId?: string };
  const orderId = String(body?.orderId ?? "");
  if (!UUID_RE.test(orderId)) return NextResponse.json({ error: "Invalid order" }, { status: 400 });

  const { data: order } = await supabaseAdmin()
    .from("orders")
    .select("id,email,status,payment_provider,amount_ngn,service_fee_local,currency")
    .eq("id", orderId)
    .maybeSingle();

  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });
  if (order.payment_provider !== "flutterwave" || (order.currency ?? "NGN").toUpperCase() !== "NGN") {
    return NextResponse.json({ error: "This order can't be paid by transfer." }, { status: 400 });
  }
  if (order.status !== "pending_payment") {
    return NextResponse.json({ error: "This order is no longer waiting for payment." }, { status: 409 });
  }
  if (!order.email) return NextResponse.json({ error: "This order has no email address." }, { status: 400 });

  const amountNgn = Number(order.amount_ngn) + Number(order.service_fee_local ?? 0);

  try {
    const acct = await createTransferAccount({ orderId: order.id, email: order.email, amountNgn });
    console.log(`[flw-transfer] account issued for order ${order.id} amount=${amountNgn}`);
    return NextResponse.json({
      accountNumber: acct.accountNumber,
      bankName: acct.bankName,
      amountNgn,
      expiresAt: acct.expiresAt,
      reference: acct.reference,
    });
  } catch (e) {
    console.error("[flw-transfer] could not issue account", (e as Error)?.message ?? e);
    return NextResponse.json({ error: "Couldn't create a bank account just now. Please try again." }, { status: 502 });
  }
}
