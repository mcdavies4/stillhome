// src/lib/tg/bulk-order.ts
// Creates a bulk airtime batch for a Telegram customer and its payment link. This is /api/bulk/checkout step for
// step (same limits, fee, first-batch cap, wallet check), so the batch that results is an ordinary bulk order: the
// payment webhook, the status poll and the daily sweep all settle it unchanged. The only addition is the link to the
// chat in tg_bulk, so the result can be messaged back.

import { walletCovers } from "@/lib/capacity";
import { BACK_SOON_MESSAGE } from "@/lib/back-soon";
import { supabaseAdmin } from "@/lib/supabase";
import { alertFounder } from "@/lib/alerts";
import { ngnPayProvider, flwPayConfigured, flwPayIsTestMode, initializePayment as flwInitialize } from "@/lib/flwpay";
import { paystackConfigured, paystackIsTestMode, initializeTransaction as psInitialize } from "@/lib/paystack";
import { paybetaConfigured } from "@/lib/paybeta";
import { activeProvider, billsTestMode } from "@/lib/bills";
import { bulkEnabled, bulkTxRef, bulkPsRef, bulkPbReference } from "@/lib/bulk";
import { checkRows, bulkFee, BULK_FIRST_CAP, type DraftRow } from "@/lib/bulk-shared";
import type { BulkResult, BulkRow } from "./engine";

const naira = (n: number) => `₦${Math.round(n).toLocaleString("en-NG")}`;

export async function createTelegramBulk(i: { chatId: number; email: string; rows: BulkRow[] }): Promise<BulkResult> {
  try {
    if (!bulkEnabled()) return { ok: false, error: "Bulk airtime isn't open yet." };
    const checked = checkRows(i.rows.slice(0, 2000).map((r): DraftRow => ({ phone: String(r.phone), amount: Number(r.amount), network: r.network as any })));
    if (!checked.ok) return { ok: false, error: checked.error };

    const rail = ngnPayProvider();
    if (rail === "flutterwave" ? !flwPayConfigured() : !paystackConfigured()) return { ok: false, error: "Bulk airtime isn't available right now. Please check back soon." };
    if (activeProvider() !== "paybeta" || !paybetaConfigured()) return { ok: false, error: "Bulk airtime isn't available right now. Please check back soon." };

    const cover = await walletCovers(checked.total, { context: `bulk airtime, ${checked.rows.length} numbers` });
    if (!cover.ok) return { ok: false, error: BACK_SOON_MESSAGE };

    const db = supabaseAdmin();
    const total = checked.total;
    const fee = bulkFee(total);
    const email = i.email;

    // New customers start with a smaller first batch (the same rule as the website).
    const [{ count: okOrders }, { count: okBulk }] = await Promise.all([
      db.from("orders").select("id", { count: "exact", head: true }).eq("email", email).eq("status", "fulfilled"),
      db.from("bulk_orders").select("id", { count: "exact", head: true }).eq("email", email).eq("status", "settled"),
    ]);
    if (!(okOrders ?? 0) && !(okBulk ?? 0) && total > BULK_FIRST_CAP) {
      return { ok: false, error: `For a first order the limit is ${naira(BULK_FIRST_CAP)}. Send a smaller batch now and the limit lifts after it is delivered.` };
    }
    // Don't let one email pile up unpaid batches.
    const hourAgo = new Date(Date.now() - 3600_000).toISOString();
    const { count: open } = await db.from("bulk_orders").select("id", { count: "exact", head: true }).eq("email", email).eq("status", "pending_payment").gte("created_at", hourAgo);
    if ((open ?? 0) >= 3) return { ok: false, error: "You have several unpaid batches open. Finish one of them first." };

    const { data: bulk, error } = await db
      .from("bulk_orders")
      .insert({
        email, ip: `telegram:${i.chatId}`, status: "pending_payment", recipients_count: checked.rows.length, amount_total: total, service_fee: fee,
        payment_provider: rail, is_test: billsTestMode() || (rail === "flutterwave" ? flwPayIsTestMode() : paystackIsTestMode()),
      })
      .select("id")
      .single();
    if (error || !bulk) throw error ?? new Error("bulk insert failed");

    const { error: recErr } = await db.from("bulk_recipients").insert(
      checked.rows.map((r, n) => ({ bulk_id: bulk.id, row_no: n + 1, network: r.network, phone: r.phone, amount: r.amount }))
    );
    if (recErr) {
      await db.from("bulk_orders").update({ status: "expired", error: "could not save recipients" }).eq("id", bulk.id);
      throw recErr;
    }
    await db.from("bulk_orders").update({ pb_reference: bulkPbReference(bulk.id) }).eq("id", bulk.id);
    await db.from("tg_bulk").insert({ bulk_id: bulk.id, chat_id: i.chatId });

    try {
      const app = process.env.NEXT_PUBLIC_APP_URL!;
      if (rail === "paystack") {
        const init = await psInitialize({ email, amountNgn: total + fee, orderId: bulk.id, callbackUrl: `${app}/bulk/${bulk.id}?paid=1`, reference: bulkPsRef(bulk.id), metadata: { bulk_id: bulk.id } });
        await db.from("bulk_orders").update({ flw_pay_ref: init.reference }).eq("id", bulk.id);
        return { ok: true, url: init.authorizationUrl, bulkId: bulk.id, total: total + fee };
      }
      const fw = await flwInitialize({ email, amountNgn: total + fee, orderId: bulk.id, txRef: bulkTxRef(bulk.id), redirectUrl: `${app}/bulk/${bulk.id}?paid=1`, description: `Bulk airtime — ${checked.rows.length} numbers` });
      await db.from("bulk_orders").update({ flw_pay_ref: fw.txRef }).eq("id", bulk.id);
      return { ok: true, url: fw.link, bulkId: bulk.id, total: total + fee };
    } catch (e: any) {
      await db.from("bulk_orders").update({ status: "expired", error: `payment link failed: ${e?.message}`.slice(0, 200) }).eq("id", bulk.id);
      alertFounder("Bulk payment link failed (Telegram)", `Bulk ${bulk.id}: ${e?.message ?? e}`);
      return { ok: false, error: "I couldn't start the payment. Nothing was charged. Please try again." };
    }
  } catch (e: any) {
    console.error("[telegram] create bulk failed", e?.message ?? e);
    return { ok: false, error: "I couldn't create your payment link. Nothing was charged. Please try again." };
  }
}
