import { getBillStatus } from "@/lib/flutterwave";
import { sendReceipt } from "@/lib/whatsapp";
import { sendReceiptEmail } from "@/lib/email";

// Re-query FLW for a fulfilled order that's missing its token.
// If found: persist it and notify payer (email) + recipient (WhatsApp).
// Returns the token or null. Never throws.
export async function tryRecoverToken(db: any, order: any): Promise<string | null> {
  if (!order?.flw_reference || order.flw_token) return order?.flw_token ?? null;
  try {
    const status = await getBillStatus(order.flw_reference);
    const token =
      (status.data as any)?.extra ?? (status.data as any)?.token ?? null;
    if (!token) return null;

    await db.from("orders").update({ flw_token: token }).eq("id", order.id);

    await sendReceiptEmail({ ...order, flw_token: token }, { tokenFollowUp: true });
    if (order.recipient_whatsapp) {
      await sendReceipt(order.recipient_whatsapp, { ...order, flw_token: token });
    }
    return token;
  } catch (e) {
    console.error(`[token-recover] order ${order.id} failed`, e);
    return null;
  }
}

// Does this order plausibly involve a token?
export function expectsToken(order: any): boolean {
  return /(ELECTRIC|DISCO|PREPAID|METER|TOPUP|TOP UP)/i.test(
    `${order.biller_name} ${order.identifier_label}`
  );
}
