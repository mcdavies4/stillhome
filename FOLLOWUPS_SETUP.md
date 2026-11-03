# Abandoned-order follow-up emails

One short email, once per order, about an hour after someone starts an order and does not pay:
"Did something go wrong?" with a button to a one-tap reasons page. They can also just reply (replies go to nolgichq@gmail.com).
See what people said at **/admin/feedback**.

## 1. Database (once)
Supabase -> SQL editor -> run `supabase/migrations/0021_followups.sql`. Safe to run twice.

## 2. Make it run on time
The daily 8am job already sends any that are due, so nothing more is *required*. To email about an hour after the order
(much better for getting a real answer), call this every 30 minutes from a free outside scheduler such as cron-job.org:

- URL: `https://www.nolgic.com/api/cron/followups`
- Method: GET
- Header: `Authorization: Bearer <your CRON_SECRET>` (the same CRON_SECRET already set in Vercel)

It is safe to call as often as you like: each order is emailed once. It only sends between 08:00 and 21:00 Nigeria time.

## 3. Rules it follows
- Only orders that were started or expired 1 to 48 hours ago, never paid, never test orders.
- Never to someone who paid for anything since, who was emailed in the last 7 days, or who clicked "don't email me like this again".
- At most 25 per run. One email per order, ever. No account or meter numbers in the email.
- Clicking the link records nothing by itself (so email scanners can't create fake answers); the answer is saved when the person presses Send.

## 4. Privacy and compliance
This is a service message about an order the person started, with an opt-out in every email. Add one line to your privacy policy
(/legal): "If you start an order and don't finish it, we may send you one email asking what went wrong. You can opt out from the
email." Ask your accountant or lawyer to confirm this fits the Nigeria Data Protection Act for your setup.

## 5. Test it yourself
Start an order with your own email, don't pay, and wait over an hour (or ask Claude to run the sweep once in test mode).
