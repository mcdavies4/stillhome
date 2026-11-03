# Bulk airtime — setup and test plan

## 1. Database (once)
Supabase -> SQL editor -> run `supabase/migrations/0018_bulk_airtime.sql`. Safe to run twice.

## 2. Vercel environment variables (all optional except the two switches)
| Variable | Meaning | Default |
|---|---|---|
| `BULK_ENABLED=1` | server accepts bulk orders | off |
| `NEXT_PUBLIC_BULK_ENABLED=1` | shows the /bulk page and footer link | off |
| `NEXT_PUBLIC_BULK_MAX_RECIPIENTS` | numbers per batch | 100 |
| `NEXT_PUBLIC_BULK_MAX_EACH` | naira per number (Paybeta allows up to 20,000) | 5000 |
| `NEXT_PUBLIC_BULK_MAX_TOTAL` | naira per batch | 200000 |
| `NEXT_PUBLIC_BULK_FIRST_CAP` | a new customer's first batch | 20000 |
| `NEXT_PUBLIC_BULK_FEE_PCT / _MIN / _MAX` | service fee on the batch total | 1 / 20 / 500 |

Bulk needs BILLS_PROVIDER=paybeta and NGN_PAY_PROVIDER=flutterwave (it refuses to run otherwise).
Redeploy after changing any NEXT_PUBLIC_ value.

## 3. Test (preview deployment first, then live with a tiny batch)
1. Open /bulk, add 2-3 of YOUR OWN numbers at ₦50 each (the minimum), pick the right networks, pay.
2. The status page should move: Waiting -> Sending -> per-number "Delivered".
3. Check the receipt email and the Paybeta console (batch BLK-…, reference starts PBB…).
4. Failure test: add one number that is deliberately wrong (e.g. a valid-looking number on the wrong network). Confirm it shows
   "Refunded" and that Flutterwave shows a PARTIAL refund of just that amount.
5. Only then raise the limits or announce.

## 4. What the system does on its own
- Payment is re-verified with Flutterwave; the batch is claimed atomically; Paybeta's reference is unique, so it can't be bought twice.
- Refunds only for numbers Paybeta reports FAILED (partial), or the whole payment if Paybeta rejects the batch / wallet is too low.
- Timeouts, 5xx, unknown statuses: NOTHING is refunded; the batch waits and you get an email (needs_review).
- Every page load nudges the batch forward; the daily cron (the existing tokens cron) sweeps any unfinished batch.

## 5. Ask Paybeta (the docs don't say)
1. When is the wallet debited: at submit, or per number as each is processed?
2. Is a failed number's money returned to our wallet automatically, and when?
3. Do bulk results come to our webhook? (Today the site polls GET /v2/bulk-airtime/{reference}, which works either way.)
4. The full list of per-number status values (we handle delivered/successful, failed/cancelled, pending/queued; anything else is held for review).
5. Is the commission on bulk the same as single airtime? (It decides whether the 1% fee is enough.)
