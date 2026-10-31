# Taking naira with Flutterwave (instead of Paystack)

Flip one variable and naira checkout goes through Flutterwave. Unset it and Paystack is used, so nothing changes until you decide.

## 1. One-time
1. Run `supabase/migrations/0016_flutterwave_payin.sql` in the Supabase SQL editor.
2. Flutterwave dashboard -> Settings -> Webhooks:
   - URL: `https://www.nolgic.com/api/flutterwave/webhook`  (www host)
   - Secret hash: invent a long random string. Paste the SAME value into Vercel as `FLW_SECRET_HASH`.
3. Make sure the Flutterwave business is approved to COLLECT payments (not just bills). Check Settings -> Business verification.

## 2. Test first (Vercel Preview only)
```
NGN_PAY_PROVIDER=flutterwave
FLW_SECRET_KEY=<Flutterwave TEST secret key, FLWSECK_TEST-...>
FLW_SECRET_HASH=<your secret hash>
```
Keep `BILLS_PROVIDER=paybeta` + the Paybeta SANDBOX key in Preview. Buy ₦100 airtime with a Flutterwave test card.
A test-mode payment never vends on a LIVE bills provider (it is held in needs_review) unless you set
`PAYSTACK_TEST_ALLOW_LIVE_VEND=1` for a supervised test.

## 3. Go live (Production)
`NGN_PAY_PROVIDER=flutterwave`, `FLW_SECRET_KEY` = LIVE key, `FLW_SECRET_HASH`. Redeploy.
NOTE: `FLW_SECRET_KEY` is shared with Flutterwave BILLS. If `BILLS_PROVIDER` is flutterwave too, both use it.
Fees: decide in the Flutterwave dashboard who pays them. Nolgic checks the AMOUNT it asked for, so either works.

## How an order is confirmed
1. Checkout creates the order and a Flutterwave hosted payment (`tx_ref = NLGFW-<order id>`).
2. Customer pays and is sent back to `/order/<id>?paid=1`.
3. Flutterwave's webhook (and, if it is late or missing, the order page's own status poll) triggers a check.
4. The check asks Flutterwave's API: status `successful`, currency NGN, amount equal to what we asked for, tx_ref ours.
   The webhook body is never trusted for money decisions.
5. The order is claimed once (pending_payment -> paid) and sent to the shared vend pipeline.
   Definite vend failure -> automatic Flutterwave refund. Unclear outcome -> needs_review (never a guess).
