// src/lib/fulfil-order.ts
// Shared vend pipeline for an order that has JUST been claimed (pending_payment -> paid).
// Currently used by the Paystack (₦) webhook. The Stripe webhook still carries its own
// copy of this logic — it's deliberately untouched while the Paystack path proves itself.
//
// Flow: wallet check -> vend (idempotent reference = NOLGIC-<order id>) ->
//   success   : store token, receipt email + WhatsApp, status=fulfilled
//   failure   : requery the bills provider before refunding:
//                 success   -> treat as fulfilled
//                 ambiguous -> needs_review, alert founder, NO refund
//                 failed    -> refund the customer, status=failed_refunded
//                 (refund itself fails -> refund_failed + alert)

import { supabaseAdmin } from "@/lib/supabase";
import { createBillPayment, checkBillStatus, getBalance, FlwError, makeReference, billsTestMode, providerLabel, activeProvider } from "@/lib/bills";
import { getCountry } from "@/lib/countries";
import { alertFounder } from "@/lib/alerts";
import { sendReceipt } from "@/lib/whatsapp";
import { waOnFulfilled, waOnFailedRefunded, waOnNeedsReview } from "@/lib/wa/hooks";

export interface ClaimedOrder {
  id: string;
  email?: string | null;
  country?: string | null;
  currency?: string | null;
  biller_code: string;
  item_code: string;
  biller_name: string;
  identifier: string;
  customer_name: string | null;
  recipient_whatsapp?: string | null;
  source?: string | null;
  wa_user_id?: string | null;
  amount_ngn: number; // local-currency bill amount (legacy column name)
  amount_gbp_pence: number;
  [k: string]: unknown;
}

export interface FulfilHooks {
  /** Refund the customer in full via the rail they paid with. Throw if it fails. */
  refund: () => Promise<void>;
  /** Send the customer their receipt (rail-specific wording/currency). */
  sendReceiptEmail: (order: ClaimedOrder, token: string | null) => Promise<void>;
  /** Human label for alerts, e.g. "Paystack ref NLG-…" */
  paymentLabel: string;
}

export type FulfilResult =
  | { outcome: "fulfilled"; recovered?: boolean }
  | { outcome: "needs_review" }
  | { outcome: "refunded" }
  | { outcome: "refund_failed" };

