# Accounts: order history + saved meters on every device (migration 0027)

Customers sign in with a 6-digit code emailed to them (no passwords). They get:
- **Order history** for that email (last year, real paid orders; each opens its receipt/token page).
- **Saved meters, smartcards and numbers** that follow them to any device, with a one-tap **Pay** that fills the pay form and checks the account name again.

Paying never needs an account. Everything on the pay form works as before.

## One-time setup
1. Run `supabase/migrations/0027_accounts.sql` in the Supabase SQL editor.
2. In Vercel add:
   - `ACCOUNT_SECRET` = any long random string (32+ characters). Without it the feature stays off.
   - `RESEND_API_KEY` (and `RESEND_FROM` on your verified nolgic.com domain). The code is sent by email, so this must work.
   - `NEXT_PUBLIC_ACCOUNTS_ENABLED` = `1` to show "My account" in the menu and footer.
3. Redeploy. Test: open `/account`, enter your own email, enter the code.

## How it behaves
- Code: 6 digits, expires in 10 minutes, 5 wrong tries then locked, works once. Max 3 codes per email per hour.
- Session: signed cookie, 30 days, sign out clears it. Changing `ACCOUNT_SECRET` signs everyone out.
- The sign-in answer never says whether an email already has orders.
- Saving after a payment: if the customer is signed in, the save also goes to their account. If not, it stays on that device as before.
- On every sign-in the device's saved list is copied up to the account, and the account's list is copied back down. That is how "Pay again" appears on a new phone.
- Stored: email, nickname, provider, plan, number. **Not** stored: the account holder's name, tokens, card or bank details.
- Test orders and unpaid orders are hidden from history.

## Not in this version
"Pay all in one payment". Each saved item has its own one-tap Pay. Paying several bills in one charge needs a new multi-order payment path; do that as its own piece of work.

## Privacy
/legal has a new "Your account" line. The anonymous analytics are unchanged.
