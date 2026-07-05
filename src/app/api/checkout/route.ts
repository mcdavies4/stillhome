import { NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { supabaseAdmin } from "@/lib/supabase";
import { validateCustomer } from "@/lib/flutterwave";
import { quoteGbp, gbp, ngn } from "@/lib/fx";

// Creates the order row + Stripe Checkout session.
// Re-validates the identifier server-side — never trust the client's
// earlier validate call.
export async function POST(req: Request) {
  try {
    const b = await req.json();
    const required = ["email", "billerCode", "itemCode", "billerName", "identifier", "identifierLabel", "amountNgn"];
    for (const k of required) {
      if (!b[k]) return NextResponse.json({ error: `Missing ${k}` }, { status: 400 });
    }

    const identifier = String(b.identifier).trim();
    const v = await validateCustomer(b.itemCode, b.billerCode, identifier);
    const quote = quoteGbp(Number(b.amountNgn));

    const db = supabaseAdmin();
    const { data: order, error } = await db
      .from("orders")
      .insert({
        user_id: b.userId ?? null,
        email: b.email,
        biller_code: b.billerCode,
        item_code: b.itemCode,
        biller_name: b.billerName,
        identifier,
        identifier_label: b.identifierLabel,
        customer_name: v.name,
        recipient_whatsapp: b.recipientWhatsapp ?? null,
        amount_ngn: quote.amountNgn,
        fx_ngn_per_gbp: quote.ngnPerGbp,
        service_fee_pence: quote.serviceFeePence,
        amount_gbp_pence: quote.totalPence,
        status: "pending_payment",
      })
      .select("id")
      .single();
    if (error) throw error;

    const appUrl = process.env.NEXT_PUBLIC_APP_URL!;
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_email: b.email,
      line_items: [
        {
          price_data: {
            currency: "gbp",
            unit_amount: quote.subtotalPence,
            product_data: {
              name: `${b.billerName} — ${ngn(quote.amountNgn)}`,
              description: v.name
                ? `${b.identifierLabel}: ${identifier} · ${v.name}`
                : `${b.identifierLabel}: ${identifier}`,
            },
          },
          quantity: 1,
        },
        {
          price_data: {
            currency: "gbp",
            unit_amount: quote.serviceFeePence,
            product_data: { name: "Service fee" },
          },
          quantity: 1,
        },
      ],
      metadata: { order_id: order.id },
      success_url: `${appUrl}/order/${order.id}?paid=1`,
      cancel_url: `${appUrl}/?cancelled=1`,
    });

    await db.from("orders").update({ stripe_session_id: session.id }).eq("id", order.id);

    return NextResponse.json({ url: session.url, orderId: order.id, total: gbp(quote.totalPence) });
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? "Checkout failed" }, { status: 500 });
  }
}
