# Switching naira payments to Paystack (including bulk airtime)

Nolgic now takes naira through Paystack for everything: single bills, exam PINs, Pay for Me, giveaways and bulk airtime.
Which provider takes new payments is one setting, `NGN_PAY_PROVIDER`. Nothing else is needed in the database.

## In Vercel -> Settings -> Environment Variables (Production)

| Name | Value |
|---|---|
| `NGN_PAY_PROVIDER` | `paystack` (or delete it: Paystack is the default) |
| `PAYSTACK_SECRET_KEY` | the **live** secret key (`sk_live_...`) of the **Nolgic** Paystack business |
| `BULK_ENABLED` | `1` (already set if bulk was on) |

Keep `FLW_SECRET_KEY` and `FLW_SECRET_HASH` for now. Orders started on Flutterwave before the switch still confirm and refund
through Flutterwave. Remove them once Admin -> Orders shows no Flutterwave order still waiting.

Then redeploy (Deployments -> ... -> Redeploy), because env changes only apply to new deployments.

## In the Paystack dashboard (Nolgic business)

1. Settings -> API Keys & Webhooks -> **Live Webhook URL** = `https://www.nolgic.com/api/paystack/webhook` (use `www`, webhooks don't follow redirects).
2. The business must be live (activated), not in test mode.
3. Refunds are paid out of your Paystack balance. Keep some balance there: a refund the balance can't cover stays "pending" until it can.

## How a bulk batch works on Paystack

1. Customer pays on Paystack. The payment reference is `NLGPB-<batch id>`.
2. Paystack's webhook (or the batch page, if the webhook is late) re-checks the payment with Paystack's API: status, NGN, exact amount, reference.
3. The batch is claimed once and sent to Paybeta.
4. Failed numbers are refunded through Paystack: a partial refund of just those numbers (or everything, fee included, if nothing was delivered).
5. A refund that Paystack rejects marks the batch `refund_failed` and emails you the reference to refund by hand.

Single orders now get the same backup check: if Paystack's webhook never arrives, the order page asks Paystack directly.

## Check it works

1. Admin -> Health: "Paystack key" shows Live.
2. Pay for a real ₦100 airtime order. It should be delivered and appear in Admin -> Orders as `fulfilled`.
3. Send a 2-number bulk batch (about ₦200). It should settle on its own.
4. Next morning, the reconcile email should show Paystack payments and no red flags.

## Fees

Paystack charges 1.5% (plus ₦100 on payments of ₦2,500 and over, capped at ₦2,000). The bulk service fee is 1% (min ₦20, max ₦500)
and is set by `NEXT_PUBLIC_BULK_FEE_PCT`, `_MIN` and `_MAX`. Check Admin -> Finance after a few batches and adjust if a size band looks thin.

## Going back

Set `NGN_PAY_PROVIDER=flutterwave` and redeploy. Batches and orders already paid on Paystack keep confirming and refunding through Paystack.
