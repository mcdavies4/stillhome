# Growth features: find my order, WhatsApp share, support button, status line, top-up reminders, referrals

Everything here sits beside the payment path. None of it changes how an order is paid or delivered.
(Referrals can lower the service fee on an order, but only when you switch it on.)

## 1. Database (once)
Supabase -> SQL editor -> run `supabase/migrations/0022_growth.sql`. Safe to run twice.
(Also run 0020 and 0021 if you have not.)

## 2. What each one does

**Find my order** (`/find-order`, linked in the menu, the footer and the order page)
The customer types the email they paid with. We EMAIL them links to their last orders (90 days, up to 8, real orders only).
The page never says whether an address has orders, so it cannot be used to find out who your customers are.
Limits: 3 emails per address per hour, 6 tries per IP per 15 minutes. The email holds links, not the token or full meter number.

**Send to family on WhatsApp** (delivered order page)
One tap opens WhatsApp with the token, meter number and amount already written. The customer's own WhatsApp sends it.
No bot, no WhatsApp API, nothing sent by us.

**Message us on WhatsApp** (order page and Find my order)
Opens WhatsApp to YOUR number with the order number filled in. Set `NEXT_PUBLIC_SUPPORT_WHATSAPP` in Vercel
(country code then number, digits only, e.g. `2348012345678`) and redeploy. Not set = no button (email link stays).
Use a real person's number. The old WhatsApp bot number is not used.

**Site notice** (`/admin/growth`, sign in at /admin first)
One line across the top of every public page, for example "Deliveries are a little slow today. Your payment is safe."
Choose Information or Heads-up (amber). Clear it when done. It appears within a minute. No redeploy.

**Top-up reminders**
One email when light or TV is probably running low: after the customer's own usual gap for that meter or card
(or 21 days for light, 28 for TV if it is their first), at most 10 days late. Never airtime or data. Never twice for the same
order, never more than one a week per person, only 09:00 to 19:00 UK time, 25 a run. Every email has a "Stop these
reminders" button (a button, so email scanners cannot unsubscribe anyone).
Set it running: free outside scheduler (cron-job.org), once a day around 10:00 UK time:
- URL `https://www.nolgic.com/api/cron/reminders`  Method GET
- Header `Authorization: Bearer <your CRON_SECRET>` (the one already in Vercel)
Add one line to /legal: "If you buy light or TV from us, we may email you one reminder when it may be running low. Every
email has a button to stop them." Ask your accountant to confirm it fits the NDPA and the UK's PECR for your setup.

**Referrals (switched OFF until you turn it on)**
A friend's first order through an invite link has no service fee. When that order is delivered, the person who invited them
gets the service fee waived on their next order. A credit is only ever a waived fee, never cash, and never more than
`REFERRAL_MAX_WAIVE_NGN` (default 500). Credits come back by themselves if the order using them fails or is never paid.
Limits: one invite per person ever, own code does nothing, existing customers get nothing, test orders never earn credit,
10 friends per person (`REFERRAL_MAX_PER_PERSON`). The invite card appears on a delivered order. See the count and the
fees waived at `/admin/growth`.
Turn on: `NEXT_PUBLIC_REFERRALS_ENABLED=1` in Vercel, redeploy. Recommendation: switch it on after the first week, once real
orders are flowing and you know your margin, and keep the cap at ₦500 or lower.

## 3. Push (PowerShell, from the stillhome folder)
This zip already contains the restocking notice, so you do not need the earlier restocking zip.

    cd C:\Users\a\Documents\stillhome
    Expand-Archive -Force $env:USERPROFILE\Downloads\nolgic-growth-features.zip .
    git add -A
    git commit -m "Find my order, WhatsApp share and support, site notice, top-up reminders, referrals (off), restocking notice"
    git push origin main

Then run `0022_growth.sql` in Supabase, set `NEXT_PUBLIC_SUPPORT_WHATSAPP`, and set up the reminders scheduler.

## 4. Check it works (5 minutes)
1. /find-order with your own email: the email arrives with a link to your last order.
2. Open a delivered order: "Send on WhatsApp" opens WhatsApp with the token written. "Message us on WhatsApp" opens your number.
3. /admin/growth: type a notice, Show notice, load the home page in a private window, then Clear notice.
4. Reminders: after the scheduler runs, the JSON it returns shows how many were sent (or call the URL yourself with the Bearer header).
5. Restocking test from RESTOCKING_NOTICE.md (temporary `WALLET_RESERVE_NGN=99999999`, then remove it).

## 5. Not included
The Android app does not have these yet (builds are blocked on the Free plan until 1 December). The web is first.
