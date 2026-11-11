# Nolgic on Telegram

Customers chat with the bot, pick light / TV / airtime / data, send the meter, smartcard or phone number, see the
name, get a Paystack payment link, and receive the token or top-up in the same chat. If delivery fails they are
refunded in full, and the chat says so.

The bot never touches money. It creates an ordinary Nolgic order and a Paystack link. Payment confirmation,
delivery and refunds are the same server-verified pipeline the website uses (webhook is only a nudge, Paystack is
asked directly, amount and reference are checked, the order is claimed once). Telegram orders are stored with
`source = 'telegram'`.

## What's new

- `supabase/migrations/0028_telegram_bot.sql` — tables `tg_users`, `tg_updates`, `tg_orders`
- `src/lib/tg/` — `api.ts` (Telegram client), `engine.ts` (the conversation), `order.ts` (order + payment link),
  `notify.ts` (delivery / refund / review messages and the sweep), `remind.ts` (top-up reminders), `deps.ts` (wiring)
- `src/app/api/telegram/webhook` — Telegram calls this for every message and button tap
- `src/app/api/telegram/setup` — registers the webhook and the command menu (one call)
- `src/app/api/cron/telegram` — sweep for late tokens and orders resolved by hand
- `src/app/telegram` — `nolgic.com/telegram` opens the bot (for bios, posts and the rep)
- `src/lib/fulfil-order.ts` — 8 added lines: after an outcome, tell the Telegram chat (does nothing for web orders)
- `src/lib/reminders.ts` — 2 added lines: the top-up reminder also goes to the customer's Telegram chat

## Set it up (about 15 minutes)

### 1. Make the bot
In Telegram open **@BotFather**, send `/newbot`, give it a name (`Nolgic`) and a username that ends in `bot`
(for example `NolgicBot`). BotFather replies with a **token** like `123456789:AA...`. Keep it private.
Also send `/setuserpic` (the Nolgic logo), `/setdescription` ("Pay light, TV, airtime and data bills in naira.
Fast, with refunds if anything fails.") and `/setabouttext`.

### 2. Run the migration
Supabase -> SQL editor -> paste `supabase/migrations/0028_telegram_bot.sql` -> Run. Safe to run twice.

### 3. Vercel environment variables (Production)
| Name | Value |
| --- | --- |
| `TELEGRAM_BOT_TOKEN` | the token from BotFather |
| `TELEGRAM_WEBHOOK_SECRET` | any random string, 16+ letters/digits/`_`/`-`. In Terminal: `openssl rand -hex 24` |
| `NEXT_PUBLIC_TELEGRAM_BOT_USERNAME` | the username without the @ (for example `NolgicBot`) |

Optional: `SUPPORT_EMAIL` (shown in /help, default `nolgichq@gmail.com`). `NEXT_PUBLIC_SUPPORT_WHATSAPP` (already used
elsewhere) adds a "WhatsApp a person" button in /help.

### 4. Deploy
Merge the branch to `main` (or push it first as a Preview). Wait for the deployment to finish.

### 5. Register the webhook (once)
In Terminal (use your real CRON_SECRET):
```
curl -H "Authorization: Bearer YOUR_CRON_SECRET" https://www.nolgic.com/api/telegram/setup
```
Good answer: `{"ok":true,"username":"NolgicBot","webhook":"https://www.nolgic.com/api/telegram/webhook","pending":0,"lastError":null,...}`.
Run it again whenever you change the secret or the domain.

### 6. Add one cron job (cron-job.org)
`https://www.nolgic.com/api/cron/telegram` every 10 minutes, header `Authorization: Bearer YOUR_CRON_SECRET`.
It sends a token that landed late and any order you fixed by hand. Safe to run as often as you like.

### 7. Test with real money (₦100 airtime)
Open `https://t.me/YourBotUsername`, tap Start -> Airtime -> your own number -> ₦100 -> email -> Pay. Pay on Paystack.
The airtime and a "Done!" message should arrive within a minute. Then test **My orders** and **Buy again**.
Tell me what you see before you share it.

## How it behaves
- **Buttons everywhere**, typing only for the number, amount and email. `/start`, `/buy`, `/orders`, `/help`, `/cancel`, `/email`.
- **Light**: pick the company (and prepaid / postpaid), meter number, name check, amount (minimum comes from the meter),
  confirm, pay. **TV**: provider, smartcard, name check, package list (8 per page, cheapest first). **Airtime**: network,
  number, amount (warns if the number usually belongs to another network). **Data**: network, number, bundle list.
  **Exam PINs** open the website page.
- **Email** is asked once, for the receipt (and so the reminder and follow-up features keep working).
- **Same fees and limits as the website** (airtime/data 1%, TV 1.5%, light 1.5%, ₦30,000 max by default).
- **Back-soon notice** when the Paybeta wallet can't cover the order, before any payment link exists.
- **"I've paid" button** asks Paystack directly (same safety net as the order page), so a missed webhook never leaves
  anyone waiting.
- **Outcome messages**: delivered (token in tap-to-copy format), token on the way (sent later by the sweep), refunded in
  full, being checked, and a refund that needs a manual step (asks them to quote the ref).
- **Top-up reminders** reach Telegram too, for customers who use the bot with the same email. Same timing, opt-out
  and one-per-payment rules as the email (it is only sent after the email goes out).

## Safety
- Webhook accepts only calls carrying the secret Telegram was given. Wrong or missing -> 401, nothing happens.
- Telegram retries are de-duplicated by update id. A double tap on Pay never makes two orders.
- A chat can have at most 4 unpaid orders open in an hour. 25 messages a minute per chat, then it slows down.
- Names, numbers and provider text are HTML-escaped before they go into a message. Provider error text is never shown.
- Only the chat that placed an order can ask about it.
- A customer who blocks the bot is marked and skipped; the order still completes and the email receipt still goes out.
- Telegram messages are not end-to-end encrypted. A meter token is single-use credit for one meter, the same as the
  receipt email, so this is acceptable, but don't use the bot for anything more sensitive.

## Not in version 1
Bulk airtime, Pay for Me and giveaway links (they stay on the website), referral credit and rep tracking inside the bot,
and typed shortcuts like "again 5k". Say the word and I'll add any of them.

## Troubleshooting
- Bot silent -> Vercel logs, search `[telegram]`. Re-run the setup curl and read `lastError` and `pending`.
- Setup says `Set TELEGRAM_WEBHOOK_SECRET` -> use only letters, digits, `_` and `-`, 16+ characters.
- Telegram says 401 / logs show "Forbidden" -> the secret in Vercel changed after you registered; run the setup curl again.
- "I can't load the list just now" -> the bills provider's list failed; it retries on its own within minutes.
- To switch the bot off without a redeploy: `curl https://api.telegram.org/bot<TOKEN>/deleteWebhook`. Orders already in
  progress still finish (the website side doesn't depend on Telegram).

## Website links

The homepage hero, the header menu and the footer show "Nolgic on Telegram" buttons once `NEXT_PUBLIC_TELEGRAM_BOT_USERNAME` is set. Each opens the bot with a place tag (`?start=hero`, `header`, `footer`). Unset the variable and the buttons disappear.
