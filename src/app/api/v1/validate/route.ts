// POST /api/v1/validate
// Body: { biller_code, item_code, identifier }
// Returns the customer name FLW reports for that meter / IUC / phone.

import { requirePartner, jsonError, ApiError } from "@/lib/partners";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const auth = await requirePartner(req);
    const body = await req.json().catch(() => null);
    const { biller_code, item_code, identifier } = body ?? {};
    if (!biller_code || !item_code || !identifier) {
      throw new ApiError(
        400,
        "invalid_request",
        "biller_code, item_code and identifier are required."
      );
    }

    // Test keys: simulate a successful validation.
    if (auth.environment === "test") {
      return Response.json({
        valid: true,
        customer_name: "TEST CUSTOMER",
        identifier,
        simulated: true,
      });
    }

    const res = await fetch(
      `https://api.flutterwave.com/v3/bill-items/${item_code}/validate?code=${biller_code}&customer=${encodeURIComponent(identifier)}`,
      { headers: { Authorization: `Bearer ${process.env.FLW_SECRET_KEY!}` } }
    );
    const json = await res.json().catch(() => ({}));

    if (res.ok && json?.status === "success") {
      return Response.json({
        valid: true,
        customer_name: json?.data?.name ?? json?.data?.customer ?? null,
        identifier,
      });
    }
    return Response.json(
      {
        valid: false,
        message: json?.message ?? "Could not validate this identifier.",
      },
      { status: 422 }
    );
  } catch (e) {
    return jsonError(e);
  }
}
