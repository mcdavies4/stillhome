import { NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { supabaseAdmin } from "@/lib/supabase";
import { validateCustomer } from "@/lib/flutterwave";
import { quoteGbp, gbp, money } from "@/lib/fx";
import { getCountry, isSupportedCountry, DEFAULT_COUNTRY } from "@/lib/countries";
import { rateLimit } from "@/lib/ratelimit";
import { velocityCheck } from "@/lib/velocity";
import { alertFounder } from "@/lib/alerts";

// Creates the order row + Stripe Checkout session.
// Re-validates the identifier server-side where the biller supports it —
// airtime/data have no validation (the phone number IS the account).
export async function POST(req: Request) {
  const { ok } = await rateLimit(req, "checkout", 10, 10);
  if (!ok) return NextResponse.json({ error: "Too many attempts — please wait a few minutes." }, { status: 429 });

  const ip =
    (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() ||
    req.headers.get("x-real-ip") ||
    "unknown";

  try {
    const b = await req.json();
    // amountLocal replaces amountNgn; accept both for backward-compat with any cached client.
    const amountLocal = b.amountLocal ?? b.amountNgn;
    const required = ["email", "billerCode", "itemCode", "billerName", "identifier", "identifierLabel"];
    for (const k of required) {
      if (!b[k]) return NextResponse.json({ error: `Missing ${k}` }, { status: 400 });
    }
    if (!amountLocal) return NextResponse.json({ error: "Missing amount" }, { status: 400 });

    // Country: validate against supported list, default NG (existing behaviour).
    const countryCode = isSupportedCountry((b.country ?? "").toUpperCase())
      ? (b.country as string).toUpperCase()
      : DEFAULT_COUNTRY;
    const country = getCountry(countryCode);

    const identifier = String(b.identifier).trim();

    let v: { name: string | null } = { name: null };
    try {
      v = await validateCustomer(b.itemCode, b.billerCode, identifier);
    } catch (err) {
      // Airtime/data have no validation; only hard-fail for validatable billers
      const noValidate = /VTU|AIRTIME|DATA/i.test(`${b.billerName} ${b.itemCode}`);
      if (!noValidate) throw err;
    }

    const quote = quoteGbp(Number(amountLocal), countryCode);

    // Fraud velocity gate (cashout pattern / first-order cap)
    const vel = await velocityCheck({ email: b.email, ip, amountGbpPence: quote.totalPence });
    if (vel.blocked) {
      alertFounder(
        "Order blocked by velocity check",
        `Email: ${b.email}\nIP: ${ip}\nReason: ${vel.reason}\nAmount: £${(quote.totalPence/100).toFixed(2)} · ${b.billerName} · ${countryCode}`
      );
      return NextResponse.json(
        { error: "For your security this order needs review. Please contact nolgichq@gmail.com if you believe this is a mistake." },
        { status: 403 }
      );
    }

    const db = supabaseAdmin();
    const { data: order, error } = await db
      .from("orders")
      .insert({
        user_id: b.userId ?? null,
        email: b.email,
        ip,
        country: countryCode,
        currency: country.currency,
        biller_code: b.billerCode,
        item_code: b.itemCode,
        biller_name: b.billerName,
        identifier,
        identifier_label: b.identifierLabel,
        customer_name: v.name,
        recipient_whatsapp: b.recipientWhatsapp ?? null,
        amount_ngn: quote.amountLocal,          // legacy column name; now holds local-currency amount
        fx_ngn_per_gbp: quote.fxLocalPerGbp,    // legacy column name; now holds local-per-GBP rate
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
              name: `${b.billerName} — ${money(quote.amountLocal, countryCode)}`,
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
      payment_method_options: {
        card: {
          request_three_d_secure:
            quote.totalPence >= Number(process.env.THREEDS_MIN_PENCE ?? "5000") ? "any" : "automatic",
        },
      },
      success_url: `${appUrl}/order/${order.id}?paid=1`,
      cancel_url: `${appUrl}/?cancelled=1`,
    });

    await db.from("orders").update({ stripe_session_id: session.id }).eq("id", order.id);

    return NextResponse.json({ url: session.url, orderId: order.id, total: gbp(quote.totalPence) });
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? "Checkout failed" }, { status: 500 });
  }
}
