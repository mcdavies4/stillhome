// src/lib/wa/client.ts
// Meta WhatsApp Cloud API helpers for the bot: signature verification,
// free-form sends, interactive buttons, and the approved template fallback.
// Uses the SAME env vars as the existing receipt sender: WHATSAPP_TOKEN +
// WHATSAPP_PHONE_NUMBER_ID (align the phone id name with @/lib/whatsapp if
// yours differs).

import crypto from "crypto";

const GRAPH = "https://graph.facebook.com/v21.0";
const PHONE_ID = process.env.WHATSAPP_PHONE_NUMBER_ID!;
const TOKEN = process.env.WHATSAPP_TOKEN!;

export function verifySignature(rawBody: string, signatureHeader: string | null): boolean {
  if (!signatureHeader?.startsWith("sha256=")) return false;
  const expected = crypto
    .createHmac("sha256", process.env.WHATSAPP_APP_SECRET!)
    .update(rawBody, "utf8")
    .digest("hex");
  const received = signatureHeader.slice(7);
  try {
    return crypto.timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(received, "hex"));
  } catch {
    return false;
  }
}

async function send(payload: Record<string, unknown>): Promise<void> {
  const res = await fetch(`${GRAPH}/${PHONE_ID}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ messaging_product: "whatsapp", ...payload }),
  });
  if (!res.ok) {
    const body = await res.text();
    console.error("[wa] send failed", res.status, body);
    throw new Error(`WhatsApp send failed: ${res.status}`);
  }
}

export async function sendText(to: string, body: string): Promise<void> {
  await send({ to, type: "text", text: { body, preview_url: true } });
}

export async function sendButtons(
  to: string,
  body: string,
  buttons: { id: string; title: string }[]
): Promise<void> {
  await send({
    to,
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: body },
      action: { buttons: buttons.map((b) => ({ type: "reply", reply: b })) },
    },
  });
}

/**
 * Approved template `nolgic_token_delivery` (5 params):
 *   Your {{1}} purchase is complete. / Token for meter {{2}}: *{{3}}* /
 *   Units: {{4}} / Ref: {{5}} / Thanks for using Nolgic...
 */
export async function sendTokenTemplate(
  to: string,
  params: [biller: string, meter: string, token: string, units: string, ref: string]
): Promise<void> {
  await send({
    to,
    type: "template",
    template: {
      name: "nolgic_token_delivery",
      language: { code: "en" },
      components: [{ type: "body", parameters: params.map((text) => ({ type: "text", text })) }],
    },
  });
}

/** Free-form token delivery with template fallback outside the 24h window. */
export async function deliverToken(
  to: string,
  o: {
    billerLabel: string;
    identifier: string;
    customerName: string;
    token: string;
    reference: string;
    gbpPaid: string;
  }
): Promise<void> {
  const body =
    `✅ Payment received — £${o.gbpPaid}\n\n` +
    `⚡ *Token:* ${o.token}\n` +
    `Meter: ${o.identifier} (${o.customerName})\n` +
    `Ref: ${o.reference}\n\n` +
    `Forward this message to the meter owner 👆\n` +
    `Say *again* anytime to repeat this order.`;
  try {
    await sendText(to, body);
  } catch {
    await sendTokenTemplate(to, [o.billerLabel, o.identifier, o.token, "-", o.reference]);
  }
}
