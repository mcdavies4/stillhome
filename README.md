# StillHome ⚡

Pay light, DSTV, airtime & data for family in Nigeria — from the UK, in pounds.
Product model: you sell prepaid digital goods (not remittance). Stripe collects
GBP; Flutterwave Bills vends NGN from your prefunded wallet; the FX spread +
flat fee is the margin.

## Architecture

```
UK customer ──£──> Stripe Checkout (The 36th Company Ltd, UK)
                      │ checkout.session.completed webhook
                      ▼
              /api/stripe/webhook  ← the fulfilment pipeline
                      │ claim order (pending_payment → paid, atomic)
                      ▼
        Flutterwave Bills API (The 36th Solutions Ltd, NG wallet)
              │ success                    │ failure
              ▼                            ▼
   status=fulfilled + token       Stripe auto-refund
   WhatsApp receipt               status=failed_refunded
```

Safety invariants:
- **Never vend twice**: order is claimed with an atomic conditional update;
  FLW reference `STILLHOME-{orderId}` is idempotent.
- **Customer never loses money**: any vend failure triggers an automatic full
  Stripe refund. `refund_failed` status exists purely to page a human.
- **Validate before charge**: identifier is validated at checkout-creation
  time server-side (not just the earlier UI call), and the account holder
  name is shown before payment. FLW bill payments are non-refundable.

## Setup

1. `npm install`
2. Copy `.env.example` → `.env.local` and fill:
   - Supabase project (run `supabase/migrations/0001_init.sql` in SQL editor)
   - Stripe secret key + webhook secret (endpoint: `/api/stripe/webhook`,
     event: `checkout.session.completed`)
   - `FLW_SECRET_KEY` from the Nigerian Flutterwave dashboard; **whitelist your
     server IPs** in FLW settings (required for Bills API); fund the NGN wallet
   - `NGN_PER_GBP` — set below mid-market; review weekly at minimum
3. `npm run dev`

### Test mode
- Stripe test card `4242 4242 4242 4242`
- FLW test-mode DSTV credential from their docs validates against BIL119
- `stripe listen --forward-to localhost:3000/api/stripe/webhook`

## Deliberately deferred (next passes)
- Supabase auth + saved recipients UI (schema already in migration)
- Cron requery for electricity tokens that arrive late (`/api/orders` +
  `getBillStatus` are ready for it)
- Recurring top-ups ("Mum's light, monthly")
- Live FX rate feed instead of manual `NGN_PER_GBP`
- Admin view for `refund_failed` orders

## Compliance posture (not legal advice)
Prepaid products only. Never use "send money"/"transfer" language anywhere —
customers *buy* a top-up/token/subscription. Fund the FLW wallet via proper
intercompany transactions between the UK and NG entities. Book an hour with a
fintech solicitor before scaling volume.
