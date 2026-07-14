// /api/admin/partners/keys
// POST   -> create a key: { partner_id, environment: 'test'|'live', label? }
//           Returns the full key ONCE — it is never stored or shown again.
// DELETE -> revoke a key: { key_id }

import { supabaseAdmin, generateApiKey, jsonError, ApiError } from "@/lib/partners";
import { requireAdmin } from "@/lib/admin";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    requireAdmin(req);
    const body = await req.json().catch(() => null);
    const { partner_id, environment, label } = body ?? {};
    if (!partner_id || !["test", "live"].includes(environment)) {
      throw new ApiError(400, "invalid_request", "partner_id and environment ('test'|'live') are required.");
    }

    const { key, prefix, hash } = generateApiKey(environment);
    const { data: row, error } = await supabaseAdmin()
      .from("partner_api_keys")
      .insert({
        partner_id,
        environment,
        key_prefix: prefix,
        key_hash: hash,
        label: label ?? `${environment} key ${new Date().toISOString().slice(0, 10)}`,
      })
      .select("id, partner_id, environment, key_prefix, label, created_at")
      .single();
    if (error) throw error;

    return Response.json({ key, key_record: row });
  } catch (e) {
    return jsonError(e);
  }
}

export async function DELETE(req: Request) {
  try {
    requireAdmin(req);
    const body = await req.json().catch(() => null);
    if (!body?.key_id) {
      throw new ApiError(400, "invalid_request", "key_id is required.");
    }
    const { error } = await supabaseAdmin()
      .from("partner_api_keys")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", body.key_id);
    if (error) throw error;
    return Response.json({ revoked: true });
  } catch (e) {
    return jsonError(e);
  }
}
