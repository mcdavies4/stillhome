# "We're restocking" notice (website)

When the bills wallet holds less than the order needs, new orders are paused BEFORE the customer pays and they see a calm
"We're restocking. Back in a few minutes. Nothing has been charged." card instead of an error. You get one email so you can top up.

## What changed
- `src/lib/capacity.ts` (new): checks the Paybeta (or active provider) wallet, cached 45 seconds. If the balance can't be read, or you're in sandbox/test mode, orders go ahead as before.
- `src/lib/back-soon.ts`, `src/components/BackSoon.tsx` (new): the message and the calm card.
- `src/app/api/checkout`, `/api/bulk/checkout`, `/api/exams/checkout`: ask the check before creating the order/payment link; answer 503 `{busy:true}` when low.
- `src/app/page.tsx`, `bulk/page.tsx`, `exams/page.tsx`: show the calm card for that answer. Every other error is still red.
- Includes the earlier saved-items and Play-button files, so this zip is cumulative.

## Settings (optional, in Vercel)
- `WALLET_RESERVE_NGN` (default 0): safety margin added to every order. Set 2000 to keep ₦2,000 untouched.
- `WALLET_LOW_NGN` (daily-check email alert level, default 20000): raise to about one day of sales.

## Push (PowerShell, inside your stillhome folder)
    Expand-Archive -Force $env:USERPROFILE\Downloads\nolgic-restocking-notice.zip .
    git add -A
    git commit -m "Pause new orders with a calm restocking notice when the bills wallet is low"
    git push origin main

## Test it
Temporarily set `WALLET_RESERVE_NGN` to a huge number, e.g. 99999999, redeploy, then try a payment: you should see the notice and get an email.
Then delete the setting and redeploy.
