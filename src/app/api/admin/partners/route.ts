// /api/admin/partners
// GET  -> list partners with balances and today's spend
// POST -> create a partner (+ wallet), body: { name, slug, contact_email }
// Protected by x-admin-secret header (see src/lib/admin.ts).

import { supabaseAdmin, jsonError, ApiError } from "@/lib/partners";
import { requireAdmin } from "@/lib/admin";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    requireAdmin(req);
    const db = supabaseAdmin();

    const { data: partners, error } = await db
      .from("partners")
      .select(
        "id, name, slug, status, contact_email, fee_bps, fee_min_pence, fx_margin_bps, max_order_ngn, daily_cap_pence, webhook_url, created_at, partner_wallets(balance_pence)"
      )
      .order("created_at", { ascending: true });
    if (error) throw error;

    const enriched = await Promise.all(
      (partners ?? []).map(async (p: any) => {
        const { data: spent } = await db.rpc("partner_spent_today_pence", {
          p_partner_id: p.id,
        });
        return {
          ...p,
          balance_pence: p.partner_wallets?.[0]?.balance_pence ?? p.partner_wallets?.balance_pence ?? 0,
          spent_today_pence: spent ?? 0,
          partner_wallets: undefined,
        };
      })
    );

    return Response.json({ partners: enriched });
  } catch (e) {
    return jsonError(e);
  }
}

export async function POST(req: Request) {
  try {
    requireAdmin(req);
    const db = supabaseAdmin();
    const body = await req.json().catch(() => null);
    const { name, slug, contact_email } = body ?? {};
    if (!name || !slug || !contact_email) {
      throw new ApiError(400, "invalid_request", "name, slug and contact_email are required.");
    }

    const { data: partner, error } = await db
      .from("partners")
      .insert({ name, slug, contact_email })
      .select()
      .single();
    if (error) {
      if (error.code === "23505") {
        throw new ApiError(409, "slug_taken", "A partner with that slug already exists.");
      }
      throw error;
    }

    await db.from("partner_wallets").insert({ partner_id: partner.id });

    return Response.json({ partner });
  } catch (e) {
    return jsonError(e);
  }
}
