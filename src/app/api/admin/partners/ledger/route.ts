// GET /api/admin/partners/ledger?partner_id=...
// Returns the partner's ledger (last 100), API keys, and recent API orders.

import { supabaseAdmin, jsonError, ApiError } from "@/lib/partners";
import { requireAdmin } from "@/lib/admin";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    requireAdmin(req);
    const url = new URL(req.url);
    const partnerId = url.searchParams.get("partner_id");
    if (!partnerId) throw new ApiError(400, "invalid_request", "partner_id is required.");

    const db = supabaseAdmin();

    const [ledger, keys, orders] = await Promise.all([
      db
        .from("partner_ledger")
        .select("id, entry_type, amount_pence, balance_after_pence, order_id, note, created_at")
        .eq("partner_id", partnerId)
        .order("created_at", { ascending: false })
        .limit(100),
      db
        .from("partner_api_keys")
        .select("id, environment, key_prefix, label, last_used_at, revoked_at, created_at")
        .eq("partner_id", partnerId)
        .order("created_at", { ascending: false }),
      db
        .from("orders")
        .select("id, partner_ref, status, biller_name, identifier, amount_ngn, amount_gbp_pence, flw_token, error, created_at")
        .eq("partner_id", partnerId)
        .order("created_at", { ascending: false })
        .limit(50),
    ]);

    return Response.json({
      ledger: ledger.data ?? [],
      keys: keys.data ?? [],
      orders: orders.data ?? [],
    });
  } catch (e) {
    return jsonError(e);
  }
}
