// src/lib/analytics.ts  (server)
// Records one visit or event. Stores no IP address and no user agent. The visitor hash changes every day.
import crypto from "crypto";
import { supabaseAdmin } from "@/lib/supabase";
import { EVENT_NAMES, browserFrom, classifySource, cleanTag, deviceFrom, isBot, normalizePath } from "@/lib/analytics-shared";
import type { EventRow, OrderRow } from "@/lib/analytics-stats";

export function visitorId(ip: string, ua: string, day = new Date().toISOString().slice(0, 10)): string {
  const salt = process.env.ANALYTICS_SALT || process.env.CRON_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || "nolgic";
  return crypto.createHash("sha256").update(`${salt}|${day}|${ip}|${ua}`).digest("hex").slice(0, 16);
}

// Light per-server limit so one browser stuck in a loop can't flood the table. It resets when the server restarts.
const bucket = new Map<string, { n: number; t: number }>();
export function overLimit(key: string, max = 90, windowMs = 60_000, now = Date.now()): boolean {
  const b = bucket.get(key);
  if (!b || now - b.t > windowMs) { if (bucket.size > 5000) bucket.clear(); bucket.set(key, { n: 1, t: now }); return false; }
  b.n += 1;
  return b.n > max;
}

/** Turns a request body into a row, or null if it should not be counted. */
export function buildRow(req: Request, body: any): (Omit<EventRow, "created_at">) | null {
  const h = req.headers;
  const ua = h.get("user-agent") ?? "";
  if (isBot(ua)) return null;
  const path = normalizePath(body?.p);
  if (!path) return null;
  const ip = (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || h.get("x-real-ip") || "unknown";
  const w = Number(body?.w) || 0;
  const country = (h.get("x-vercel-ip-country") ?? "").toUpperCase();
  const base = {
    path, vid: visitorId(ip, ua),
    src: classifySource({ utm: body?.s, refHost: body?.r, ownHost: h.get("host") }),
    campaign: cleanTag(body?.c, 40) || null,
    country: /^[A-Z]{2}$/.test(country) ? country : null,
    device: deviceFrom(ua, w), browser: browserFrom(ua),
  };
  if (body?.t === "e") {
    const name = String(body?.n ?? "");
    if (!(EVENT_NAMES as readonly string[]).includes(name)) return null;
    return { ...base, kind: "event", name, detail: cleanTag(body?.d, 24) || null };
  }
  if (body?.t === "v") return { ...base, kind: "view", name: path, detail: null };
  return null;
}

/** Reads the last N days of rows (paged), plus orders for the paid-order count. Caps at 150,000 rows. */
export async function loadAnalytics(days: number) {
  const db = supabaseAdmin();
  const since = new Date(Date.now() - (Math.max(days, 7) + 1) * 86400_000).toISOString();
  const rows: EventRow[] = [];
  for (let from = 0; from < 150_000; from += 1000) {
    const { data, error } = await db.from("site_events")
      .select("created_at,kind,name,path,detail,vid,src,campaign,country,device,browser")
      .gte("created_at", since).order("created_at", { ascending: false }).range(from, from + 999);
    if (error) return { error, rows: [] as EventRow[], orders: [] as OrderRow[], capped: false };
    rows.push(...((data ?? []) as EventRow[]));
    if (!data || data.length < 1000) break;
  }
  const { data: orders } = await db.from("orders").select("created_at,status").gte("created_at", since).limit(20000);
  return { error: null, rows, orders: ((orders ?? []) as OrderRow[]), capped: rows.length >= 150_000 };
}
