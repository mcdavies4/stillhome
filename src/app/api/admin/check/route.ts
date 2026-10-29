// POST /api/admin/check   body: { orderId, apply?: boolean }
// Re-checks an order against Flutterwave (and Paystack for naira orders).
// Read-only unless apply=true — and apply only ever moves an order FORWARD to
// "fulfilled", and only when Flutterwave itself confirms the vend succeeded.
// It never refunds and never vends. Refunds stay a deliberate manual step.
// Auth: Bearer <ADMIN_PASSWORD>.

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { adminGate } from "@/lib/admin-auth";
import { getBillStatus } from "@/lib/flutterwave";
import { verifyTransaction, paystackConfigured } from "@/lib/paystack";
import { UUID_RE } from "@/lib/security";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(req: Request) {
  const denied = await adminGate(req);
  if (denied) return denied;

  const body = await req.json().catch(() => null);
  const orderId = body?.orderId;
  const apply = body?.apply === true;
  if (typeof orderId !== "string" || !UUID_RE.test(orderId)) {
    return NextResponse.json({ error: "orderId required" }, { status: 400 });
  }

  const db = supabaseAdmin();
  const { data: order } = await db.from("orders").select("*").eq("id", orderId).maybeSingle();
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });

  // --- Flutterwave: did the vend happen? ---
  const reference = order.flw_reference ?? `NOLGIC-${order.id}`;
  let flw: { found: boolean; status: string | null; token: string | null; error?: string } = {
    found: false, status: null, token: null,
  };
  try {
    const r = await getBillStatus(reference);
    const d = (r.data ?? {}) as any;
    flw = { found: true, status: String(d.status ?? "").toLowerCase() || null, token: d.extra ?? d.token ?? null };
  } catch (e: any) {
    flw = { found: false, status: null, token: null, error: String(e?.message ?? e).slice(0, 160) };
  }
  const flwSuccess = flw.found && !!flw.status && (flw.status.includes("success") || flw.status.includes("completed"));

  // --- Paystack: was the money actually received? ---
  let paystack: { checked: boolean; status?: string; amountNgn?: number; error?: string } = { checked: false };
  if (order.payment_provider === "paystack" && order.paystack_reference && paystackConfigured()) {
    try {
      const v = await verifyTransaction(order.paystack_reference);
      paystack = { checked: true, status: v.status, amountNgn: v.amountKobo / 100 };
    } catch (e: any) {
      paystack = { checked: true, error: String(e?.message ?? e).slice(0, 160) };
    }
  }

  // --- Suggested next step (advice only) ---
  let advice = "Nothing to do.";
  if (order.status === "fulfilled") advice = flwSuccess ? "Delivered and confirmed by Flutterwave." : "Marked fulfilled here but Flutterwave does not confirm it. Investigate.";
  else if (flwSuccess) advice = "Flutterwave says the vend SUCCEEDED. Use “Mark delivered” — do NOT refund.";
  else if (flw.found) advice = `Flutterwave status is “${flw.status}”. If it is a definite failure and the customer paid, refund them in the ${order.payment_provider === "paystack" ? "Paystack" : "Stripe"} dashboard, then note it.`;
  else if (["needs_review", "paid", "refund_failed"].includes(order.status)) advice = "Flutterwave has no record of this vend. If the customer paid, refund them manually, then note it.";

  let applied = false;
  if (apply) {
    if (!flwSuccess) {
      return NextResponse.json({ error: "Flutterwave does not confirm success — refusing to mark delivered.", flw, paystack }, { status: 409 });
    }
    if (!["paid", "needs_review", "fulfilled"].includes(order.status)) {
      return NextResponse.json({ error: `Order is ${order.status}; only paid / needs_review orders can be marked delivered.`, flw, paystack }, { status: 409 });
    }
    const patch: Record<string, unknown> = { status: "fulfilled", error: null };
    if (flw.token && !order.flw_token) patch.flw_token = flw.token;
    const { error } = await db.from("orders").update(patch).eq("id", order.id).in("status", ["paid", "needs_review", "fulfilled"]);
    if (error) return NextResponse.json({ error: "Update failed" }, { status: 500 });
    applied = true;
  }

  return NextResponse.json({
    order: { id: order.id, status: applied ? "fulfilled" : order.status },
    reference,
    flutterwave: { found: flw.found, status: flw.status, token_available: !!flw.token, error: flw.error ?? null },
    paystack,
    advice,
    applied,
  });
}
