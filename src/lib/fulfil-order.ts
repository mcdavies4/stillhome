// src/lib/fulfil-order.ts
// Shared vend pipeline for an order that has JUST been claimed (pending_payment -> paid).
// Currently used by the Paystack (₦) webhook. The Stripe webhook still carries its own
// copy of this logic — it's deliberately untouched while the Paystack path proves itself.
//
// Flow: wallet check -> vend (idempotent reference = NOLGIC-<order id>) ->
//   success   : store token, receipt email + WhatsApp, status=fulfilled
//   failover  : if the primary can't fund the vend, or rejects it outright (nothing bought), the same product is
//               tried once on BILLS_FAILOVER_PROVIDER. Never on a timeout or unclear answer (double-delivery risk).
//   failure   : requery the bills provider before refunding:
//                 success   -> treat as fulfilled
//                 ambiguous -> needs_review, alert founder, NO refund
//                 failed    -> refund the customer, status=failed_refunded
//                 (refund itself fails -> refund_failed + alert)

import { supabaseAdmin } from "@/lib/supabase";
import {
  checkBillStatus, FlwError, makeReference, makeReferenceFor, providerLabel, activeProvider, balanceOf, billsTestMode,
  failoverProvider, catalogueOf, findEquivalentItem, validateVia, vendVia,
  type BillsProviderName, type BillPaymentResult,
} from "@/lib/bills";
import { getCountry } from "@/lib/countries";
import { alertFounder } from "@/lib/alerts";
import { sendReceipt } from "@/lib/whatsapp";
import { waOnFulfilled, waOnFailedRefunded, waOnNeedsReview } from "@/lib/wa/hooks";
import { tgNotifyOrder } from "@/lib/tg/notify";
import { sendOrderRefundEmail, sendOrderCheckingEmail, sendOrderRefundDelayedEmail } from "@/lib/order-status-mail";
import { providerHealth, noteBreakerOpen } from "@/lib/breaker";

// Orders placed in the Telegram bot hear their outcome in the chat (never throws; web orders skip it).
const tgTell = (o: { id: string; source?: string | null }) => (o.source === "telegram" ? tgNotifyOrder(o.id) : Promise.resolve(false));

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

