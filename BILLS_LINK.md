# Bills link

One permanent link per person, for example `nolgic.com/for/ada`. Family and friends open it, choose what to pay (light, TV,
airtime, data) and how much, and pay in naira. It is delivered to the owner like any other payment.

## Switching it on

1. Pay for Me must already be live (`0023`, `NEXT_PUBLIC_PAYFORME_ENABLED=1`).
2. Run `supabase/migrations/0031_bills_link.sql` in the Supabase SQL editor (safe to run more than once). Run it **before** merging.
3. Add `NEXT_PUBLIC_BILLSLINK_ENABLED=1` in Vercel (and redeploy) to show the bills link on the home page, the strip above the headline and the More menu. The `/for` pages work without it; this switch only controls where the link is promoted.
4. Merge. Nothing else to set. Until the SQL is run the pages say "opening soon" and the Telegram button says the same.

## What it is built on

Every payment on a link is an ordinary Pay for Me request (`createPayRequest` / `startPayRequestPayment`), so delivery,
tokens, receipts, refunds and the "needs review" handling are exactly the ones you already trust. The only additions are the
link itself (`pay_links`, `pay_link_items`) and `pay_requests.link_id`, which says which link a request came from.

## What people see, and don't

Public page (`/for/<slug>`): the display name the owner chose, their message, each item's label, plan and the **last 4
digits**. Never the full meter or phone number, never the name on the account, never the owner's email or Telegram chat.
The full number stays on the server and is used only when someone pays.

## Where it lives

| What | Where |
| --- | --- |
| Landing, make a link | `/for`, `/for/new` |
| Public pay page | `/for/<slug>` |
| Owner's private page (pause, resume, delete, who paid) | `/for/<slug>/manage?k=<secret>` (the secret is given once, when the link is made) |
| Telegram | Menu > 🔗 My bills link, or `/billslink`. Built from the person's ⭐ Saved list |
| Code | `src/lib/paylink.ts`, `src/app/api/paylink/*`, `src/app/for/*`, `src/lib/tg/billslink.ts` |

## Limits

- Up to 3 things per link, up to 3 active links per Telegram chat or email.
- Exam PINs can't be put on a link.
- Per IP: 5 links an hour, 8 payment starts per 10 minutes. Per link: 6 unfinished payments an hour (then "try again in a few minutes").
- A paused link refuses payments (the page says so); a deleted link is a 404. Payments already made are not affected by either.

## The owner is told

Telegram owners get a message when someone pays ("Uncle Chika paid ₦5,000 toward your bills") and another when it is
delivered, with the token for light. Owners who gave an email also get the usual Pay for Me email with their tokens. The
payer's name is HTML-escaped before it is sent.

## For reps

Pitch: "give your family one link". The owner makes it once, then sends it on WhatsApp whenever they need light or data.
