import { NextResponse } from "next/server";
import { flwVerifyWebhook, parseFlwWebhook, orderIdFromFlwPayRef } from "@/lib/flwpay";
import { confirmFlutterwavePayment } from "@/lib/flwpay-process";

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
