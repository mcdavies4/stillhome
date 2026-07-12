# Nolgic WhatsApp Bot — Drop-in Files

Copy these into the existing Nolgic Next.js repo (App Router assumed, `@/` → `src/`).

```
supabase/migrations/0011_whatsapp_bot.sql     ← renumber if taken
src/lib/wa/db.ts                              ← Supabase client + types
src/lib/wa/client.ts                          ← Meta Cloud API send + signature verify
src/lib/wa/billers.ts                         ← ⚠️ paste your real FLW biller/item codes
src/lib/wa/extract.ts                         ← Claude extraction
src/lib/wa/engine.ts                          ← state machine
src/lib/wa/on-payment.ts                      ← ⚠️ import into existing Stripe webhook
src/app/api/whatsapp/webhook/route.ts         ← new route
src/app/api/cron/wa-sweep/route.ts            ← new cron route
```

## Integration points (search for `⚠️ INTEGRATION`)

1. **billers.ts** — replace `BIL_REPLACE`/`ITEM_REPLACE` with the live codes Nolgic already uses.
2. **engine.ts → getGbpQuote()** — swap for the site's pricing function so both channels quote identically. Env stopgap works for testing (`NGN_PER_GBP`, `NOLGIC_MARGIN_PCT`).
3. **on-payment.ts → vendOrder()** — replace with your tested vend function; keep `reference = order.id`.
4. **Stripe webhook** — add the two `if (session.metadata?.source === "whatsapp")` branches shown at the top of `on-payment.ts`.
5. **orders table** — the insert in `engine.ts` assumes columns: `status, biller_code, item_code, meter_number, customer_name, amount_ngn, amount_gbp, fx_rate, stripe_session_id, token, units, flw_reference, vend_error, paid_at, completed_at`. Add any missing ones or adjust the insert.
6. **Receipts/alerts** — hook your existing Resend receipt + admin alert where marked.
7. Create `/wa/paid` and `/wa/cancelled` pages — one line each: "All done — return to WhatsApp 💬".

## New env vars

```
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_ACCESS_TOKEN=          # System User permanent token
WHATSAPP_VERIFY_TOKEN=          # any random string; must match Meta config
WHATSAPP_APP_SECRET=            # App → Settings → Basic
ANTHROPIC_API_KEY=
CRON_SECRET=                    # optional, protects manual cron trigger
NGN_PER_GBP=2050                # temp until pricing integration
NOLGIC_MARGIN_PCT=4             # temp until pricing integration
```

## vercel.json addition

```json
{ "crons": [{ "path": "/api/cron/wa-sweep", "schedule": "*/10 * * * *" }] }
```

## Meta setup (start TODAY — longest pole)

1. Meta Business verification for The 36th Company / Nolgic.
2. WhatsApp product on your Meta app; add a **dedicated number** (virtual UK number is fine — never a personal one).
3. Webhook: URL `https://nolgic.com/api/whatsapp/webhook`, verify token = `WHATSAPP_VERIFY_TOKEN`, subscribe to `messages`.
4. Create System User → generate permanent token with `whatsapp_business_messaging` + `whatsapp_business_management`.
5. Submit template `nolgic_token_delivery` (body: `Your {{1}} token for meter {{2}}: *{{3}}*. Units: {{4}}. Ref: {{5}}`) — approval can take hours to days.
6. Display name approval for "Nolgic".

## SQL helper referenced in code (add to migration or run once)

```sql
create or replace function increment_wa_order_count(p_user uuid) returns void
language sql security definer as $$
  update wa_users set order_count = order_count + 1 where id = p_user;
$$;
```

## Test plan

1. `curl` the GET webhook with the verify token → expect challenge echoed.
2. Message the number: `help` → welcome + help copy.
3. `IKEDC 1000 meter <your real meter>` → name comes back correct → Pay button.
4. Pay with Stripe test card `4242…` (test mode keys + FLW sandbox) → token message arrives.
5. Kill FLW key mid-test → confirm auto-refund + apology message fires.
6. Send the same webhook payload twice via curl → second is ignored (dedupe).
7. Let a payment link sit 20+ min → cron sends expiry notice.
