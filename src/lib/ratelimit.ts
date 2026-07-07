import { supabaseAdmin } from "@/lib/supabase";

// Per-IP sliding-window rate limit backed by Supabase (serverless-safe).
// Fails OPEN: if the check itself errors, we allow the request —
// availability of payments beats a perfect limiter.
export async function rateLimit(
  req: Request,
  route: string,
  max: number,
  windowMinutes: number
): Promise<{ ok: boolean }> {
  try {
    const ip =
      (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() ||
      req.headers.get("x-real-ip") ||
      "unknown";
    const db = supabaseAdmin();
    const since = new Date(Date.now() - windowMinutes * 60_000).toISOString();

    const { count } = await db
      .from("request_log")
      .select("id", { count: "exact", head: true })
      .eq("ip", ip)
      .eq("route", route)
      .gte("created_at", since);

    if ((count ?? 0) >= max) return { ok: false };

    await db.from("request_log").insert({ ip, route });
    return { ok: true };
  } catch (e) {
    console.error("[ratelimit] check failed (allowing request)", e);
    return { ok: true };
  }
}
