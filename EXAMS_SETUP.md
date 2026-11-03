# Exam PINs (JAMB / WAEC) — setup

No SQL needed. Exam orders use the normal `orders` table and the normal pay -> vend -> receipt pipeline,
so refunds, "held for review" and the Paybeta webhook all work exactly as they do for electricity.

## 1. Turn it on (Vercel > Settings > Environment Variables, then redeploy)

| Variable | Value | What it does |
|---|---|---|
| `EXAMS_ENABLED` | `1` | lets the checkout run |
| `NEXT_PUBLIC_EXAMS_ENABLED` | `1` | shows the /exams page and the "Exam PINs" menu link |
| `NEXT_PUBLIC_EXAM_FEE_PCT` | `2` (default) | fee is this % of the PIN price ... |
| `NEXT_PUBLIC_EXAM_FEE_MIN` | `200` (default) | ... never below this ... |
| `NEXT_PUBLIC_EXAM_FEE_MAX` | `500` (default) | ... never above this |
| `NEXT_PUBLIC_EXAM_MAX_ORDER` | `60000` (default) | biggest PIN order |

The fee settings are optional. Paybeta's JAMB commission is a flat ₦150, so keep the minimum fee at ₦200 or more.
Needs `BILLS_PROVIDER=paybeta` (already set). Prices always come from Paybeta's own list, never from the browser.

## 2. Before you open it to customers

Ask Paybeta (support or your account manager):

1. What must `customerId` be for **WAEC registration** and **WAEC result checker**? (The page asks for a phone number; JAMB asks for the profile code.)
2. What are the field names of the PIN (and serial) in the purchase response and in the webhook? The docs don't show them.
3. Are WAEC and NECO live for API customers, and what are the prices and your commission for each?
4. If the profile code is wrong, is the vend rejected before it is charged?

## 3. First live test

1. Open `/exams` and buy the cheapest PIN with a real profile code or number.
2. The PIN should appear on the order page and in the email.
3. If Paybeta answers "successful" but the PIN fields aren't ones Nolgic recognises, the order is **held for review** (not refunded, not marked delivered) and you get an alert saying "no PIN was readable" with the field names. Read the PIN in the Paybeta console, send it to the customer, then send me the field names and I'll add them.

## 4. What the customer sees

* `/exams` — choose the PIN, type the profile code twice, email, pay.
* `/exams/<order id>` — the PIN with copy buttons (also emailed).
* A clear "profile code does not exist" rejection is refunded automatically. Anything unclear (timeouts, pending, unknown answers) is held for review and you are alerted; it is never refunded on a guess.
