// POST /api/v1/vend
// Body: {
//   partner_ref,                     // partner's idempotency key (required)
//   biller_code, item_code,          // FLW identifiers (required)
//   biller_name, identifier,         // display name + meter/IUC/phone (required)
//   identifier_label,                // e.g. "Meter number" (required)
//   amount_ngn,                      // required
//   customer_name?, recipient_whatsapp?
// }
//
// Flow: auth -> caps -> price -> atomic wallet debit + order insert (RPC)
//       -> FLW vend -> fulfilled | refunded | left 'paid' if ambiguous.
// Retries with the same partner_ref return the original order (200).

import {
  requirePartner,
  priceOrder,
  flwVend,
  queueWebhookEvent,
  supabaseAdmin,
  publicOrder,
  jsonError,
  ApiError,
} from "@/lib/partners";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const auth = await requirePartner(req);
    const db = supabaseAdmin();
    const body = await req.json().catch(() => null);

    // ---- validate body ------------------------------------------------
    const required = [
      "partner_ref",
      "biller_code",
      "item_code",
      "biller_name",
      "identifier",
      "identifier_label",
      "amount_ngn",
    ] as const;
    for (const f of required) {
      if (!body?.[f]) {
        throw new ApiError(400, "invalid_request", `${f} is required.`);
      }
    }
    const amountNgn = Number(body.amount_ngn);
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

    // ---- price + daily cap --------------------------------------------
    const quote = priceOrder(auth.partner, amountNgn);

    const { data: spentToday } = await db.rpc("partner_spent_today_pence", {
      p_partner_id: auth.partner.id,
    });
    if ((spentToday ?? 0) + quote.total_gbp_pence > auth.partner.daily_cap_pence) {
      throw new ApiError(429, "daily_cap_reached", "Daily spending cap reached.");
    }

    // ---- atomic debit + order insert (idempotent on partner_ref) ------
    const { data: order, error: rpcError } = await db.rpc("partner_create_order", {
      p_partner_id: auth.partner.id,
      p_partner_ref: String(body.partner_ref),
      p_biller_code: String(body.biller_code),
      p_item_code: String(body.item_code),
      p_biller_name: String(body.biller_name),
      p_identifier: String(body.identifier),
      p_identifier_label: String(body.identifier_label),
      p_customer_name: body.customer_name ?? null,
      p_recipient_whatsapp: body.recipient_whatsapp ?? null,
      p_amount_ngn: amountNgn,
      p_fx_ngn_per_gbp: quote.fx_ngn_per_gbp,
      p_service_fee_pence: quote.fee_pence,
      p_amount_gbp_pence: quote.total_gbp_pence,
    });

    if (rpcError) {
      if (rpcError.message?.includes("INSUFFICIENT_FUNDS")) {
        throw new ApiError(402, "insufficient_funds", "Wallet balance too low. Top up to continue.");
      }
      if (rpcError.message?.includes("NO_WALLET")) {
        throw new ApiError(402, "no_wallet", "No wallet exists for this partner yet.");
      }
      throw rpcError;
    }

    // Idempotent replay: order already past 'paid' means this is a retry.
    if (order.status !== "paid") {
      return Response.json({ order: publicOrder(order), idempotent_replay: true });
    }

    // ---- vend ----------------------------------------------------------
    if (auth.environment === "test") {
      // Simulated success — no FLW call, wallet still debited (test wallets
      // should be topped up with monopoly money via the ledger).
      const token = "TEST-TOKEN-0000-1111-2222";
      await db
        .from("orders")
        .update({ status: "fulfilled", flw_token: token, updated_at: new Date().toISOString() })
        .eq("id", order.id);
      await queueWebhookEvent(auth.partner.id, order.id, "vend.success", {
        order_id: order.id,
        partner_ref: order.partner_ref,
        token,
        simulated: true,
      });
      return Response.json({
        order: { ...publicOrder(order), status: "fulfilled", token },
        simulated: true,
      });
    }

    const reference = `NOLGIC-${order.id}`;
    const result = await flwVend({
      reference,
      billerCode: String(body.biller_code),
      itemCode: String(body.item_code),
      identifier: String(body.identifier),
      amountNgn,
    });

    if (result.ok === true) {
      await db
        .from("orders")
        .update({
          status: "fulfilled",
          flw_reference: result.flwRef,
          flw_token: result.token,
          updated_at: new Date().toISOString(),
        })
        .eq("id", order.id);
      await queueWebhookEvent(auth.partner.id, order.id, "vend.success", {
        order_id: order.id,
        partner_ref: order.partner_ref,
        token: result.token,
      });
      return Response.json({
        order: { ...publicOrder(order), status: "fulfilled", token: result.token },
      });
    }

    if (result.ok === false) {
      // Definitive provider failure -> refund wallet, notify.
      await db
        .from("orders")
        .update({ error: result.error, updated_at: new Date().toISOString() })
        .eq("id", order.id);
      await db.rpc("partner_refund_order", { p_order_id: order.id });
      await queueWebhookEvent(auth.partner.id, order.id, "vend.failed", {
        order_id: order.id,
        partner_ref: order.partner_ref,
        reason: result.error,
      });
      await queueWebhookEvent(auth.partner.id, order.id, "vend.refunded", {
        order_id: order.id,
        partner_ref: order.partner_ref,
        amount_gbp_pence: order.amount_gbp_pence,
      });
      return Response.json(
        {
          order: { ...publicOrder(order), status: "failed_refunded", error: result.error },
        },
        { status: 422 }
      );
    }

    // Ambiguous (timeout / unknown): money stays debited, order stays 'paid'.
    // Resolve manually or via your existing requery tooling — never auto-refund
    // an ambiguous vend (the token may still arrive).
    await db
      .from("orders")
      .update({ error: `NEEDS_REVIEW: ${result.error}`, updated_at: new Date().toISOString() })
      .eq("id", order.id);
    return Response.json(
      {
        order: publicOrder(order),
        processing: true,
        message: "Vend submitted; final status pending. Poll GET /api/v1/orders/{id}.",
      },
      { status: 202 }
    );
  } catch (e) {
    return jsonError(e);
  }
}
