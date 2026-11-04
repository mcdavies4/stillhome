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
