// Nolgic account: sign in with a 6-digit code emailed to the customer (no passwords).
// Gives order history and saved meters/smartcards/numbers that follow the customer to any device.
//
// Safety rules kept here, in one place:
//  - the sign-in answer never says whether an email is already known (anyone can make an account just by owning an email)
//  - a code lives 10 minutes, allows 5 wrong tries, and works once
//  - the session is a signed, HttpOnly cookie (30 days). Without ACCOUNT_SECRET the whole feature is off.
//  - only what's needed to fill the pay form is stored. No owner names, no tokens, no card or bank details.

import { createHash, createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase";
import { appUrl, esc, sendMail, shell, type Mail } from "@/lib/mailer";
import { statusWord } from "@/lib/find-order";
import { parseSaved, MAX_SAVED, type Saved } from "@/lib/saved";

export const SESSION_COOKIE = "nolgic_acct";
export const FLAG_COOKIE = "nolgic_acct_on";      // readable by the page so it knows whether to show "Account", holds no secret
export const SESSION_DAYS = 30;
export const CODE_MINUTES = 10;
export const CODE_MAX_TRIES = 5;
export const CODES_PER_EMAIL_PER_HOUR = 3;
export const HISTORY_DAYS = 365;
export const HISTORY_MAX = 50;

export const secret = (): string | null => {
  const s = process.env.ACCOUNT_SECRET;
  return s && s.length >= 16 ? s : null;
};
export const accountsEnabled = () => !!secret();

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64url");
const unb64 = (s: string) => Buffer.from(s, "base64url").toString("utf8");
const sig = (data: string, key: string) => createHmac("sha256", key).update(data).digest("base64url");
const eq = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };

// ───────── session ─────────
export function signSession(email: string, now = Date.now()): string | null {
  const key = secret(); if (!key) return null;
  const payload = b64(JSON.stringify({ e: email, x: now + SESSION_DAYS * 86400_000 }));
  return `${payload}.${sig(payload, key)}`;
}

export function readSession(cookieHeader: string | null | undefined, now = Date.now()): string | null {
  const key = secret(); if (!key || !cookieHeader) return null;
  const m = cookieHeader.split(/;\s*/).find((c) => c.startsWith(SESSION_COOKIE + "="));
  const v = m?.slice(SESSION_COOKIE.length + 1); if (!v) return null;
  const [payload, mac] = v.split("."); if (!payload || !mac || !eq(mac, sig(payload, key))) return null;
  try {
    const o = JSON.parse(unb64(payload));
    return typeof o?.e === "string" && Number(o.x) > now ? o.e : null;
  } catch { return null; }
}

const cookieBase = (secure: boolean) => `Path=/; SameSite=Lax${secure ? "; Secure" : ""}`;
export function sessionCookies(email: string, secure = process.env.NODE_ENV === "production", now = Date.now()): string[] {
  const v = signSession(email, now); if (!v) return [];
  const age = SESSION_DAYS * 86400;
  return [`${SESSION_COOKIE}=${v}; ${cookieBase(secure)}; HttpOnly; Max-Age=${age}`, `${FLAG_COOKIE}=1; ${cookieBase(secure)}; Max-Age=${age}`];
}
export const clearCookies = (secure = process.env.NODE_ENV === "production"): string[] => [
  `${SESSION_COOKIE}=; ${cookieBase(secure)}; HttpOnly; Max-Age=0`, `${FLAG_COOKIE}=; ${cookieBase(secure)}; Max-Age=0`,
];

/** Rejects cross-site form posts: the browser's Origin (when sent) must be this site. */
export function sameOrigin(req: Request): boolean {
  const o = req.headers.get("origin"); if (!o) return true;
  try { return new URL(o).host === (req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? new URL(req.url).host); } catch { return false; }
}

// ───────── codes ─────────
export const makeCode = () => String(randomInt(0, 1_000_000)).padStart(6, "0");
export const hashCode = (email: string, code: string) => createHash("sha256").update(`${secret()}|${email}|${code}`).digest("hex");
const emailHash = (e: string) => createHash("sha256").update(e).digest("hex").slice(0, 20);

export function codeEmail(code: string): Mail {
  return {
    subject: `${code} is your Nolgic code`,
    html: shell({
      title: "Your Nolgic sign-in code",
      bodyHtml: `<p style="font-size:34px;font-weight:800;letter-spacing:6px;margin:18px 0">${esc(code)}</p><p>Enter this code on nolgic.com to see your orders and saved meters. It works once and expires in ${CODE_MINUTES} minutes.</p><p>If you didn't ask for it, ignore this email. Nobody can sign in without it.</p>`,
      footerHtml: "Never share this code. Nolgic will never ask you for it.",
    }),
    text: `Your Nolgic sign-in code is ${code}. It works once and expires in ${CODE_MINUTES} minutes. If you didn't ask for it, ignore this email. Open ${appUrl()}/account to enter it.`,
  };
}