type Route = { provider: BillsProviderName; reference: string; biller_code: string; item_code: string; biller_name: string };

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
  const primary = activeProvider();
  const primaryRoute: Route = {
    provider: primary,
    reference: makeReference(order.id, order.flw_reference),
    biller_code: order.biller_code,
    item_code: order.item_code,
    biller_name: order.biller_name,
  };
  // The last route we actually sent a vend on (null = nothing was sent, so nothing can have been bought).
  const state: { route: Route | null; failedOver: boolean } = { route: null, failedOver: false };

  const deliver = async (token: string | null) => {
    if (order.email) {
      await hooks.sendReceiptEmail(order, token).catch((e) => console.error("[fulfil] receipt email failed", e));
    }
    if (order.recipient_whatsapp && order.source !== "whatsapp") {
      await sendReceipt(order.recipient_whatsapp, { ...order, flw_token: token } as any);
    }
    await waOnFulfilled({ ...order, flw_token: token } as any);
    await tgTell(order);
  };

  // Can `p`'s wallet fund this vend? Returns the shortfall message, or null. Live only (test modes skip it).
  const fundsProblem = async (p: BillsProviderName): Promise<string | null> => {
    if (p === "flutterwave" && billsTestMode()) return null; // Flutterwave TEST key: nothing real to fund
    const balance = await balanceOf(p, currency).catch(() => Number.MAX_SAFE_INTEGER);
    if (balance < amountLocal) {
      return `Insufficient ${currency} wallet balance (${sym}${balance.toLocaleString()}) for ${sym}${amountLocal.toLocaleString()} vend`;
    }
    if (p === primary && balance !== Number.MAX_SAFE_INTEGER) {
      const lowWater = Number(process.env[`LOW_BALANCE_${currency}`] ?? (currency === "NGN" ? "100000" : "500"));
      if (balance - amountLocal < lowWater) {
        alertFounder(
          `${currency} wallet running low`,
          `${currency} wallet will be ~${sym}${(balance - amountLocal).toLocaleString()} after order ${order.id}. Top up.`
        );
      }
    }
    return null;
  };

  // The same product on the failover provider, if one is configured, can be funded, and matches exactly.
  // Returns null (no failover) on any doubt, so the order falls back to the normal refund path.
  const failoverRoute = async (): Promise<Route | null> => {
    if (state.failedOver) return null;
    const alt = failoverProvider();
    if (!alt) return null;
    if (await fundsProblem(alt)) return null;
    if ((await providerHealth(alt)).open) return null; // don't hand an order to a backup that is failing too
    const item = await catalogueOf(alt, countryCode)
      .then((cat) => findEquivalentItem({ biller_name: order.biller_name, item_code: order.item_code, amount: amountLocal }, cat))
      .catch(() => null);
    if (!item) return null;
    // Meters and smartcards get a name check first; airtime has nothing to check.
    if (item.item_code !== "airtime" && !item.is_airtime) {
      const v = await validateVia(alt, item.item_code, item.biller_code, order.identifier).catch(() => null);
      if (!v || v.response_code !== "00") return null;
    }
    return {
      provider: alt,
      reference: makeReferenceFor(alt, order.id),
      biller_code: item.biller_code,
      item_code: item.item_code,
      biller_name: item.biller_name,
    };
  };

  // Sends one vend. A synchronous "not bought" rejection moves the order to the failover route, once.
  const vendOn = async (r: Route): Promise<BillPaymentResult> => {
    state.route = r;
    await db.from("orders").update({ flw_reference: r.reference }).eq("id", order.id);
    try {
      return await vendVia(r.provider, {
        country: countryCode,
        identifier: order.identifier,
        amountLocal,
        billerName: r.biller_name,
        itemCode: r.item_code,
        billerCode: r.biller_code,
        reference: r.reference,
        phone: order.recipient_whatsapp ?? null,
      });
    } catch (e: any) {
      if (!e?.notVended) throw e;
      const alt = await failoverRoute();
      if (!alt) throw e;
      state.failedOver = true;
      alertFounder(
        "Order moved to backup provider",
        `Order ${order.id} (${order.biller_name} ${sym}${amountLocal.toLocaleString()}) was rejected by ${providerLabel(r.provider)} (${e?.message ?? "no detail"}), so it is being sent through ${providerLabel(alt.provider)}. No action needed unless it fails.`
      );
      return vendOn(alt);
    }
  };

  try {
    // Start on the primary. If its wallet can't fund the vend, nothing has been sent, so the failover is safe to try.
    let start: Route = primaryRoute;
    const shortfall = await fundsProblem(primary);
    // Breaker: the primary has been failing recently. Only skip it if the backup can take the order;
    // nothing is sent to the primary in that case, so nothing can be vended twice.
    const health = shortfall ? null : await providerHealth(primary);
    const down = !!health?.open;
    if (shortfall || down) {
      const alt = await failoverRoute();
      if (alt) {
        state.failedOver = true;
        start = alt;
        if (down && health) noteBreakerOpen(primary, health, alt.provider);
      } else if (shortfall) {
        throw new FlwError(shortfall);
      }
    }

    const result = await vendOn(start);
    const reference = state.route!.reference;

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

    const attempted = state.route;
    const reference = attempted?.reference ?? primaryRoute.reference;
    if (attempted) {
      let outcome = await requeryOutcome(reference);
      // The provider flatly rejected the purchase request (4xx / "product not enabled" / "wallet empty"):
      // nothing was bought. If the status lookup is merely inconclusive, that is enough to refund.
      // A confirmed delivery from the lookup still wins (handled below), and timeouts/5xx never set this flag.
      if (outcome === "ambiguous" && (e as any)?.notVended === true) outcome = "failed";
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
          `Order ${order.id} (${order.biller_name} ${sym}${amountLocal.toLocaleString()} ${currency})\nVend outcome unknown after error: ${errMsg}\nCheck the ${providerLabel(attempted!.provider)} dashboard for reference ${reference}: refund (${hooks.paymentLabel}) if NOT delivered.`
        );
        await waOnNeedsReview(order as any);
        await sendOrderCheckingEmail(order as any);
        await tgTell(order);
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
      await sendOrderRefundEmail(order as any);
      await tgTell(order);
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
      await sendOrderRefundDelayedEmail(order as any);
      await tgTell(order);
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
