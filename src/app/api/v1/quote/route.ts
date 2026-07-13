// POST /api/v1/quote
// Body: { amount_ngn }
// Pure calculator — no state. /vend recomputes the same maths at
// execution time, so the rate that applies is the rate at vend.

import { requirePartner, priceOrder, jsonError, ApiError } from "@/lib/partners";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const auth = await requirePartner(req);
    const body = await req.json().catch(() => null);
    const amountNgn = Number(body?.amount_ngn);

    if (!Number.isFinite(amountNgn) || amountNgn <= 0) {
      throw new ApiError(400, "invalid_request", "amount_ngn must be a positive number.");
    }
    if (amountNgn > Number(auth.partner.max_order_ngn)) {
      throw new ApiError(
        422,
        "amount_too_large",
        `Maximum per-transaction amount is NGN ${auth.partner.max_order_ngn}.`
      );
    }

    return Response.json(priceOrder(auth.partner, amountNgn));
  } catch (e) {
    return jsonError(e);
  }
}
