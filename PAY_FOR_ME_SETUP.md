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

## Giveaway links: "let them choose" (`/giveaway/link`)

For when the giver doesn't have everyone's numbers. The giver shares **one link**; each person picks their own light, airtime, data or TV and enters their own meter / smartcard / phone number; the giver checks the list and **pays once** for everyone. Nobody pays anything until the giver closes the list, so Nolgic never holds money for people who haven't chosen yet.

1. **Giver** (`/giveaway/link`): name, email (required), a message, what people may choose, the most each person can choose (e.g. ₦2,000) and how many people (up to 15). They get a link to share and a **private page**, which is also emailed to them.
2. **Each person** (`/c/<id>`): sees who it's from and what's on offer, picks theirs (TV and data plans above the limit are hidden), enters their number, sees the name on the meter, adds their name and (optionally) their WhatsApp number, and joins. Nothing for them to pay.
3. **Giver's private page** (`/c/<id>?k=<key>`): sees everyone who joined with the name on each meter, removes anyone they don't recognise, then taps **Close the list and pay**. Every choice is checked with the provider again, the list becomes an ordinary giveaway (same per-item delivery, refunds and safety rules as `/giveaway`), and they go straight to the payment page.
4. **Each person** opens the same link on the same phone and sees their own delivery, including their **token**, without the giver having to forward it. The giver still gets every token and the one-tap WhatsApp buttons on the giveaway page; for people who gave a WhatsApp number, each button opens that person's chat directly.

### Turn it on
1. **Supabase**: run `supabase/migrations/0025_giveaway_links.sql` (needs 0023 first; safe to run twice).
2. Push. It uses the same switch as Pay for Me (`NEXT_PUBLIC_PAYFORME_ENABLED=1`); no new environment variable.
3. If you raise `PFM_MAX_TOTAL_NGN`, also set `NEXT_PUBLIC_PFM_MAX_TOTAL_NGN` to the same number so the giver's page shows the right limit.

If the switch is on but 0025 hasn't been run, `/giveaway/link` shows "opening soon" and nothing can be created.

### Rules built in
- Limits are enforced in the database itself, inside one locked step: the number of people, the total (bills + fees must stay under `PFM_MAX_TOTAL_NGN`), the most each person can choose, what may be chosen, and one place per meter / number. Tested with 8 people joining at the same instant for 2 places: exactly 2 got in.
- What a person picked is classified from the bills provider's own record, not from what their browser says.
- Closing is claimed once: two taps (or two devices) at the same moment make one giveaway, never two. Closing again just returns the same giveaway.
- If a choice fails its re-check at close, nothing is closed and the giver is told whose it was ("Ada's choice didn't pass the check… Remove Ada and close again.").
- Nobody else sees the list: the public link shows only who it's from, what's on offer and how many places are taken. Each person's token is shown only on the device they joined from (a secret key kept on that phone).
- Rate limits: 6 links per hour and 5 joins per hour per connection.
- Unclosed links expire after 7 days (daily reconcile cron).
- Removing a person frees their place; a removed person sees that they're off the list and may join again while it's open.

### Test it
1. Make a link with ₦100 airtime allowed, 2 people.
2. Open the link on two phones, join with two of your own numbers.
3. On your private page, remove one, re-join, then close and pay.
4. Both phones should show Delivered. For a light token, check it shows on the phone that joined.

### Not in this version
- People can't change their choice after joining (the giver removes them, and they join again).
- The list can't be reopened after it's closed. If the giver doesn't pay, the giveaway expires after 7 days and everyone sees "didn't go ahead".
- Exam PINs aren't offered (same as Pay for Me).

## Exam PINs in Pay for Me, giveaways and giveaway links

JAMB and WAEC PINs (whatever `/exams` sells) can now go on an ask-to-pay list, a giveaway, and a giveaway link ("Exam PINs" in what people can choose).

- **It follows the exam switches.** The Exam PINs tab only appears when `EXAMS_ENABLED=1` and `NEXT_PUBLIC_EXAMS_ENABLED=1` and Paybeta is the bills provider, the same rule as `/exams`. With the switches off, nothing changes and any exam item is refused.
- **Prices and names come from Paybeta's own exam list on the server**, never from the browser. A changed price is refused ("That PIN's price has changed…").
- **Checks:** JAMB needs the candidate's profile code (letters and numbers); WAEC needs a phone number. There's no name lookup for exam PINs (same as `/exams`), so the page asks people to check twice.
- **Fee:** the normal exam fee (`NEXT_PUBLIC_EXAM_FEE_*`, default 2%, min ₦200, max ₦500), not the bill fee.
- **Delivery:** each PIN becomes an ordinary exam order and goes through the same buying code as `/exams`. The PIN (and serial) shows on the giver's page, in the emails, and on the student's own phone if they joined through a giveaway link.
- **Giveaway links:** the giver ticks "Exam PINs". If the amount each is below the cheapest PIN, the page warns them. Students choose the exact PIN; anything above the limit is hidden.
- No database change: no new migration for this.
