# Sales reps: setup (migration 0026)

Gives every sales rep their own link. Every order that link brings in is tagged to them, and
/admin/reps shows visits, orders, new customers, money brought in and commission owed.

## One-time setup
1. Run `supabase/migrations/0026_reps.sql` in the Supabase SQL editor.
2. Deploy. No new environment variables.
3. Open **/admin → Sales reps**, fill in the form (code, name, commission per new customer) and save.
4. Copy the rep's link, e.g. `https://nolgic.com/?rep=chika`, and give it to them.

## How it counts
- A visitor who opens a rep link is remembered in their browser for **30 days**. The first rep keeps
  the credit: another rep's link does not take it over until the 30 days end.
- An order is tagged when it is created, only if the rep exists and is switched on.
- **New customer** = the rep's delivered order is that email's very first delivered order anywhere.
  Commission = new customers x the rep's commission. Returning customers and test orders earn nothing.
- Visits come from the cookieless analytics, so treat them as a guide. Orders and money are exact.
- A switched-off rep stops tagging new orders. Past orders keep their tag.
- If migration 0026 hasn't run, payments still work normally. Orders just aren't tagged.

## Not tagged yet (v1)
Pay for Me, giveaway claims and bulk airtime orders. Regular bill payments and exam PINs are tagged.

## Brief for the Fiverr rep
- Use only your own link. Don't edit it. Customers must open it in the same browser they pay in.
- Don't promise giveaways or discounts until we confirm they are live.
- You earn on **delivered** orders from **new** customers. Check your numbers with us weekly.
- You don't get admin access. We send you the figures.
- Don't post customers' meter numbers, emails or receipts anywhere.

## Privacy
/legal now says partner links are remembered for 30 days in the browser. No cookies are set.
The admin report masks customer emails.
