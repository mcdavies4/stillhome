// The status line: one short notice across the top of the site ("Paybeta is slow right now, deliveries may take a
// few minutes"). The founder sets or clears it from /admin/growth, no redeploy. Reading it never breaks a page.

import { supabaseAdmin } from "@/lib/supabase";

export type SiteStatus = { level: "info" | "warn"; message: string };
export const MAX_STATUS_LEN = 200;

export function cleanStatus(level: unknown, message: unknown): SiteStatus {
  const msg = String(message ?? "").replace(/[\u0000-\u001f\u007f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, MAX_STATUS_LEN);
  return { level: level === "warn" ? "warn" : "info", message: msg };
}

let cache: { at: number; v: SiteStatus | null } | null = null;
const TTL = 30_000;
export const resetStatusCache = () => { cache = null; };

/** The notice to show, or null when there is none. Cached for 30 seconds; any error means "no notice". */
export async function readStatus(now = Date.now()): Promise<SiteStatus | null> {
  if (cache && now - cache.at < TTL) return cache.v;
  let v: SiteStatus | null = null;
  try {
    const { data } = await supabaseAdmin().from("site_status").select("level,message").eq("id", 1).maybeSingle();
    const s = data ? cleanStatus((data as any).level, (data as any).message) : null;
    v = s && s.message ? s : null;
  } catch { v = null; }
  cache = { at: now, v };
  return v;
}

export async function writeStatus(level: unknown, message: unknown): Promise<SiteStatus> {
  const s = cleanStatus(level, message);
  const { error } = await supabaseAdmin().from("site_status").upsert({ id: 1, level: s.level, message: s.message, updated_at: new Date().toISOString() });
  if (error) throw error;
  resetStatusCache();
  return s;
}
