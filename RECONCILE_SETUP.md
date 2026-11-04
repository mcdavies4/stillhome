# Nolgic daily check (replaces the old Stripe reconciliation email)

Files in this zip: `src/lib/reconcile.ts` and `src/app/api/cron/tokens/route.ts` (only adds a 60-second limit).
No database change. No new environment variable is required.

## What the email now does
Runs every morning (it is part of the existing daily cron) for **yesterday in Nigeria**:

1. **Money in.** Reads every successful Flutterwave (and Paystack, if you use it) payment and matches it with an order or
   bulk batch, both ways. It flags: money received with no order, money received but the order never moved, a different
   amount, and an order that says paid with no payment behind it.
2. **Goods out.** Every fulfilled order must be known to Paybeta / VTpass.
3. **Stuck work.** paid for too long, needs_review, refund_failed, half-finished bulk batches.
4. **What you made.** Delivered value, your fees, commission, payment fees and gross profit, from the same numbers as /admin/finance.
5. **Bills wallet.** Shows the balance and warns when it falls below ₦20,000.

Covers electricity, TV, airtime, data, exam PINs and bulk airtime. Nothing in pounds or Stripe.
A day with no paid orders says "quiet day", not "all matched". If a provider cannot be read, the email says so.

## Optional
- `WALLET_LOW_NGN` in Vercel: the wallet warning level in naira (default 20000).

## First thing to check after deploying
Trigger it once and read the email. In PowerShell (use your own secret, do not paste it anywhere else):

    Invoke-RestMethod -Headers @{ Authorization = "Bearer YOUR_CRON_SECRET" } https://www.nolgic.com/api/cron/reconcile

If the email says it "could not read Flutterwave payments", the Flutterwave key does not allow listing transactions.
Everything else still works; tell me and I will switch that check to look up each payment one by one.
