// POST /api/admin/orders/<id>
//   { action: "reveal" }                 -> { token }            show the token we hold for this order
//   { action: "resend", email?: string } -> { sent, email }      email the receipt + token again, optionally to a corrected address
// For the case where a customer missed the page, or typed the wrong email.
// Auth: Bearer <ADMIN_PASSWORD>. Every call is written to the logs (never the token itself).

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { adminGate } from "@/lib/admin-auth";
import { normaliseEmail, UUID_RE } from "@/lib/security";
import { sendNgnReceiptEmail } from "@/lib/receipt-ngn";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const denied = await adminGate(req);
  if (denied) return denied;

  const id = params.id;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "Bad order id" }, { status: 400 });
  const body = await req.json().catch(() => null);
  const action = body?.action;

  const db = supabaseAdmin();
  const { data: order } = await db.from("orders").select("*").eq("id", id).maybeSingle();
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });
  const token: string | null = order.flw_token ?? null;

  if (action === "reveal") {
    console.log(`[admin-audit] token revealed for order ${id} (${token ? "has token" : "no token"})`);
    return NextResponse.json({ token, status: order.status, email: order.email ?? null });
  }

  if (action === "resend") {
    if (order.status !== "fulfilled") {
      return NextResponse.json({ error: `This order is ${order.status}, not delivered. Nothing to resend.` }, { status: 409 });
    }
    if (order.payment_provider === "stripe") {
      return NextResponse.json({ error: "Pound-paid orders aren't supported by this button." }, { status: 400 });
    }
    let email: string | null = order.email ?? null;
    if (typeof body?.email === "string" && body.email.trim()) {
      const fixed = normaliseEmail(body.email);
      if (!fixed) return NextResponse.json({ error: "That email address doesn't look right." }, { status: 400 });
      if (fixed !== email) {
        await db.from("orders").update({ email: fixed }).eq("id", id);
        console.log(`[admin-audit] order ${id}: email changed from ${email ?? "none"} to ${fixed}`);
        email = fixed;
      }
    }
    if (!email) return NextResponse.json({ error: "This order has no email. Enter one to send to." }, { status: 400 });
    const sent = await sendNgnReceiptEmail({ ...order, email }, token);
    console.log(`[admin-audit] receipt resend for order ${id} to ${email}: ${sent ? "sent" : "FAILED"}`);
    return NextResponse.json({ sent, email });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
