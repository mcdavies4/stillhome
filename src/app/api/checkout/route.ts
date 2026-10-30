import { NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { supabaseAdmin } from "@/lib/supabase";
import { validateCustomer, checkPurchase } from "@/lib/bills";
import { quoteGbp, gbp, money } from "@/lib/fx";
import { getCountry, isSupportedCountry, DEFAULT_COUNTRY } from "@/lib/countries";
import { rateLimit } from "@/lib/ratelimit";
import { velocityCheck } from "@/lib/velocity";
import { alertFounder } from "@/lib/alerts";
import { initializeTransaction, paystackConfigured } from "@/lib/paystack";
import { cap, normaliseEmail, normalisePhone } from "@/lib/security";
import { ngnServiceFee } from "@/lib/ngn-fee";

// Creates the order row + a payment session:
//   - default: Stripe Checkout in GBP (diaspora, any supported country)
//   - payIn:"ngn" (Nigeria only): Paystack hosted checkout in naira
//     (card / bank transfer / USSD). Fee = 2% of the amount, min ₦100, max ₦500 (see lib/ngn-fee.ts).
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
    const raw = await req.json().catch(() => null);
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }
    // Normalise + length-cap every client-supplied field once, up front.
    const email = normaliseEmail(raw.email);
    if (!email) return NextResponse.json({ error: "Please enter a valid email address." }, { status: 400 });
    let recipientWhatsapp: string | null = null;
    if (raw.recipientWhatsapp) {
      recipientWhatsapp = normalisePhone(raw.recipientWhatsapp);
      if (!recipientWhatsapp) {
        return NextResponse.json({ error: "That mobile number doesn't look right — use digits only, with country code if outside Nigeria." }, { status: 400 });
      }
    }
    const b = {
      email,
      billerCode: cap(raw.billerCode, 64),
      itemCode: cap(raw.itemCode, 64),
      billerName: cap(raw.billerName, 120),
      identifier: cap(raw.identifier, 64),
      identifierLabel: cap(raw.identifierLabel, 60),
      country: cap(raw.country, 2),
      payIn: cap(raw.payIn, 3),
      recipientWhatsapp,
      userId: null as string | null, // never trust a client-supplied user id
    };
    // amountLocal replaces amountNgn; accept both for backward-compat with any cached client.
    const amountLocal = raw.amountLocal ?? raw.amountNgn;
    for (const k of ["billerCode", "itemCode", "billerName", "identifier", "identifierLabel"] as const) {
      if (!b[k]) return NextResponse.json({ error: `Missing ${k}` }, { status: 400 });
    }
    if (!amountLocal || !Number.isFinite(Number(amountLocal)) || Number(amountLocal) <= 0) {
      return NextResponse.json({ error: "Missing amount" }, { status: 400 });
    }

    // Country: validate against supported list, default NG (existing behaviour).
    const countryCode = isSupportedCountry((b.country ?? "").toUpperCase())
      ? (b.country as string).toUpperCase()
      : DEFAULT_COUNTRY;
    const country = getCountry(countryCode);

    // ---- Launch gates ------------------------------------------------------
    // UK/£ (Stripe) and Ghana are built but switched off until funded/ready.
    // Open each with a Vercel env var; the code paths below stay intact.
    //   NEXT_PUBLIC_UK_PAY_ENABLED=1   allow pay-in-£ (Stripe)
    //   NEXT_PUBLIC_GH_ENABLED=1       allow Ghana
    if (countryCode === "GH" && process.env.NEXT_PUBLIC_GH_ENABLED !== "1") {
      return NextResponse.json({ error: "Ghana is coming soon." }, { status: 400 });
    }
    if (b.payIn !== "ngn" && process.env.NEXT_PUBLIC_UK_PAY_ENABLED !== "1") {
      return NextResponse.json({ error: "Payments in pounds are coming soon. For now, please pay in naira." }, { status: 400 });
    }

    const identifier = String(b.identifier).trim();

    // Provider rules checked server-side before any money moves (plan exists, fixed price, min/max).
    const purchase = await checkPurchase(b.billerCode, b.itemCode, Number(amountLocal));
    if (!purchase.ok) return NextResponse.json({ error: purchase.error }, { status: 400 });

    let v: { name: string | null } = { name: null };
    try {
      v = await validateCustomer(b.itemCode, b.billerCode, identifier);
    } catch (err) {
      // Airtime/data have no validation; only hard-fail for validatable billers
      const noValidate = /VTU|AIRTIME|DATA|BROADBAND|SURFLINE|POSTPAID PAYMENT/i.test(`${b.billerName} ${b.itemCode}`);
      if (!noValidate) throw err;
    }

    // ---- Naira path (Nigeria domestic, paid via Paystack) -----------------
    if (b.payIn === "ngn") {
      if (countryCode !== "NG") {
        return NextResponse.json({ error: "Naira payment is only available for Nigeria." }, { status: 400 });
      }
      if (!paystackConfigured()) {
        return NextResponse.json({ error: "Naira payments aren't available yet — please check back soon." }, { status: 503 });
      }
      const amountNgn = Math.round(Number(amountLocal));
      if (!Number.isFinite(amountNgn) || amountNgn < (country.minDomestic ?? country.minLocal) || amountNgn > country.maxLocal) {
        return NextResponse.json(
          { error: `Amount must be between ${money(country.minDomestic ?? country.minLocal, "NG")} and ${money(country.maxLocal, "NG")}` },
          { status: 400 }
        );
      }
      const feeNgn = ngnServiceFee(amountNgn);
      const totalNgn = amountNgn + feeNgn;

      // Velocity check works in pence; approximate with the NGN rate (reference only).
      const approxPence = Math.round((totalNgn / Number(process.env.NGN_PER_GBP ?? country.fxDefault)) * 100);
      const velN = await velocityCheck({ email: b.email, ip, amountGbpPence: approxPence });
      if (velN.blocked) {
        alertFounder(
          "Order blocked by velocity check",
          `Email: ${b.email}\nIP: ${ip}\nReason: ${velN.reason}\nAmount: ₦${totalNgn.toLocaleString()} · ${b.billerName} · NG (Paystack)`
        );
        return NextResponse.json(
          { error: "For your security this order needs review. Please contact nolgichq@gmail.com if you believe this is a mistake." },
          { status: 403 }
        );
      }

      const dbN = supabaseAdmin();
      const { data: orderN, error: errN } = await dbN
        .from("orders")
        .insert({
          user_id: b.userId ?? null,
          email: b.email,
          ip,
          country: "NG",
          currency: "NGN",
          payment_provider: "paystack",
          biller_code: b.billerCode,
          item_code: b.itemCode,
          biller_name: b.billerName,
          identifier,
          identifier_label: b.identifierLabel,
          customer_name: v.name,
          recipient_whatsapp: b.recipientWhatsapp ?? null,
          amount_ngn: amountNgn,
          service_fee_local: feeNgn,
          fx_ngn_per_gbp: Number(process.env.NGN_PER_GBP ?? country.fxDefault), // reference only
          service_fee_pence: 0,
          amount_gbp_pence: 0, // not a GBP order
          status: "pending_payment",
        })
        .select("id")
        .single();
      if (errN) throw errN;

      const appUrlN = process.env.NEXT_PUBLIC_APP_URL!;
      const init = await initializeTransaction({
        email: b.email,
        amountNgn: totalNgn,
        orderId: orderN.id,
        callbackUrl: `${appUrlN}/order/${orderN.id}?paid=1`,
      });
      await dbN.from("orders").update({ paystack_reference: init.reference }).eq("id", orderN.id);

      return NextResponse.json({ url: init.authorizationUrl, orderId: orderN.id, total: `₦${totalNgn.toLocaleString()}` });
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
    // Only pass through errors we raised on purpose (provider validation, amount range);
    // never leak database / Stripe / Paystack internals to the browser.
    console.error("[checkout] failed", e);
    const msg0 = String(e?.message ?? "");
    const safe =
      (e?.name === "FlwError" && !/^(Flutterwave|VTpass) /i.test(msg0)) ||
      e?.name === "PaystackError" ||
      /^Amount must be between/.test(msg0);
    return NextResponse.json({ error: safe ? e.message : "Checkout failed — please try again." }, { status: safe ? 400 : 500 });
  }
}
