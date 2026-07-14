// POST /api/admin/partners/topup
// Body: { partner_id, amount_pence, note? }
// Positive credits the wallet (bank transfer received); negative adjusts down.

import { supabaseAdmin, jsonError, ApiError } from "@/lib/partners";
import { requireAdmin } from "@/lib/admin";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    requireAdmin(req);
    const body = await req.json().catch(() => null);
    const partnerId = body?.partner_id;
    const amountPence = Number(body?.amount_pence);

    if (!partnerId || !Number.isInteger(amountPence) || amountPence === 0) {
      throw new ApiError(400, "invalid_request", "partner_id and a non-zero integer amount_pence are required.");
    }

    const { data: wallet, error } = await supabaseAdmin().rpc("partner_topup", {
      p_partner_id: partnerId,
      p_amount_pence: amountPence,
      p_note: body?.note ?? null,
    });
    if (error) {
      if (error.message?.includes("BALANCE_WOULD_GO_NEGATIVE")) {
        throw new ApiError(422, "negative_balance", "That adjustment would make the balance negative.");
      }
      throw error;
    }

    return Response.json({ wallet });
  } catch (e) {
    return jsonError(e);
  }
}
