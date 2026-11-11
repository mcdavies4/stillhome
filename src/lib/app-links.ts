// Where the Nolgic Android app lives. One place, so a link is never out of step.
// Override with NEXT_PUBLIC_PLAY_URL in Vercel if the package name ever changes.

const BASE = (process.env.NEXT_PUBLIC_PLAY_URL ?? "").trim() || "https://play.google.com/store/apps/details?id=com.nolgic.app";

/**
 * The Play Store link for a spot on the site. `place` is added as Google Play's install "referrer",
 * so the Play Console can show which button brought each install (header, hero, footer, ...).
 */
export function playUrl(place: string): string {
  const sep = BASE.includes("?") ? "&" : "?";
  const ref = encodeURIComponent(`utm_source=nolgic.com&utm_medium=web&utm_campaign=${place.replace(/[^a-z0-9_-]/gi, "")}`);
  return `${BASE}${sep}referrer=${ref}`;
}

/**
 * The Nolgic Telegram bot link for a spot on the site, or null when no bot is set up
 * (NEXT_PUBLIC_TELEGRAM_BOT_USERNAME). `place` rides along as the bot's /start tag.
 */
export function telegramUrl(place: string): string | null {
  const user = (process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME ?? "").replace(/^@/, "").trim();
  if (!/^[A-Za-z0-9_]{4,32}$/.test(user)) return null;
  return `https://t.me/${user}?start=${place.replace(/[^a-z0-9_-]/gi, "").slice(0, 32)}`;
}
