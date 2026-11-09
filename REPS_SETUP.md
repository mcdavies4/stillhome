# Sales rep links (migration 0026)

Gives every sales rep their own link so you can see what their marketing brings in. It is for measuring only:
nothing is owed or paid from Nolgic (reps are paid outside, e.g. on Fiverr).

## One-time setup
1. Run `supabase/migrations/0026_reps.sql` in the Supabase SQL editor (already done if you merged the first rep release).
2. Open **/admin -> Sales reps**, enter a code and name, save.
3. Give the rep their link, e.g. `https://nolgic.com/?rep=chika`.

## What you see per rep
Visits, meter/number checks, taps on Pay, orders, delivered orders, customers, new customers and money delivered, for the last 7, 30 or 90 days.
Recent orders show a masked email. Switch a rep off to stop their link tagging new orders (past orders keep the tag).

## How it counts
- A visitor who opens a rep link is remembered in their browser for 30 days. The first rep link they open is the one counted.
- An order is tagged when it is created, only if the rep exists and is switched on.
- New customer = the rep's delivered order is that email's first delivered order anywhere. Test orders are ignored.
- Visits come from the cookieless analytics, so treat them as a guide. Orders and money are exact.
- If the migration hasn't run, payments still work normally. Orders just aren't tagged.

## Not tagged yet
Pay for Me, giveaway claims and bulk airtime orders. Regular bill payments and exam PINs are tagged.

## Brief for the rep
- Use only your own link, unchanged. Customers must open it in the same browser they pay in.
- Don't promise giveaways or discounts until we confirm they are live.
- No admin access. We share figures with you.
- Don't post customers' meter numbers, emails or receipts anywhere.

## Privacy
/legal says partner links are remembered for 30 days in the browser. No cookies are set. The report masks customer emails.
