import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { UUID_RE } from "@/lib/security";
import { rateLimit } from "@/lib/ratelimit";
import { buildReceiptPdf } from "@/lib/receipt-pdf";

export const dynamic = "force-dynamic";

// PDF receipt for a finished order. The order id is the key, the same as the order page.
// Only finished orders have a receipt; an order still being paid or delivered returns 409.
const DONE = ["fulfilled", "failed_refunded", "refunded"];

export async function GET(req: Request) {
  const { ok } = await rateLimit(req, "receipt", 30, 10);
  if (!ok) return NextResponse.json({ error: "Too many requests. Try again in a few minutes." }, { status: 429 });

  const id = new URL(req.url).searchParams.get("id");
  if (!id || !UUID_RE.test(id)) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const { data, error } = await supabaseAdmin()
    .from("orders")
    .select("id,status,biller_name,identifier,identifier_label,customer_name,amount_ngn,service_fee_local,flw_token,flw_reference,created_at")
    .eq("id", id)
    .single();
  if (error || !data) return NextResponse.json({ error: "Order not found" }, { status: 404 });
  if (!DONE.includes(data.status)) {
    return NextResponse.json({ error: "A receipt is available once the order is delivered or refunded." }, { status: 409 });
  }

  const pdf = await buildReceiptPdf(data as any);
  return new Response(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="nolgic-receipt-${id.slice(0, 8)}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
