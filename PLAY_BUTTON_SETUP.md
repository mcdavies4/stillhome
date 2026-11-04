# Google Play links on nolgic.com

New: `src/lib/app-links.ts`, `src/components/GetOnPlay.tsx`, `src/components/AndroidBanner.tsx`.
Changed: `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/order/[id]/page.tsx`. No database change, no new setting.

Where it shows
- Android phone browsers only: a slim "Nolgic for Android / Install" strip at the very top. Closing it hides it for 30 days.
  Not shown on desktop, iPhone, inside the app, or on admin and feedback pages.
- Header: "Get the app" (tablet and desktop).
- Home page: a "Get it on Google Play" button under the three checks.
- Footer: "Android app on Google Play".
- After a delivered order: a small card with the button.

Every link carries a tag saying which button it came from (banner, hero, header, footer, order), so the Play Console shows
which one brings installs.

Optional: set NEXT_PUBLIC_PLAY_URL in Vercel only if the app's package name ever changes.
