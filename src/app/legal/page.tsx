export const metadata = { title: "Terms, Refunds & Privacy — Nolgic" };

export default function Legal() {
  return (
    <main className="max-w-xl mx-auto px-5 py-16 leading-relaxed">
      <h1 className="font-display font-extrabold text-3xl mb-2">Terms, Refunds &amp; Privacy</h1>
      <p className="text-haze text-sm mb-10">
        Nolgic is a trading name of a sole trader based in the United Kingdom. Last updated July 2026.
      </p>

      <h2 className="font-display font-semibold text-xl mb-3">What Nolgic is</h2>
      <p className="text-haze mb-8">
        Nolgic sells prepaid digital products: electricity tokens, TV
        subscriptions, mobile airtime and data for Nigerian service providers.
        When you pay, you are buying a product from us at the pound price shown
        at checkout — Nolgic is not a money transfer or remittance service
        and does not send, hold or convert money on your behalf. The naira
        value shown describes the product you are buying, not an exchange we
        perform for you.
      </p>

      <h2 className="font-display font-semibold text-xl mb-3">Your responsibility: the account details</h2>
      <p className="text-haze mb-8">
        Before you pay, we look up and show you the account holder&rsquo;s name
        for the meter or smartcard number you entered, where the provider
        supports it. For airtime and data, no lookup exists — the phone number
        you enter is where the top-up will be delivered, so please check it
        carefully. Once a token, subscription or top-up has been delivered to
        the number you confirmed, it cannot be reversed, transferred to a
        different meter, account or phone number, or refunded — this is a
        restriction imposed by the Nigerian service providers themselves.
      </p>

      <h2 className="font-display font-semibold text-xl mb-3">Refund policy</h2>
      <p className="text-haze mb-8">
        If delivery fails for any reason, we refund your card automatically and
        in full — you never pay for something that wasn&rsquo;t delivered. If
        delivery succeeds to the account details you confirmed at checkout, the
        purchase is final. If you believe a payment was delivered incorrectly
        despite showing the correct account name, contact us within 48 hours at
        the support address below and we will investigate with the provider.
      </p>

      <h2 className="font-display font-semibold text-xl mb-3">Pricing</h2>
      <p className="text-haze mb-8">
        The total pound price, including our service fee, is shown before you
        pay. Product prices include our margin over wholesale cost and may
        change at any time; the price you see at checkout is the price you pay.
      </p>

      <h2 className="font-display font-semibold text-xl mb-3">Privacy</h2>
      <p className="text-haze mb-8">
        We collect only what the service needs: your email (receipts and order
        history), the account identifiers you enter (meter, smartcard or phone
        numbers), and optionally a WhatsApp number to deliver receipts and
        tokens. Card details are handled entirely by Stripe and never touch our
        servers. Fulfilment identifiers are shared with Flutterwave, our
        Nigerian payment processor, solely to deliver your purchase. We do not
        sell personal data. To have your data deleted, email us.
      </p>

      <h2 className="font-display font-semibold text-xl mb-3">Contact</h2>
      <p className="text-haze mb-8">
        Support: nolgichq@gmail.com. Nolgic is a UK-based sole trader; the trader’s name and address are available on request.
      </p>

      <a href="/" className="text-tungsten underline underline-offset-4">← Back to Nolgic</a>
    </main>
  );
}
