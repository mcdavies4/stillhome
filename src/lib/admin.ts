// src/lib/admin.ts
// Admin auth for the partner admin pages/APIs.
// Protected by the x-admin-secret header vs the ADMIN_SECRET env var.
// Solo-founder-simple; swap for real auth if anyone else ever needs access.
// Constant-time comparison; failed attempts are throttled per IP.

import { ApiError } from "@/lib/partners";
import { safeEqual } from "@/lib/security";
import { rateLimit } from "@/lib/ratelimit";

export async function requireAdmin(req: Request): Promise<void> {
  const { ok } = await rateLimit(req, "admin-auth", 30, 10);
  if (!ok) throw new ApiError(429, "rate_limited", "Too many attempts. Try again later.");
  const secret = process.env.ADMIN_SECRET;
  if (!secret || !safeEqual(req.headers.get("x-admin-secret"), secret)) {
    throw new ApiError(401, "unauthorized", "Bad admin secret.");
  }
}
