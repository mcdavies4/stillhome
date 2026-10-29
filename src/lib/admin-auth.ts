// src/lib/admin-auth.ts
// Auth gate for the founder dashboard APIs (/api/admin, /api/admin/orders,
// /api/admin/check). Bearer <ADMIN_PASSWORD>, compared in constant time.
// Wrong guesses are throttled per IP: 10 failures / 10 min -> HTTP 429, and the
// lock is checked BEFORE the password, so a locked-out IP can't keep guessing.
// (Partner admin APIs use a separate header secret: see src/lib/admin.ts.)

import { supabaseAdmin } from "@/lib/supabase";
import { safeEqual } from "@/lib/security";

const MAX_FAILS = 10;
const WINDOW_MIN = 10;

function clientIp(req: Request): string {
  return (
    (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() ||
    req.headers.get("x-real-ip") ||
    "unknown"
  );
}

/** Returns a Response to send back if the caller is NOT allowed, otherwise null. */
export async function adminGate(req: Request): Promise<Response | null> {
  const ip = clientIp(req);
  const since = new Date(Date.now() - WINDOW_MIN * 60_000).toISOString();

  try {
    const { count } = await supabaseAdmin()
      .from("request_log")
      .select("id", { count: "exact", head: true })
      .eq("ip", ip)
      .eq("route", "admin-fail")
      .gte("created_at", since);
    if ((count ?? 0) >= MAX_FAILS) {
      return Response.json({ error: "Too many failed attempts. Try again in a few minutes." }, { status: 429 });
    }
  } catch (e) {
    console.error("[admin-auth] lock check failed", e);
  }

  const secret = process.env.ADMIN_PASSWORD;
  if (secret && safeEqual(req.headers.get("authorization"), `Bearer ${secret}`)) return null;

  try {
    await supabaseAdmin().from("request_log").insert({ ip, route: "admin-fail" });
  } catch (e) {
    console.error("[admin-auth] failure log failed", e);
  }
  return Response.json({ error: "Unauthorized" }, { status: 401 });
}
