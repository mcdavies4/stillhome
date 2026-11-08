# Pay for Me ("Ask someone to pay")

A person in Nigeria lists what they need: light, DStv/GOtv/StarTimes, airtime, data. They get one link and send it on WhatsApp. A friend or relative opens it, sees exactly what it is (including the name on each meter), and pays **once** by card from anywhere. Each item is then bought, the person who asked sees their tokens on their own page, and anything that fails is refunded on its own.

It is **off** until you switch it on. While off, `/ask` and every Pay for Me API answer "not found", nothing links to it, and it is not in the sitemap. Nothing about the live site changes.

## Turn it on (in this order)

1. **Supabase**: run `supabase/migrations/0023_pay_for_me.sql` (safe to run twice). It adds two new tables and one empty column on `orders`. It changes no existing data.
2. **Push the zip** (the feature is still off).
3. **Paystack / Flutterwave**: make sure **international cards** are on, or a UK card will be declined. No new webhook is needed: both existing webhook URLs already handle these payments.
4. **Test it** (see below).
5. **Go live**: in Vercel set `NEXT_PUBLIC_PAYFORME_ENABLED=1` and **redeploy** (it is baked in at build time).
6. **Tell people**: nothing links to `/ask` yet. When you want it found, add a button (for example next to "Find my order") that goes to `/ask`.

### If you switch it on before running the SQL
Nothing breaks. `/ask` shows "Ask someone to pay is opening soon", the API answers a calm "isn't open yet", and nobody can be asked to pay. The server log says `[pfm] NOT READY: run supabase/migrations/0023_pay_for_me.sql`. Run the SQL and it opens by itself within a few minutes (no redeploy). It checks both new tables and the new column on `orders`.

## How it works (so you can explain it)

- The person asking fills `/ask`. Every item is checked with the provider (plan exists, price right, meter/smartcard owner name found), and the server works out the fees. The browser never sets a price.
- The link `/r/<id>` shows the payer who is asking, each item with the owner's name, the fees and the total, and a plain warning to pay only if they know the person.
- One payment covers everything: `bills + each item's normal service fee`. It is charged in naira; the payer's bank converts.
- When the gateway confirms the exact amount, the request is claimed once and each item becomes an **ordinary order** (`orders.pay_request_id` points to the request) and goes through the same buying code as a single order. Receipts, finance and support keep working.
- A failed item gets its own partial refund (its price plus its fee). The rest are delivered.
- The payer gets one summary email. The person who asked gets one if they gave an email. The page updates by itself.

## Safety rules built in

- Money is only taken once. Verified with the gateway (status, currency, exact amount, reference); never trusting the browser or the webhook body.
- Each item is bought once. Its order id is saved before the order exists, so a crash and retry cannot double-buy. Webhook, page poll and the daily sweep can all run together safely.
- Two payments for one request (double tap, two tabs): the second is refunded in full automatically and you get an email.
- Wrong amount, wrong currency, or a TEST payment while the bills provider is LIVE: nothing is bought, request goes to `needs_review`, you get an email.
- Wallet too low: the payer sees the calm "restocking" message **before** any payment exists.
- Paid but not finishing after 30 minutes: request goes to `needs_review` and you are emailed. Nothing is refunded on a guess.
- Tokens only appear on the page for the person who asked (a secret `?k=` key in their own link, never in the link they share) and in the two emails. The shared link shows masked meter numbers and no tokens.
- Limits: 8 items per request, ₦30,000 per item (your normal order limit), ₦100,000 per request (`PFM_MAX_TOTAL_NGN`), 8 requests per hour per IP, 7 days to pay. The normal velocity checks also apply to the payer.

## Test it before you announce it

Do this on a Vercel Preview or after step 5, with small amounts:

