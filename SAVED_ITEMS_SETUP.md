# Saved meters, smartcards and numbers ("Pay again") - website

This zip is cumulative: it also contains the Google Play button files, so it is safe whether or not you already applied
nolgic-play-button.zip.

New:     src/lib/saved.ts, src/components/SavedList.tsx, src/components/SaveAfterPay.tsx
         (and, from the Play button zip) src/lib/app-links.ts, src/components/GetOnPlay.tsx, src/components/AndroidBanner.tsx
Changed: src/app/page.tsx, src/app/order/[id]/page.tsx, src/app/layout.tsx
No database change. No new setting.

How it works
- After a delivered order, the customer is offered "Save this meter on this device" with an optional nickname.
- On the pay form a "Pay again" row appears at the top. One tap selects the provider and plan, fills the number and checks the
  account name again before any payment.
- Stored only in the customer's own browser (localStorage). Nothing is saved on Nolgic's servers, so there is no new personal
  data to protect. Up to 20 items, each with a remove button. Not shared between devices.
- Only offered when that browser made the payment (a short-lived note is left when the customer taps Pay).
