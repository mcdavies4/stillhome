// src/lib/analytics-shared.ts
// Client-safe helpers for the first-party visit counter. Nothing here touches a cookie or any stored id.

export const EVENT_NAMES = ["tab", "lookup_ok", "checkout_click", "play_click", "share_click", "support_open", "find_order", "ask_created"] as const;
export type EventName = (typeof EVENT_NAMES)[number];

const DYNAMIC_ROOTS = new Set(["order", "r", "bulk", "exams", "feedback", "reminders"]);
const IDLIKE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$|^[0-9a-f]{20,}$/i;

/** A page path with ids and tokens removed, or null for pages we never count (admin, api). */
export function normalizePath(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.startsWith("/") || raw.startsWith("//")) return null;
  let p = raw.split("#")[0].split("?")[0].slice(0, 120);
  if (!p) return null;
  const parts = p.split("/").filter(Boolean).slice(0, 6);
  if (parts[0] === "admin" || parts[0] === "api" || parts[0] === "_next") return null;
  const out = parts.map((seg, i) => ((i === 1 && DYNAMIC_ROOTS.has(parts[0])) || IDLIKE.test(seg) ? ":id" : seg.toLowerCase().replace(/[^a-z0-9_.:\-]/g, "").slice(0, 40)));
  return "/" + out.join("/");
}

const clean = (s: unknown, max: number) => (typeof s === "string" ? s.toLowerCase().replace(/[^a-z0-9_.\-]/g, "").slice(0, max) : "");

const ALIAS: Record<string, string> = { ig: "instagram", fb: "facebook", wa: "whatsapp", tw: "x", twitter: "x", yt: "youtube", li: "linkedin", tt: "tiktok" };

const HOSTS: [RegExp, string][] = [
  // Specific Google sites first, before the general "google" search rule.
  [/^play\.google\.com$/, "google-play"], [/^mail\.google\.com$|outlook\.(live|office)\.com$/, "email"],
  [/(^|\.)google\.[a-z.]+$/, "google"], [/(^|\.)bing\.com$/, "bing"], [/duckduckgo\.com$/, "duckduckgo"], [/yahoo\./, "yahoo"],
  [/instagram\.com$/, "instagram"], [/(^|\.)facebook\.com$|^fb\.com$|^l\.messenger\.com$/, "facebook"],
  [/^t\.co$|(^|\.)twitter\.com$|(^|\.)x\.com$/, "x"], [/^wa\.me$|whatsapp\.com$/, "whatsapp"],
  [/tiktok\.com$/, "tiktok"], [/youtube\.com$|^youtu\.be$/, "youtube"], [/linkedin\.com$|^lnkd\.in$/, "linkedin"],
  [/telegram\.org$|^t\.me$/, "telegram"],
];

/** Where a visit came from. "internal" means our own site (not counted as a source). */
export function classifySource(opts: { utm?: unknown; refHost?: unknown; ownHost?: string | null }): string {
  const u = clean(opts.utm, 30);
  if (u) return ALIAS[u] ?? u;
  let h = typeof opts.refHost === "string" ? opts.refHost.toLowerCase().replace(/^www\./, "").replace(/[^a-z0-9.\-]/g, "").slice(0, 80) : "";
  if (!h) return "direct";
  const own = (opts.ownHost ?? "").toLowerCase().replace(/^www\./, "").split(":")[0];
  if (own && (h === own || h.endsWith("." + own))) return "internal";
  if (h === "localhost") return "internal";
  for (const [rx, name] of HOSTS) if (rx.test(h)) return name;
  return h;
}
export const cleanTag = clean;

export function isBot(ua: string): boolean {
  return !ua || /bot\b|bot\/|crawl|spider|slurp|facebookexternalhit|preview|monitor|uptime|headless|lighthouse|pingdom|gtmetrix|curl|wget|python|node-fetch|axios|go-http|java\/|vercel|postman|insomnia|scrapy|httpclient|okhttp\/[0-9.]+ *$/i.test(ua);
}

export function deviceFrom(ua: string, width?: number): "mobile" | "tablet" | "desktop" {
  if (/ipad|tablet|kindle|silk/i.test(ua) || (/android/i.test(ua) && !/mobile/i.test(ua))) return "tablet";
  if (/mobi|iphone|ipod|android/i.test(ua)) return "mobile";
  if (typeof width === "number" && width > 0 && width < 700) return "mobile";
  return "desktop";
}

export function browserFrom(ua: string): string {
  if (/Instagram/i.test(ua)) return "Instagram app";
  if (/FBAN|FBAV|FB_IAB/i.test(ua)) return "Facebook app";
  if (/TikTok|musical_ly|Bytedance/i.test(ua)) return "TikTok app";
  if (/Edg(e|A|iOS)?\//.test(ua)) return "Edge";
  if (/OPR\/|Opera/.test(ua)) return "Opera";
  if (/SamsungBrowser/.test(ua)) return "Samsung Internet";
  if (/UCBrowser|UCWEB/.test(ua)) return "UC Browser";
  if (/Opera Mini|OPiOS/.test(ua)) return "Opera Mini";
  if (/Firefox|FxiOS/.test(ua)) return "Firefox";
  if (/Chrome|CriOS|Chromium/.test(ua)) return "Chrome";
  if (/Safari/.test(ua)) return "Safari";
  return "Other";
}

/** A link with campaign tags added, for the founder's link builder. */
export function tagLink(base: string, source: string, campaign: string): string {
  const u = new URL(base);
  const s = clean(source, 30), c = clean(campaign, 40);
  if (s) u.searchParams.set("utm_source", s);
  if (c) u.searchParams.set("utm_campaign", c);
  return u.toString();
}
