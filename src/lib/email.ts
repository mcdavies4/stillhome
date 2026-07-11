// Receipt emails to the payer via Resend.
// Best-effort: never blocks or fails the payment pipeline.

type OrderForEmail = {
  id: string;
  email: string;
  biller_name: string;
  identifier: string;
  identifier_label: string;
  customer_name?: string | null;
  amount_ngn: number;
  amount_gbp_pence: number;
  flw_token?: string | null;
};

export async function sendReceiptEmail(o: OrderForEmail, opts?: { tokenFollowUp?: boolean }) {
  const key = process.env.RESEND_API_KEY;
  if (!key || !o.email) return;

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const orderUrl = `${appUrl}/order/${o.id}`;
  const ngn = `₦${Number(o.amount_ngn).toLocaleString("en-NG")}`;
  const gbp = `£${(o.amount_gbp_pence / 100).toFixed(2)}`;

  const subject = opts?.tokenFollowUp
    ? `Your meter token — ${o.biller_name}`
    : `Delivered ✅ ${o.biller_name} — ${ngn}`;

  const tokenBlock = o.flw_token
    ? `METER TOKEN: ${o.flw_token}\nLoad this on the prepaid meter to restore power.\n\n`
    : `Note: the meter token is still being issued by the provider. It will appear on your order page shortly, and we'll email it to you as soon as it lands.\n\n`;

  const text =
    (opts?.tokenFollowUp
      ? `Good news — the provider has issued the meter token for your payment.\n\n`
      : `Your Nolgic payment was delivered.\n\n`) +
    `Service: ${o.biller_name}\n` +
    `${o.identifier_label}: ${o.identifier}\n` +
    (o.customer_name ? `Account: ${o.customer_name}\n` : ``) +
    `Amount: ${ngn} (charged ${gbp})\n\n` +
    (/(ELECTRIC|DISCO|PREPAID|METER)/i.test(o.biller_name) || o.flw_token ? tokenBlock : ``) +
    `Order page (keep this link): ${orderUrl}\n\n` +
    `Questions? Reply to this email.\n— Nolgic · Designed with love in London`;

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM ?? "Nolgic <receipts@songsnap.online>",
        to: [o.email],
        reply_to: "the36thltd@outlook.com",
        subject,
        text,
      }),
    });
    if (!res.ok) console.error(`[email] send failed ${res.status}: ${(await res.text()).slice(0, 300)}`);
  } catch (e) {
    console.error("[email] receipt failed (non-fatal)", e);
  }
}
