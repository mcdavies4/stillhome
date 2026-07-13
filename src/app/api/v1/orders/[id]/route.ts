// GET /api/v1/orders/:id
// Partner can poll an order's status (scoped to their own orders only).

import { requirePartner, supabaseAdmin, publicOrder, jsonError, ApiError } from "@/lib/partners";

export const runtime = "nodejs";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requirePartner(req);
    const { id } = await params;

    const { data: order } = await supabaseAdmin()
      .from("orders")
      .select("*")
      .eq("id", id)
      .eq("partner_id", auth.partner.id)
      .maybeSingle();

    if (!order) throw new ApiError(404, "not_found", "Order not found.");
    return Response.json({ order: publicOrder(order) });
  } catch (e) {
    return jsonError(e);
  }
}
