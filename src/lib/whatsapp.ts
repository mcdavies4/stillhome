// WhatsApp Cloud API receipts.
// Business-initiated messages MUST use an approved template (24-hour rule),
// so we send the receipt utility template (WHATSAPP_TEMPLATE env, default stillhome_receipt).
// Silently no-ops if env vars are missing — never blocks the payment pipeline.

export async function sendReceipt(
  toE164: string,
  o: {
    biller_name: string;
    identifier: string;
    amount_ngn: number;
    flw_token?: string | null;
  }
) {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneId || !toE164) return;

  const tokenLine = o.flw_token
    ? `Meter token: ${o.flw_token} — load it on the prepaid meter.`
    : `Delivered instantly.`;

  try {
    const res = await fetch(`https://graph.facebook.com/v20.0/${phoneId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: toE164.replace(/[^\d]/g, ""),
        type: "template",
        template: {
          name: process.env.WHATSAPP_TEMPLATE ?? "stillhome_receipt",
          language: { code: "en" },
          components: [
            {
              type: "body",
              parameters: [
                { type: "text", text: o.biller_name },
                { type: "text", text: Number(o.amount_ngn).toLocaleString("en-NG") },
                { type: "text", text: o.identifier },
                { type: "text", text: tokenLine },
              ],
            },
          ],
        },
      }),
    });
    const body = await res.text();
    if (!res.ok) console.error(`[whatsapp] send failed ${res.status}: ${body.slice(0, 300)}`);
  } catch (e) {
    console.error("[whatsapp] receipt failed (non-fatal)", e);
  }
}
