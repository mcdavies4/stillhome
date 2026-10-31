// src/lib/security.ts
// Small shared security helpers: constant-time secret comparison, fail-closed
// cron auth, and strict input normalisers for public endpoints.

import { createHash, timingSafeEqual } from "node:crypto";

/** Constant-time string comparison (hashes first so lengths never leak). */
export function safeEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

/**
 * Cron / scheduled-job auth. FAILS CLOSED: if CRON_SECRET is not configured,
 * nobody is authorised (previously an unset secret left every cron open).
 * Vercel sends `Authorization: Bearer $CRON_SECRET` when the env var is set.
 */
export function cronAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return safeEqual(req.headers.get("authorization"), `Bearer ${secret}`);
}

const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[A-Za-z]{2,}$/;

/** Lower-cased, trimmed, validated email — or null. */
export function normaliseEmail(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const e = v.trim().toLowerCase();
  return e.length <= 254 && EMAIL_RE.test(e) ? e : null;
}

/** Phone in loose international form (digits, optional leading +, 8–15 digits) — or null. */
export function normalisePhone(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const p = v.replace(/[\s\-().]/g, "");
  return /^\+?\d{8,15}$/.test(p) ? p : null;
}

/**
 * A mobile number in international form. People type it the local way (0903 774 5486), so a number
 * without a country code gets the code of the country they are paying in (Nigeria +234, Ghana +233).
 * Anything that isn't a clear local number is returned as typed (already valid by normalisePhone).
 */
export function toInternationalPhone(v: unknown, country: string = "NG"): string | null {
  const n = normalisePhone(v);
  if (!n) return null;
  if (n.startsWith("+")) return n;
  if (n.startsWith("00")) return `+${n.slice(2)}`;
  const dial = country === "GH" ? "233" : "234";
  const len = country === "GH" ? 9 : 10; // digits after the leading 0
  if (n.startsWith("0") && n.length === len + 1) return `+${dial}${n.slice(1)}`;
  if (n.startsWith(dial) && n.length === dial.length + len) return `+${n}`;
  if (n.length === len) return `+${dial}${n}`;
  return n;
}

/** String with a hard length cap; non-strings become "". */
export function cap(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
