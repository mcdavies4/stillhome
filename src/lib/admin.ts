// src/lib/admin.ts
// Admin auth for the partner admin pages/APIs.
// Protected by the x-admin-secret header vs the ADMIN_SECRET env var.
// Solo-founder-simple; swap for real auth if anyone else ever needs access.

import { ApiError } from "@/lib/partners";

export function requireAdmin(req: Request): void {
  const secret = process.env.ADMIN_SECRET;
  if (!secret || req.headers.get("x-admin-secret") !== secret) {
    throw new ApiError(401, "unauthorized", "Bad admin secret.");
  }
}
