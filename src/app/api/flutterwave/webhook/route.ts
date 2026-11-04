import { NextResponse } from "next/server";
import { flwVerifyWebhook, parseFlwWebhook, orderIdFromFlwPayRef } from "@/lib/flwpay";
import { confirmFlutterwavePayment } from "@/lib/flwpay-process";
import { bulkIdFromTxRef, confirmBulkPayment } from "@/lib/bulk";
import { confirmPayRequest } from "@/lib/payforme";
import { parsePfmRef } from "@/lib/payforme-shared";

// Flutterwave (₦) pay-in webhook — the twin of /api/paystack/webhook.
//
// Dashboard setup (Flutterwave -> Settings -> Webhooks):
//   URL         https://www.nolgic.com/api/flutterwave/webhook     (use the www host: webhooks do not follow redirects)
//   Secret hash a long random string you invent; put the SAME value in Vercel as FLW_SECRET_HASH
//
// The webhook is only a nudge. The payment is re-verified with Flutterwave's API before anything is vended
// (see lib/flwpay-process.ts), and the order page does the same check if this webhook never arrives.
// Non-2xx makes Flutterwave retry; we only return one when verification itself failed (network / 5xx).

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  const raw = await req.text();
  const ok = flwVerifyWebhook(raw, {
    verifHash: req.headers.get("verif-hash"),
    signature: req.headers.get("flutterwave-signature"),
  });
  if (!ok) return NextResponse.json({ error: "Invalid signature" }, { status: 401 });

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Bad JSON" }, { status: 400 });
  }
  const ev = parseFlwWebhook(payload);
  if (!ev) return NextResponse.json({ received: true, note: "no tx_ref" });
  if (ev.event && ev.event !== "charge.completed") return NextResponse.json({ received: true, note: `ignored ${ev.event}` });

  // Bulk airtime batches use their own tx_ref prefix (NLGFB-).
  const bulkId = bulkIdFromTxRef(ev.txRef);
  if (bulkId) {
    try {
      const r = await confirmBulkPayment(bulkId, { transactionId: ev.id });
      return NextResponse.json({ received: true, bulk: true, state: r.state });
    } catch (e: any) {
      console.error("[flutterwave-webhook] bulk verification failed", e?.message ?? e);
      return NextResponse.json({ error: "Verification failed, retry" }, { status: 500 });
    }
  }

  // "Pay for Me" payments (NLGFP-<request id>-<attempt>): one payment, several items.
  const pfm = parsePfmRef(ev.txRef);
  if (pfm && pfm.rail === "flutterwave") {
    try {
      const r = await confirmPayRequest(pfm.requestId, { ref: ev.txRef, transactionId: ev.id });
      return NextResponse.json({ received: true, payForMe: true, state: r.state });
    } catch (e: any) {
      console.error("[flutterwave-webhook] pay-for-me verification failed", e?.message ?? e);
      return NextResponse.json({ error: "Verification failed, retry" }, { status: 500 });
    }
  }

  const orderId = orderIdFromFlwPayRef(ev.txRef);
  if (!orderId) return NextResponse.json({ received: true, note: "not a Nolgic payment" });

  try {
    const r = await confirmFlutterwavePayment(orderId, { transactionId: ev.id });
    return NextResponse.json({ received: true, state: r.state, outcome: r.outcome ?? null });
  } catch (e: any) {
    console.error("[flutterwave-webhook] verification failed", e?.message ?? e);
    return NextResponse.json({ error: "Verification failed, retry" }, { status: 500 });
  }
}
