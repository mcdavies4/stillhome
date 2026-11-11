// src/lib/tg/order.ts
// Creates a naira order for a Telegram customer and the Paystack (or Flutterwave) payment link for it.
//
// This follows the naira path of /api/checkout step for step (same rules, same fee, same checks), because the order
// that comes out of it must be indistinguishable from a web order once it is paid: the payment webhook, the order
// page's safety net, the daily reconcile and the refund pipeline all work on it unchanged. The only differences:
// source = 'telegram', and the order is linked to the chat in tg_orders so the outcome can be messaged back.

import { supabaseAdmin } from "@/lib/supabase";
import { validateCustomer, checkPurchase } from "@/lib/bills";
import { getCountry } from "@/lib/countries";
import { velocityCheck } from "@/lib/velocity";
import { alertFounder } from "@/lib/alerts";
import { initializeTransaction, paystackConfigured } from "@/lib/paystack";
import { ngnPayProvider, flwPayConfigured, initializePayment as flwInitialize } from "@/lib/flwpay";
import { ngnServiceFee, ngnMaxOrder, feeKindOf } from "@/lib/ngn-fee";
import { orderIsTest } from "@/lib/test-mode";
import { walletCovers } from "@/lib/capacity";
import { BACK_SOON_MESSAGE } from "@/lib/back-soon";
import { pfmNoValidate } from "@/lib/payforme-shared";
import type { CreateResult, Item } from "./engine";

const naira = (n: number) => `₦${Math.round(n).toLocaleString("en-NG")}`;
const MAX_OPEN_UNPAID = 4;

export async function createTelegramOrder(i: { chatId: number; email: string; item: Item; identifier: string; amount: number }): Promise<CreateResult> {
  try {
    const country = getCountry("NG");
    const rail = ngnPayProvider();
    if (rail === "flutterwave" ? !flwPayConfigured() : !paystackConfigured()) {
      return { ok: false, error: "Payments aren't available yet. Please check back soon." };
    }
    const amount = Math.round(Number(i.amount));
    const maxNgn = ngnMaxOrder(country.maxLocal);
    const minNgn = country.minDomestic ?? country.minLocal;
    if (!Number.isFinite(amount) || amount < minNgn || amount > maxNgn) {
      return { ok: false, error: `The amount must be between ${naira(minNgn)} and ${naira(maxNgn)}.` };
    }

    // Provider rules, checked before any money moves (plan exists, fixed price, min/max).
    const purchase = await checkPurchase(i.item.biller_code, i.item.item_code, amount);
    if (!purchase.ok) return { ok: false, error: purchase.error };

    // Re-check the meter / smartcard on the server, exactly as the website does.
    let name: string | null = null;
    const noValidate = pfmNoValidate(i.item) || /VTU|AIRTIME|DATA|BROADBAND|SURFLINE|POSTPAID PAYMENT/i.test(`${i.item.biller_name} ${i.item.item_code}`);
    try {
      const v = await validateCustomer(i.item.item_code, i.item.biller_code, i.identifier);
      name = v.name;
      if (!noValidate && Number(v.minimum) > amount) {
        return { ok: false, error: `The minimum for this meter is ${naira(Number(v.minimum))}. Please start again with a higher amount.` };
      }
    } catch (e: any) {
      if (!noValidate) {
        const m = String(e?.message ?? "");
        return { ok: false, error: m && !/^(Flutterwave|VTpass|Paybeta) /i.test(m) ? m : "I couldn't check that number right now. Please try again in a moment." };
      }
    }

    // Can we deliver right now? Asked before a payment link exists, so nobody pays for something we can't vend.
    const cover = await walletCovers(amount, { context: i.item.biller_name });
    if (!cover.ok) return { ok: false, error: BACK_SOON_MESSAGE };

    const db = supabaseAdmin();

    // A chat can't pile up unpaid orders.
    const since = new Date(Date.now() - 3600_000).toISOString();
    const { data: mine } = await db.from("tg_orders").select("order_id").eq("chat_id", i.chatId).gte("created_at", since);
    const ids = (mine ?? []).map((r: any) => r.order_id);
    if (ids.length >= MAX_OPEN_UNPAID) {
      const { data: open } = await db.from("orders").select("id").in("id", ids).eq("status", "pending_payment");
      if ((open ?? []).length >= MAX_OPEN_UNPAID) {
        return { ok: false, error: "You have several unpaid orders open. Please pay one of them, or wait an hour and try again." };
      }
    }

    const fee = ngnServiceFee(amount, feeKindOf(purchase.item ?? i.item));
    const total = amount + fee;

    const approxPence = Math.round((total / Number(process.env.NGN_PER_GBP ?? country.fxDefault)) * 100);
    const vel = await velocityCheck({ email: i.email, ip: `telegram:${i.chatId}`, amountGbpPence: approxPence });
    if (vel.blocked) {
      alertFounder("Telegram order blocked by velocity check", `Chat: ${i.chatId}\nEmail: ${i.email}\nReason: ${vel.reason}\nAmount: ${naira(total)} · ${i.item.biller_name}`);
      return { ok: false, error: "For your security this order needs review. Please contact us if you believe this is a mistake." };
    }

    const { data: order, error } = await db
      .from("orders")
      .insert({
        user_id: null,
        email: i.email,
        ip: "telegram",
        source: "telegram",
        country: "NG",
        currency: "NGN",
        payment_provider: rail,
        biller_code: i.item.biller_code,
        item_code: i.item.item_code,
        biller_name: i.item.biller_name,
        identifier: i.identifier,
        identifier_label: i.item.label_name || "Account number",
        customer_name: name,
        recipient_whatsapp: null,
        amount_ngn: amount,
        service_fee_local: fee,
        fx_ngn_per_gbp: Number(process.env.NGN_PER_GBP ?? country.fxDefault), // reference only
        service_fee_pence: 0,
        amount_gbp_pence: 0,
        status: "pending_payment",
        ...(orderIsTest(rail) ? { is_test: true } : {}),
      })
      .select("id")
      .single();
    if (error || !order) throw error ?? new Error("order insert failed");
    await db.from("tg_orders").insert({ order_id: order.id, chat_id: i.chatId });

    const app = process.env.NEXT_PUBLIC_APP_URL!;
    if (rail === "flutterwave") {
      const fw = await flwInitialize({
        email: i.email, name, amountNgn: total, orderId: order.id,
        redirectUrl: `${app}/order/${order.id}?paid=1`,
        description: `${i.item.biller_name} — ${naira(amount)}`,
      });
      await db.from("orders").update({ flw_pay_ref: fw.txRef }).eq("id", order.id);
      return { ok: true, url: fw.link, orderId: order.id, total };
    }
    const init = await initializeTransaction({ email: i.email, amountNgn: total, orderId: order.id, callbackUrl: `${app}/order/${order.id}?paid=1` });
    await db.from("orders").update({ paystack_reference: init.reference }).eq("id", order.id);
    return { ok: true, url: init.authorizationUrl, orderId: order.id, total };
  } catch (e: any) {
    console.error("[telegram] create order failed", e?.message ?? e);
    const m = String(e?.message ?? "");
    const safe = e?.name === "PaystackError" || e?.name === "FlwError" ? !/^(Flutterwave|VTpass|Paybeta) /i.test(m) : false;
    return { ok: false, error: safe ? m : "I couldn't create your payment link. Nothing was charged. Please try again." };
  }
}
