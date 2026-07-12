// src/lib/wa/client.ts
// Meta WhatsApp Cloud API: signature verification + send helpers.

import crypto from "crypto";

const GRAPH = "https://graph.facebook.com/v21.0";
const PHONE_ID = process.env.WHATSAPP_PHONE_NUMBER_ID!;
const TOKEN = process.env.WHATSAPP_TOKEN!;

/** Validate X-Hub-Signature-256 against the raw request body. */
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

/** Plain text message (24h customer-service window). */
export async function sendText(to: string, body: string): Promise<void> {
  await send({ to, type: "text", text: { body, preview_url: true } });
}

/** Interactive reply buttons (max 3 buttons, 20 chars per title). */
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
 * Pre-approved template message — required OUTSIDE the 24h window.
 * Create `nolgic_token_delivery` in Meta Business Manager first:
 *   "Your {{1}} token for meter {{2}}: *{{3}}*. Units: {{4}}. Ref: {{5}}"
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
      components: [
        { type: "body", parameters: params.map((text) => ({ type: "text", text })) },
      ],
    },
  });
}

/**
 * Deliver token + receipt. Tries free-form first (works within 24h window);
 * falls back to the approved template if the window has closed.
 */
export async function deliverToken(
  to: string,
  o: {
    billerLabel: string;
    meterNumber: string;
    customerName: string;
    token: string;
    units?: string;
    reference: string;
    gbpPaid: string; // "5.42"
  }
): Promise<void> {
  const meterMasked = o.meterNumber;
  const body =
    `✅ Payment received — £${o.gbpPaid}\n\n` +
    `⚡ *Token:* ${o.token}\n` +
    `Meter: ${meterMasked} (${o.customerName})\n` +
    (o.units ? `Units: ${o.units}\n` : "") +
    `Ref: ${o.reference}\n\n` +
    `Forward this message to the meter owner 👆\n` +
    `Say *again* anytime to repeat this order.`;
  try {
    await sendText(to, body);
  } catch {
    await sendTokenTemplate(to, [
      o.billerLabel,
      o.meterNumber,
      o.token,
      o.units ?? "-",
      o.reference,
    ]);
  }
}
