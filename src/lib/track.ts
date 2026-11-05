// src/lib/track.ts  (browser only)
// Sends a visit or an event to /api/hit. No cookies, no local id. It remembers where this tab's visit came from
// in memory only, so a later "looked up a meter" can be matched to the source (it resets on a full page reload).
import type { EventName } from "@/lib/analytics-shared";

type Landing = { s: string; m: string; c: string; r: string };
let landing: Landing | null = null;

function ctx(): Landing {
  if (landing) return landing;
  const q = new URLSearchParams(location.search);
  let r = "";
  try { r = document.referrer ? new URL(document.referrer).hostname : ""; } catch {}
  landing = {
    s: (q.get("utm_source") || q.get("ref") || "").slice(0, 30),
    m: (q.get("utm_medium") || "").slice(0, 30),
    c: (q.get("utm_campaign") || "").slice(0, 40),
    r: r.slice(0, 80),
  };
  return landing;
}

export function trackingOff(): boolean {
  try {
    if (localStorage.getItem("nolgic-notrack") === "1") return true;
  } catch {}
  const n = navigator as any;
  return n.doNotTrack === "1" || n.globalPrivacyControl === true;
}

function send(payload: Record<string, unknown>) {
  const body = JSON.stringify(payload);
  try {
    if (navigator.sendBeacon && navigator.sendBeacon("/api/hit", new Blob([body], { type: "text/plain" }))) return;
  } catch {}
  try { fetch("/api/hit", { method: "POST", body, keepalive: true, headers: { "content-type": "text/plain" } }).catch(() => {}); } catch {}
}

export function trackView(path: string) {
  try {
    if (typeof window === "undefined" || trackingOff() || path.startsWith("/admin")) return;
    send({ t: "v", p: path, w: window.innerWidth, ...ctx() });
  } catch {}
}

export function track(name: EventName, detail?: string) {
  try {
    if (typeof window === "undefined" || trackingOff() || location.pathname.startsWith("/admin")) return;
    send({ t: "e", n: name, d: (detail ?? "").slice(0, 24), p: location.pathname, w: window.innerWidth, ...ctx() });
  } catch {}
}
