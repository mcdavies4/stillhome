# Preview test: Paybeta (bills) + Flutterwave (naira pay-in)

Everything else stays dormant: Paystack, Stripe (£), VTpass, Ghana, WhatsApp. Nothing needs a key for them.
Vercel -> stillhome -> Settings -> Environment Variables. Tick ONLY **Preview** on each. Never Production.

## Required
| Variable | Value |
|---|---|
| NEXT_PUBLIC_SUPABASE_URL | same as Production |
| SUPABASE_SERVICE_ROLE_KEY | same as Production |
| NEXT_PUBLIC_APP_URL | the Preview URL (branch URL shown on the deployment), no trailing slash |
| NEXT_PUBLIC_NGN_PAY_ENABLED | 1 |
| NGN_PAY_PROVIDER | flutterwave |
| FLW_SECRET_KEY | Flutterwave TEST secret key (FLWSECK_TEST-...) |
| FLW_SECRET_HASH | any long random string you invent |
| BILLS_PROVIDER | paybeta |
| PAYBETA_ENV | sandbox |
| PAYBETA_API_KEY | Paybeta SANDBOX key |
| PAYBETA_SECRET_KEY | only if the Paybeta console shows a separate secret key |
| CRON_SECRET, ADMIN_SECRET, ADMIN_PASSWORD | any values (admin page login uses ADMIN_PASSWORD) |

## Optional
RESEND_API_KEY + ALERT_EMAIL (receipts and alerts by email), NEXT_PUBLIC_NG_FEE_MIN=50.

## Leave unset (dormant)
STRIPE_*, PAYSTACK_SECRET_KEY, VTPASS_*, WHATSAPP_*, NEXT_PUBLIC_UK_PAY_ENABLED, NEXT_PUBLIC_GH_ENABLED.

## Before the first test (Supabase SQL editor, once each)
supabase/migrations/0015_paybeta_events.sql and 0016_flutterwave_payin.sql

## Run it
1. Redeploy the Preview (NEXT_PUBLIC_* values are baked in at build time).
2. Open the Preview URL, pick MTN airtime, 08011111111, ₦100, enter an email, pay.
3. On Flutterwave's page use a TEST card (the page lists them in test mode).
4. You land on /order/<id>?paid=1. It should move to "delivered" within seconds.
   Flutterwave's webhook is optional here: the order page asks Flutterwave itself.
5. Check /admin (sign in with ADMIN_PASSWORD): bills provider should read Paybeta SANDBOX,
   naira payments Flutterwave TEST.
6. Then repeat with electricity (meter 0111100049, Paybeta sandbox meter) to see a token.

Because both sides are test/sandbox, nothing real is charged or bought.