1. `/ask` on your phone: add a ₦100 airtime to your own number and a ₦100 airtime to a second number. Make the link.
2. Open the link on a different device or browser as the payer, and pay by card. If you can, use a UK card.
3. Watch both items go to Delivered. Check the email you gave and the page you opened with "Open my page".
4. **The one thing I could not test for real: partial refunds.** Everything above was tested with simulated Paystack, Flutterwave and Paybeta. If one item of several fails, the code asks the gateway for a *partial* refund of that item. Both gateways document partial refunds, but please confirm in your dashboard that a partial refund on a multi-item payment works, and that two partial refunds on the same payment are accepted. If the gateway rejects it you get a "REFUND FAILED" email and refund by hand from the dashboard, exactly as for any failed refund today.

## Good to know

- **Exam PINs are not included** in this first version (electricity, TV, airtime, data only).
- **Fees:** the payer pays your normal per-item fee. International cards cost you more at the gateway than local cards, and you absorb that. Look at your gateway's international rate and decide whether the fee for these requests should be higher. If so, tell me and it is a small change.
- **Misuse:** like any "pay this link" feature, someone could send a link to a stranger. The page shows the name on each meter and warns the payer; creating is rate-limited. Watch the first weeks of requests in Supabase (`pay_requests`).
- **Daily check:** the morning reconcile email now matches each Pay for Me payment to its request, so a shared payment does not raise false alarms.
- **Support:** to see everything bought for a request, filter `orders` by `pay_request_id`.
- No cancel after someone has started paying. An unpaid request just expires after 7 days.

## Environment variables

| Variable | What it does |
| --- | --- |
| `NEXT_PUBLIC_PAYFORME_ENABLED` | `1` turns the feature on (then redeploy). Empty = off. |
| `PFM_MAX_TOTAL_NGN` | Biggest single request, bills plus fees. Default 100000. |

## Files

New: `0023_pay_for_me.sql`, `src/lib/payforme.ts`, `payforme-shared.ts`, `payforme-email.ts`, `src/app/ask/*`, `src/app/r/[id]/*`, `src/app/api/payforme/*`.
Changed (small): `paystack.ts` (partial refunds, custom reference), both gateway webhooks (a Pay for Me branch ahead of the existing ones), `reconcile.ts` and `api/cron/reconcile` (match shared payments, daily sweep), `robots.ts`, `.env.example`.

## Giveaway (`/giveaway`)

The same engine, used the other way round: the person who makes the list also pays it. Someone picks what each person gets (light, airtime, data or TV), adds up to **15 people**, pays once, and every person is bought and tracked separately. The maker then sees each token on their own page and sends each person a ready-written WhatsApp message (their name, the maker's message, the token or confirmation). Airtime and data open WhatsApp straight to the person's number.

- It switches on and off with Pay for Me (`NEXT_PUBLIC_PAYFORME_ENABLED`) and needs the same SQL (`0023`). Nothing new in the database, no new environment variable.
- It is a normal Pay for Me request with `giveaway: true`, which only raises the item cap from 8 to 15. Everything else is unchanged: each item is checked with the provider first, one payment covers bills plus each item's normal fee, each item becomes an ordinary order, a failed item gets its own partial refund.
- Per-request cap is still `PFM_MAX_TOTAL_NGN` (default ₦100,000). Raise it in Vercel if you want bigger giveaways.
- The maker's page is `/r/<id>`. The secret key, the message and each person's name are kept **only in the maker's browser** (localStorage); the names never reach the server. If the maker clears their browser data they lose the tokens page, but the maker still gets the tokens by email (the email is required on `/giveaway`).
- The page keeps buying while it is open (it polls); the existing reconcile cron finishes anything left. Tell people to keep the page open until every item says Delivered.

### Test it (same test as Pay for Me)
1. Make a ₦100 two-person giveaway to two of your own numbers.
2. Pay it. Both should turn Delivered, and the two WhatsApp buttons should open with the right message.
3. Break one number on purpose and confirm only that one is refunded.
