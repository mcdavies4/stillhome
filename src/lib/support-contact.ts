// Message-us-on-WhatsApp link, prefilled with the order number so the person helping can find it at once.
// Uses a human's number, set in NEXT_PUBLIC_SUPPORT_WHATSAPP (country code, digits only, e.g. 2348012345678).
// Not set means no button is shown at all (the email link stays).

export const supportNumber = (): string | null => {
  const raw = String(process.env.NEXT_PUBLIC_SUPPORT_WHATSAPP ?? "").replace(/[^\d]/g, "");
  return raw.length >= 8 && raw.length <= 15 ? raw : null;
};

export function supportLink(o: { orderNo?: string; status?: string; item?: string }, number: string | null = supportNumber()): string | null {
  if (!number) return null;
  const parts = ["Hello Nolgic, I need help with an order."];
  if (o.orderNo) parts.push(`Order number: ${o.orderNo}`);
  if (o.item) parts.push(`Item: ${o.item}`);
  if (o.status) parts.push(`Status on the page: ${o.status}`);
  return `https://wa.me/${number}?text=${encodeURIComponent(parts.join("\n"))}`;
}
