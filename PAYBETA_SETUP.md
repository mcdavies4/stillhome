# Paybeta setup (Nolgic)

Paybeta is a third bills provider next to Flutterwave and VTpass. Nothing changes until `BILLS_PROVIDER=paybeta`.

## 1. One-time
1. Create the sandbox account: https://console.sandbox.paybeta.ng/register
2. Email support@paybeta.ng to request API access, then complete KYC/KYB with your account manager.
3. Run `supabase/migrations/0015_paybeta_events.sql` once in the Supabase SQL editor.

## 2. Sandbox test (fake money)
Vercel -> Preview (or `.env.local`), never Production:
```
BILLS_PROVIDER=paybeta
PAYBETA_ENV=sandbox
PAYBETA_API_KEY=<sandbox key from the console, pasted by you>
```
Then, one line at a time:
```
npx dotenv -e .env.local -- npx tsx scripts/check-paybeta.ts
$env:CHECK_VEND="airtime"; npx dotenv -e .env.local -- npx tsx scripts/check-paybeta.ts
```
(also `data`, `tv`, `electricity`). The check prints the service ids Paybeta returned; compare them with the docs.
`CHECK_VEND` is refused unless `PAYBETA_ENV=sandbox`.

## 3. Webhook (required — Paybeta has no status-check endpoint)
Paybeta console -> Settings -> Webhook URL: `https://www.nolgic.com/api/paybeta/webhook` (use the www host).
Signature header `Signature` = HMAC-SHA256 of `data.reference` keyed with your API key.

## 4. Go live
Production only: `PAYBETA_ENV=live` and the LIVE key (a different key from sandbox). Fund the Paybeta wallet.
If Paybeta asks for a whitelisted IP, update the relay on the droplet (`relay/server.js` now has /paybeta/) and set
`PAYBETA_BASE=https://relay.nolgic.com/paybeta`; otherwise leave `PAYBETA_BASE` unset.

## How a vend is settled
- success response -> order fulfilled, token delivered.
- definite rejection (4xx, `failed`, bad phone/meter) -> `notVended` -> automatic Paystack refund.
- pending / timeout / 5xx / duplicate-reference -> order goes to `needs_review`, NO refund. When Paybeta's webhook arrives:
  success -> fulfilled + receipt; failed -> automatic Paystack refund. Only orders in `needs_review` move, once.
- Until a webhook arrives the status stays "pending". Check the Paybeta console by hand if one is overdue.
