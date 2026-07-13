# INTEGRATION.md — wiring into the live Nolgic (stillhome) repo

Everything is now written against your real modules — `validateCustomer`,
`quoteGbp`, `stripe`, `supabaseAdmin`, `getBillCategories` — and your real
orders schema (`identifier`, `amount_gbp_pence`, `fx_ngn_per_gbp`,
`pending_payment → paid → fulfilled`). The bot creates orders in exactly the
shape your existing Stripe webhook already claims and fulfils, so **the vend,
token recovery, and auto-refund pipeline is reused untouched**.

Only ONE existing file needs edits: `src/app/api/stripe/webhook/route.ts`.

## Patch 1 of 3 — import the hooks (top of the webhook file)

```ts
import { waOnFulfilled, waOnFailedRefunded } from "@/lib/wa/hooks";
```

## Patch 2 of 3 — after the order is marked `fulfilled`

Right after the block that does
`db.from("orders").update({ status: "fulfilled", flw_token: token })...`
and the receipt sends, add:

```ts
await waOnFulfilled({ ...order, flw_token: token });
```

Also guard the email receipt, since WhatsApp orders have `email = null`:

```ts
if (order.email) {
  await sendReceiptEmail({ ...order, flw_token: token });
}
```

(The `sendReceipt(order.recipient_whatsapp, ...)` call can stay as-is — the
bot sets `recipient_whatsapp` to the buyer's own number, so they'd get your
existing receipt *plus* the bot's token message. If that's one message too
many, wrap it in `if (order.source !== "whatsapp")`.)

## Patch 3 of 3 — after the auto-refund path

Right after `db.from("orders").update({ status: "failed_refunded", ... })`, add:

```ts
await waOnFailedRefunded(order);
```

That's the whole webhook change: one import, two hook calls, one email guard.

## Checklist

1. Copy files in (paths below), commit, push.
2. Run `supabase/migrations/0012_whatsapp_bot.sql` in Supabase.
   Idempotent — safe whether or not the earlier 0011 draft ran. Note it makes
   `orders.email` nullable (web flow unaffected; checkout always sets it).
3. Vercel env vars: `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_VERIFY_TOKEN`,
   `WHATSAPP_APP_SECRET`, `ANTHROPIC_API_KEY`, optional `CRON_SECRET`.
   `WHATSAPP_TOKEN` you already have — the code now reads that name.
   ⚠️ If your existing `@/lib/whatsapp` uses a different name for the phone
   number id, align `client.ts` line `const PHONE_ID = ...` to match.
4. Add the cron to `vercel.json`:
   `{ "crons": [{ "path": "/api/cron/wa-sweep", "schedule": "*/10 * * * *" }] }`
5. Create `/wa/paid` and `/wa/cancelled` pages — one line each:
   "All done — return to WhatsApp 💬".
6. Meta dashboard: webhook URL `https://nolgic.com/api/whatsapp/webhook`,
   verify token = `WHATSAPP_VERIFY_TOKEN`, subscribe to `messages`.
7. Wait for the `nolgic_token_delivery` template approval (5-param body).
8. Test: message `help` → welcome; then a ₦1,000 order on your own meter.

## Files in this bundle

```
supabase/migrations/0012_whatsapp_bot.sql
src/lib/wa/db.ts          uses supabaseAdmin()
src/lib/wa/client.ts      Meta sends, buttons, template fallback (WHATSAPP_TOKEN)
src/lib/wa/billers.ts     electricity catalogue from getBillCategories() — no hardcoded codes
src/lib/wa/extract.ts     Claude extraction, hardened output
src/lib/wa/engine.ts      state machine → validateCustomer + quoteGbp + Stripe session
src/lib/wa/hooks.ts       waOnFulfilled / waOnFailedRefunded (webhook patch)
src/app/api/whatsapp/webhook/route.ts
src/app/api/cron/wa-sweep/route.ts
```

## Assumptions to eyeball (30 seconds each)

- `validateCustomer(itemCode, billerCode, identifier)` returns
  `{ name, minimum, maximum }` and throws `FlwError` — matches your validate route.
- `quoteGbp(amountNgn)` returns `{ amountNgn, ngnPerGbp, serviceFeePence, totalPence }` —
  matches your checkout route.
- `supabaseAdmin` is a **function** (`supabaseAdmin()`), as in your API routes.
- Orders has a `stripe_session_id` column (your checkout stores the session);
  if yours is named differently, adjust the two references in `engine.ts` and
  one in the cron sweep.
- Your webhook only handles `checkout.session.completed` — link expiry is
  handled by the cron sweep, so no new webhook events are needed.