export async function fulfilClaimedOrder(order: ClaimedOrder, hooks: FulfilHooks): Promise<FulfilResult> {
  const db = supabaseAdmin();
  const countryCode: string = order.country ?? "NG";
  const country = getCountry(countryCode);
  const currency: string = order.currency ?? country.currency;
  const sym = country.currencySymbol;
  const amountLocal = Number(order.amount_ngn);
  // Provider-specific, and stable across replays (reuses a reference already stored on the order).
  const reference = makeReference(order.id, order.flw_reference);
  let vendAttempted = false;

  const deliver = async (token: string | null) => {
    if (order.email) {
      await hooks.sendReceiptEmail(order, token).catch((e) => console.error("[fulfil] receipt email failed", e));
    }
    if (order.recipient_whatsapp && order.source !== "whatsapp") {
      await sendReceipt(order.recipient_whatsapp, { ...order, flw_token: token } as any);
    }
    await waOnFulfilled({ ...order, flw_token: token } as any);
  };

  try {
    // Fail fast if the float for THIS currency can't cover the vend — live only.
    const isTestMode = billsTestMode() && activeProvider() === "flutterwave"; // VTpass sandbox has a real (fake-money) balance
    const balance = isTestMode
      ? Number.MAX_SAFE_INTEGER
      : await getBalance(currency).catch(() => Number.MAX_SAFE_INTEGER);

    if (balance < amountLocal) {
      throw new FlwError(
        `Insufficient ${currency} wallet balance (${sym}${balance.toLocaleString()}) for ${sym}${amountLocal.toLocaleString()} vend`
      );
    }
    const lowWater = Number(process.env[`LOW_BALANCE_${currency}`] ?? (currency === "NGN" ? "100000" : "500"));
    if (balance !== Number.MAX_SAFE_INTEGER && balance - amountLocal < lowWater) {
      alertFounder(
        `${currency} wallet running low`,
        `${currency} wallet will be ~${sym}${(balance - amountLocal).toLocaleString()} after order ${order.id}. Top up.`
      );
    }

    await db.from("orders").update({ flw_reference: reference }).eq("id", order.id);

    vendAttempted = true;
    const result = await createBillPayment({
      country: countryCode,
      identifier: order.identifier,
      amountLocal,
      billerName: order.biller_name,
      itemCode: order.item_code,
      billerCode: order.biller_code,
      reference,
      phone: order.recipient_whatsapp ?? null,
    });

    let token: string | null = (result as any)?.extra ?? null;
    if (!token) {
      try {
        const status = await checkBillStatus(reference);
        token = status.token;
      } catch {
        /* lazy recovery via /api/orders + daily cron will pick it up */
      }
    }

    await db.from("orders").update({ status: "fulfilled", flw_token: token }).eq("id", order.id);
    await deliver(token);
    return { outcome: "fulfilled" };
  } catch (e) {
    const errMsg = e instanceof FlwError ? e.message : String(e);
    console.error(`[fulfil] order ${order.id} failed:`, errMsg);

    if (vendAttempted) {
      const outcome = await requeryOutcome(reference);
      if (outcome === "success") {
        let token: string | null = null;
        try {
          const status = await checkBillStatus(reference);
          token = status.token;
        } catch {}
        await db.from("orders").update({ status: "fulfilled", flw_token: token, error: null }).eq("id", order.id);
        await deliver(token);
        return { outcome: "fulfilled", recovered: true };
      }
      if (outcome === "ambiguous") {
        await db.from("orders").update({ status: "needs_review", error: `AMBIGUOUS: ${errMsg}` }).eq("id", order.id);
        await alertFounder(
          "🔍 Order needs review — do NOT ignore",
          `Order ${order.id} (${order.biller_name} ${sym}${amountLocal.toLocaleString()} ${currency})\nVend outcome unknown after error: ${errMsg}\nCheck the ${providerLabel()} dashboard for reference ${reference}: refund (${hooks.paymentLabel}) if NOT delivered.`
        );
        await waOnNeedsReview(order as any);
        return { outcome: "needs_review" };
      }
      // outcome === "failed": confirmed no delivery — safe to refund below.
    }

    try {
      await hooks.refund();
      await db.from("orders").update({ status: "failed_refunded", error: errMsg }).eq("id", order.id);
      alertFounder(
        "Vend failed — customer auto-refunded",
        `Order ${order.id} (${order.biller_name} ${sym}${amountLocal.toLocaleString()} ${currency})\n${hooks.paymentLabel}\nError: ${errMsg}`
      );
      await waOnFailedRefunded(order as any);
      return { outcome: "refunded" };
    } catch (refundErr: any) {
      await db
        .from("orders")
        .update({ status: "refund_failed", error: `${errMsg} | REFUND FAILED: ${refundErr?.message}` })
        .eq("id", order.id);
      await alertFounder(
        "🚨 REFUND FAILED — manual action needed",
        `Order ${order.id}\nVend error: ${errMsg}\nRefund error: ${refundErr?.message}\n${hooks.paymentLabel}`
      );
      await waOnNeedsReview(order as any);
      return { outcome: "refund_failed" };
    }
  }
}

async function requeryOutcome(reference: string): Promise<"success" | "failed" | "ambiguous"> {
  try {
    const status = await checkBillStatus(reference);
    if (status.state === "success") return "success";
    if (status.state === "failed" || status.state === "not_found") return "failed";
    return "ambiguous"; // still pending / unclear: never refund on a guess
  } catch {
    return "ambiguous";
  }
}
