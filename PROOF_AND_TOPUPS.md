# Proof page and "running low" top-ups

No database change and no new settings. Deploy and it works.

## /proof (public)
Live numbers from your own order records: orders delivered, % of finished paid orders delivered, failed orders refunded in full,
paid orders still being delivered, and (if any) refunds you are fixing by hand. Last 30 days and since you started, plus bulk airtime.

- Counts only real paid naira orders. Test orders, abandoned checkouts and old pound orders are never counted.
- Updates every 5 minutes. Nothing on it can be edited by hand.
- If an automatic refund fails (`refund_failed`) it shows on the page as "being refunded by hand" until you fix it. That is deliberate.
- It is linked from the site menu ("Proof: delivery numbers") and the sitemap. Send reps and customers to `nolgic.com/proof`.
- It shows no "average delivery time": orders do not store the time the payment was confirmed, so that number would not be honest.

## Reminders: now before the light goes off
The top-up reminder email used to go out after a customer's usual gap had passed. It now goes out **2 days before** the predicted
run-out, and says so: "You usually top up about every 20 days, so it may run out around 12 Nov." Everything else is unchanged:
one email per payment, 7-day cooldown between emails, opt-out link, 09:00 to 19:00 UK time, electricity and TV only.
Needs the daily reminders job on cron-job.org (`/api/cron/reminders`).

## Account page: "Running low soon"
Signed-in customers see up to 4 meters or TV cards expected to need a top-up within 14 days, from the same prediction.
A saved meter gets a one-tap **Top up** / **Renew** button. An unsaved one links to its last receipt, where they can save it.
Only the last 4 digits of the meter are ever sent to the browser.
