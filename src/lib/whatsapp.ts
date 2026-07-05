// WhatsApp Cloud API receipts — same pattern as Nowrumble.
// Silently no-ops if env vars are missing so the pipeline never blocks on it.

export async function sendWhatsApp(toE164: string, text: string) {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneId || !toE164) return;

  try {
    await fetch(`https://graph.facebook.com/v20.0/${phoneId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: toE164.replace(/^\+/, ""),
        type: "text",
        text: { body: text },
      }),
    });
  } catch (e) {
    console.error("[whatsapp] receipt failed (non-fatal)", e);
  }
}

export function receiptText(o: {
  biller_name: string;
  customer_name?: string | null;
  identifier: string;
  amount_ngn: number;
  flw_token?: string | null;
}) {
  const lines = [
    `✅ StillHome — payment successful`,
    `${o.biller_name} — ₦${Number(o.amount_ngn).toLocaleString("en-NG")}`,
    o.customer_name ? `Account: ${o.customer_name}` : null,
    `Ref: ${o.identifier}`,
    o.flw_token ? `\n🔑 Meter token: ${o.flw_token}\nLoad this on the prepaid meter.` : null,
  ].filter(Boolean);
  return lines.join("\n");
}