export async function requestCode(email: string, ip: string, now = Date.now()): Promise<"sent" | "throttled" | "mail_failed" | "disabled"> {
  if (!accountsEnabled()) return "disabled";
  const db = supabaseAdmin();
  const route = `acct-code:${emailHash(email)}`;
  try {
    const since = new Date(now - 3600_000).toISOString();
    const { count } = await db.from("request_log").select("id", { count: "exact", head: true }).eq("route", route).gte("created_at", since);
    if ((count ?? 0) >= CODES_PER_EMAIL_PER_HOUR) return "throttled";
    await db.from("request_log").insert({ ip, route });
  } catch (e) { console.error("[account] throttle check failed", e); }
  const code = makeCode();
  await db.from("account_codes").delete().eq("email", email);
  const { error } = await db.from("account_codes").insert({ email, code_hash: hashCode(email, code), expires_at: new Date(now + CODE_MINUTES * 60_000).toISOString(), tries: 0 });
  if (error) { console.error("[account] code save failed", error.message); return "mail_failed"; }
  return (await sendMail(email, codeEmail(code))) ? "sent" : "mail_failed";
}

export async function verifyCode(email: string, code: string, now = Date.now()): Promise<{ ok: true } | { ok: false; reason: "bad" | "expired" | "locked" | "disabled" }> {
  if (!accountsEnabled()) return { ok: false, reason: "disabled" };
  if (!/^\d{6}$/.test(code)) return { ok: false, reason: "bad" };
  const db = supabaseAdmin();
  const { data } = await db.from("account_codes").select("*").eq("email", email).maybeSingle();
  const row = data as { code_hash: string; expires_at: string; tries: number } | null;
  if (!row) return { ok: false, reason: "expired" };
  if (new Date(row.expires_at).getTime() < now) { await db.from("account_codes").delete().eq("email", email); return { ok: false, reason: "expired" }; }
  if (row.tries >= CODE_MAX_TRIES) return { ok: false, reason: "locked" };
  if (!eq(hashCode(email, code), row.code_hash)) {
    await db.from("account_codes").update({ tries: row.tries + 1 }).eq("email", email);
    return { ok: false, reason: row.tries + 1 >= CODE_MAX_TRIES ? "locked" : "bad" };
  }
  await db.from("account_codes").delete().eq("email", email);
  return { ok: true };
}

// ───────── order history ─────────
export type HistoryOrder = { id: string; name: string; tail: string; amountNgn: number; status: string; statusText: string; at: string };
export const orderName = (n: string | null) => String(n ?? "Order").replace(/\s+VTU$/i, "").trim() || "Order";

export async function accountOrders(email: string, now = Date.now()): Promise<HistoryOrder[]> {
  const since = new Date(now - HISTORY_DAYS * 86400_000).toISOString();
  const { data } = await supabaseAdmin().from("orders")
    .select("id,biller_name,identifier,amount_ngn,status,created_at,is_test")
    .eq("email", email).gte("created_at", since).order("created_at", { ascending: false }).limit(HISTORY_MAX + 20);
  return ((data ?? []) as any[])
    .filter((o) => !o.is_test && o.status !== "expired" && o.status !== "pending_payment")
    .slice(0, HISTORY_MAX)
    .map((o) => ({ id: o.id, name: orderName(o.biller_name), tail: o.identifier && String(o.identifier).length > 4 ? `…${String(o.identifier).slice(-4)}` : String(o.identifier ?? ""), amountNgn: Number(o.amount_ngn) || 0, status: o.status, statusText: statusWord(o.status), at: o.created_at }));
}

// ───────── saved accounts ─────────
const toRow = (email: string, s: Saved) => ({
  email, nickname: s.nickname, tab: s.tab, biller_code: s.billerCode, biller_name: s.billerName, item_code: s.itemCode,
  item_key: s.itemKey, item_name: s.itemName, identifier: s.identifier, label: s.label,
});
const fromRow = (r: any): Saved => ({
  id: r.id, nickname: r.nickname, tab: r.tab, billerCode: r.biller_code, billerName: r.biller_name, itemCode: r.item_code, itemKey: r.item_key,
  itemName: r.item_name, identifier: r.identifier, label: r.label, ownerName: null, at: new Date(r.used_at ?? r.created_at).getTime() || 0,
});

export async function listSaved(email: string): Promise<Saved[]> {
  const { data } = await supabaseAdmin().from("account_saved").select("*").eq("email", email).order("used_at", { ascending: false }).limit(MAX_SAVED);
  return ((data ?? []) as any[]).map(fromRow);
}

/** Adds items (or renames ones already there). Anything malformed is dropped; never more than MAX_SAVED in total. */
export async function addSavedItems(email: string, items: unknown[]): Promise<{ added: number; full: boolean }> {
  const db = supabaseAdmin();
  const clean = parseSaved(items.slice(0, MAX_SAVED).map((x, i) => ({ ...(x as object), id: `x${i}` }))); // validates every field
  let existing = await listSaved(email);
  let added = 0, full = false;
  for (const s of clean) {
    const hit = existing.find((e) => e.billerCode === s.billerCode && e.itemCode === s.itemCode && e.identifier === s.identifier);
    if (hit) { await db.from("account_saved").update({ nickname: s.nickname, item_key: s.itemKey, item_name: s.itemName, biller_name: s.billerName }).eq("id", hit.id).eq("email", email); continue; }
    if (existing.length >= MAX_SAVED) { full = true; continue; }
    const { error } = await db.from("account_saved").insert(toRow(email, s));
    if (!error) { added++; existing = [...existing, s]; }
  }
  return { added, full };
}

export async function removeSavedItem(email: string, id: string) {
  await supabaseAdmin().from("account_saved").delete().eq("id", id).eq("email", email);
}
export async function touchSavedItem(email: string, id: string, now = Date.now()) {
  await supabaseAdmin().from("account_saved").update({ used_at: new Date(now).toISOString() }).eq("id", id).eq("email", email);
}
