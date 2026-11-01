export const metadata = { title: "Terms, Refunds & Privacy — Nolgic" };

const h2 = "font-display font-bold text-xl mb-3";
const p = "text-haze mb-8";

// The operating company. Add its CAC registration number in Vercel as NEXT_PUBLIC_COMPANY_RC (for example "RC 1234567") and it appears here.
const COMPANY = "The 36th Solutions Ltd";
const COMPANY_RC = (process.env.NEXT_PUBLIC_COMPANY_RC ?? "").trim();
const COMPANY_LINE = `${COMPANY}, a company registered in Nigeria${COMPANY_RC ? ` (${COMPANY_RC})` : ""}`;

export default function Legal() {
  return (
    <main id="content" className="max-w-xl mx-auto px-5 py-16 leading-relaxed">
      <h1 className="font-display font-extrabold text-3xl mb-2">Terms, Refunds &amp; Privacy</h1>
      <p className="text-haze text-sm mb-10">
        These terms cover the Nolgic website (nolgic.com) and the Nolgic mobile app. Nolgic is built for Nigeria and is
        operated by {COMPANY_LINE}. Last updated November 2026.
      </p>

      <h2 className={h2}>What Nolgic is</h2>
      <p className={p}>
        Nolgic sells prepaid digital products: electricity tokens, TV subscriptions, mobile airtime and data for
        Nigerian service providers. When you pay, you are buying a product from us at the naira price shown at
        checkout. Nolgic is not a money transfer or remittance service and does not send, hold or convert money on
        your behalf. You must be 18 or over to use Nolgic.
      </p>

      <h2 className={h2}>Your responsibility: the account details</h2>
      <p className={p}>
        Before you pay, we look up and show you the account holder&rsquo;s name for the meter or smartcard number you
        entered, where the provider supports it. For airtime and data, no lookup exists. The phone number you enter is
        where the top-up will be delivered, so please check it carefully. Once a token, subscription or top-up has been
        delivered to the number you confirmed, it cannot be reversed, transferred to a different meter, account or
        phone number, or refunded. This is a restriction set by the Nigerian service providers themselves.
      </p>

      <h2 className={h2}>Refund policy</h2>
      <p className={p}>
        If delivery fails for any reason, we refund you in full to the card or account you paid with, automatically.
        Banks can take a few working days to show the refund on your statement. If delivery succeeds to the account
        details you confirmed at checkout, the purchase is final. If you believe a payment was delivered incorrectly
        despite showing the correct account name, contact us within 48 hours at the support address below and we will
        investigate with the provider. If a payment is slow to confirm, we check it ourselves and either deliver it or
        refund you.
      </p>

      <h2 className={h2}>Pricing</h2>
      <p className={p}>
        The total price is shown before you pay. It is the amount you are buying plus a small service fee, and the fee
        is listed on its own line. Prices and the fee may change at any time; the price you see at checkout is the
        price you pay.
      </p>

      <h2 className={h2}>Payments</h2>
      <p className={p}>
        All payments are in naira, taken by Paystack or Flutterwave, by card, bank transfer or USSD. Your card and bank
        details are entered on the payment processor&rsquo;s own page and never reach Nolgic&rsquo;s servers.
      </p>

      <h2 className={h2}>Privacy: what we collect and why</h2>
      <p className="text-haze mb-3">We collect only what the service needs:</p>
      <ul className="text-haze mb-8 list-disc pl-5 space-y-1.5">
        <li>Your email address, to send your receipt and let you look up an order.</li>
        <li>The account details you enter (meter, smartcard or phone number), to look up the account holder and deliver your purchase.</li>
        <li>Order records: what you bought, the amount, the status and the token, so you can see your order and so we can handle refunds and disputes.</li>
      </ul>
      <p className={p}>
        We do not ask for your name, address, contacts, location, photos or files. We do not sell personal data, and we
        do not use it for advertising or tracking. The website and app have no advertising and no analytics SDKs.
      </p>

      <h2 className={h2}>Who we share data with</h2>
      <p className="text-haze mb-3">Only the services that help us deliver your purchase:</p>
      <ul className="text-haze mb-8 list-disc pl-5 space-y-1.5">
        <li>Paystack or Flutterwave, to take payment and make refunds.</li>
        <li>Our bill-payment provider (currently Paybeta), to look up the account and deliver the token or top-up. They receive the account number, the amount and, for airtime and data, the phone number.</li>
        <li>Our hosting, database and email providers, which store order records and send receipts on our behalf.</li>
      </ul>

      <h2 className={h2}>The mobile app</h2>
      <p className={p}>
        The Nolgic app has no accounts. It keeps your recent orders and the email you last used on your own phone so
        you can find your tokens. You can clear them by clearing the app&rsquo;s storage in your phone settings or by
        uninstalling it. The app asks for no device permissions.
      </p>

      <h2 className={h2}>How long we keep data, and your choices</h2>
      <p className={p}>
        We keep order records for as long as needed to provide receipts, handle refunds and disputes, and meet our
        legal and accounting obligations. You can ask us for a copy of your data, to correct it, or to delete it.
        Email nolgichq@gmail.com from the address you used and quote your order number. We will reply and, where the
        law allows, delete it.
      </p>

      <h2 className={h2}>Data protection and governing law</h2>
      <p className={p}>
        We handle personal data in line with the Nigeria Data Protection Act 2023. These terms are governed by the
        laws of the Federal Republic of Nigeria.
      </p>

      <h2 className={h2}>Security</h2>
      <p className={p}>
        All traffic between you and Nolgic is encrypted (HTTPS). Access to order data is limited to what is needed to
        run the service.
      </p>

      <h2 className={h2}>Contact</h2>
      <p className={p}>
        Support and privacy requests: nolgichq@gmail.com.
      </p>
      <p className={p}>
        Operator: {COMPANY_LINE}, Abuja, Nigeria.
      </p>

      <a href="/" className="text-tungsten underline underline-offset-4">&larr; Back to Nolgic</a>
    </main>
  );
}
