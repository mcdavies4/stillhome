// src/lib/recurring.ts — "Repeat monthly" for Nigerian bills paid by card on Paystack.
//
// Rules this file keeps:
//   - Off unless NEXT_PUBLIC_RECURRING_ENABLED=1.
//   - A plan exists only after the customer has ticked the consent box at checkout (consent text + time + IP stored).
//   - The first month is an ordinary paid order. The plan is switched on only when Paystack confirms the card
//     can be reused (authorization.reusable === true) and the charge was made with the same email.
//   - Each month is a normal order, charged with the saved card, then confirmed and vended by the existing
//     Paystack pipeline (confirmPaystackPayment). Delivery, receipts and refunds are the same as any order.
//   - If Paystack asks the payer to approve a charge, we email them the link and do not charge again until they do.
//   - Three failed charges pause the plan. Nothing is charged after cancellation.

import { supabaseAdmin } from "@/lib/supabase";
import { alertFounder } from "@/lib/alerts";
import { chargeAuthorization, paystackReferenceFor, PaystackError } from "@/lib/paystack";
import { confirmPaystackPayment } from "@/lib/paystack-process";
import { checkPurchase, validateCustomer } from "@/lib/bills";
import { walletCovers } from "@/lib/capacity";
import { ngnServiceFee, ngnMaxOrder, type FeeKind } from "@/lib/ngn-fee";
import { getCountry } from "@/lib/countries";
import { orderIsTest } from "@/lib/test-mode";
import { sendMail, shell, button, esc, appUrl, naira } from "@/lib/mailer";

export const RECURRING_CONSENT_VERSION = "2026-11-18";
export const RECURRING_CONSENT_TEXT =
  "Repeat this bill every month. Each month Nolgic charges the same card for the same bill and amount, plus the service fee shown before you pay. " +
  "You get an email before the charge and a receipt after delivery. You can cancel at any time from the link in any of these emails, and no charge is made after you cancel. " +
  "If your bank asks you to approve a monthly charge, we will email you the link and wait for your approval.";

const MAX_FAILURES = 3;

export const recurringEnabled = () => process.env.NEXT_PUBLIC_RECURRING_ENABLED === "1";

/** Today's date in Lagos, as YYYY-MM-DD. */
export function lagosToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** Same day next month (clamped to the month's last day), as YYYY-MM-DD. */
export function addOneMonth(dateYmd: string): string {
  const [y, m, d] = dateYmd.split("-").map(Number);
  const first = new Date(Date.UTC(y, m, 1));
  const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  const day = Math.min(d, lastDay);
  return new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), day)).toISOString().slice(0, 10);
}

const manageUrl = (key: string) => `${appUrl()}/api/recurring/cancel?key=${encodeURIComponent(key)}`;

async function email(to: string, subject: string, title: string, bodyHtml: string, key: string) {
  const html = shell({ title, bodyHtml: `${bodyHtml}${button(manageUrl(key), "Cancel this monthly payment")}` });
  const text = `${title}\n\n${bodyHtml.replace(/<[^>]+>/g, "")}\n\nCancel any time: ${manageUrl(key)}`;
  await sendMail(to, { subject, html, text });
}

export type NewPlan = {
  email: string;
  billerCode: string;
  itemCode: string;
  billerName: string;
  identifier: string;
  identifierLabel: string;
  customerName: string | null;
  feeKind: FeeKind;
  amountNgn: number;
  ip: string | null;
};

/** Called from checkout, before the first payment, once the customer has ticked the consent box. */
export async function createPendingPlan(p: NewPlan): Promise<{ id: string } | null> {
  if (!recurringEnabled()) return null;
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("recurring_plans")
    .insert({
      email: p.email,
      biller_code: p.billerCode,
      item_code: p.itemCode,
      biller_name: p.billerName,
      identifier: p.identifier,
      identifier_label: p.identifierLabel,
      customer_name: p.customerName,
      fee_kind: p.feeKind,
      amount_ngn: Math.round(p.amountNgn),
      status: "pending",
      consent_text: RECURRING_CONSENT_TEXT,
      consent_version: RECURRING_CONSENT_VERSION,
      consent_at: new Date().toISOString(),
      consent_ip: p.ip,
    })
    .select("id")
    .single();
  if (error) throw error;
  return { id: data.id };
}

/**
 * Called from the Paystack webhook when a charge carrying recurring_plan_id succeeds.
 * Activates the plan only if the card is reusable and the payer's email matches. Never throws.
 */
export async function activateFromWebhook(planId: string, data: any): Promise<void> {
  try {
    const db = supabaseAdmin();
    const { data: plan } = await db.from("recurring_plans").select("*").eq("id", planId).maybeSingle();
    if (!plan || (plan.status !== "pending" && plan.status !== "needs_action")) return;
    const paidEmail = String(data?.customer?.email ?? "").trim().toLowerCase();
    if (paidEmail !== plan.email) {
      await alertFounder("⚠️ Recurring plan email mismatch", `Plan ${planId}: payment email did not match the plan email. Not activated.`);
      return;
    }
    // The payer approved a charge that Paystack had paused. Resume the plan on its normal schedule.
    if (plan.status === "needs_action") {
      await db
        .from("recurring_plans")
        .update({ status: "active", failures: 0, next_run_on: addOneMonth(plan.next_run_on ?? lagosToday()), last_order_id: data?.metadata?.order_id ?? null, updated_at: new Date().toISOString() })
        .eq("id", planId);
      await log(planId, "charged", "approved by customer; plan resumed", data?.metadata?.order_id ?? undefined);
      return;
    }
    const auth = data?.authorization ?? {};
    if (auth.reusable !== true || !auth.authorization_code) {
      await db.from("recurring_plans").update({ status: "declined", updated_at: new Date().toISOString() }).eq("id", planId);
      await email(
        plan.email,
        "Monthly payment not set up",
        "We couldn't set up your monthly payment",
        `<p>Your bank card can't be charged automatically each month, so ${esc(plan.biller_name)} won't repeat. Your payment for this month went through as normal.</p>`,
        plan.manage_key
      );
      return;
    }
    await db
      .from("recurring_plans")
      .update({
        status: "active",
        authorization_code: auth.authorization_code,
        card_last4: auth.last4 ?? null,
        card_brand: auth.brand ?? null,
        next_run_on: addOneMonth(lagosToday()),
        updated_at: new Date().toISOString(),
      })
      .eq("id", planId);
    await email(
      plan.email,
      `Monthly ${plan.biller_name} payment is set up`,
      "Your monthly payment is set up",
      `<p>We'll pay <b>${esc(plan.biller_name)}</b> for <b>${esc(plan.identifier_label)} ${esc(plan.identifier)}</b> every month, on the same day, for ${naira(plan.amount_ngn)} plus the service fee shown at checkout.</p><p>We email you a day before each charge and send a receipt after delivery.</p>`,
      plan.manage_key
    );
  } catch (e) {
    console.error("[recurring] activation failed (non-fatal)", e);
  }
}

/** Runs once a day from the daily cron. Charges every active plan that is due today. */
export async function sweepRecurring(now: Date = new Date()): Promise<{ due: number; charged: number; skipped: number; failed: number }> {
  const out = { due: 0, charged: 0, skipped: 0, failed: 0 };
  if (!recurringEnabled()) return out;
  const today = lagosToday(now);
  const db = supabaseAdmin();
  const { data: due } = await db
    .from("recurring_plans")
    .select("*")
    .eq("status", "active")
    .lte("next_run_on", today)
    .limit(200);
  for (const plan of due ?? []) {
    out.due++;
    const r = await runPlan(plan, today);
    if (r === "charged") out.charged++;
    else if (r === "failed") out.failed++;
    else out.skipped++;
  }
  return out;
}

async function log(planId: string, outcome: string, note?: string | null, orderId?: string) {
  await supabaseAdmin().from("recurring_charge_log").insert({ plan_id: planId, outcome, note: note ?? null, order_id: orderId ?? null });
}

async function runPlan(plan: any, today: string): Promise<"charged" | "failed" | "skipped"> {
  const db = supabaseAdmin();

  // Claim today's attempt first, so two cron runs can never charge the same plan twice.
  const { data: claimed } = await db
    .from("recurring_plans")
    .update({ last_attempt_on: today, updated_at: new Date().toISOString() })
    .eq("id", plan.id)
    .eq("status", "active")
    .or(`last_attempt_on.is.null,last_attempt_on.lt.${today}`)
    .select("id");
  if (!claimed || claimed.length === 0) return "skipped";

  const amountNgn = Number(plan.amount_ngn);

  // The bill must still be buyable at this price, and we must still be able to deliver it.
  const purchase = await checkPurchase(plan.biller_code, plan.item_code, amountNgn);
  if (!purchase.ok) return needsAction(plan, "price or plan changed", purchase.error);

  if (amountNgn > ngnMaxOrder(getCountry("NG").maxLocal)) return needsAction(plan, "amount over limit", "The amount is now above our order limit.");

  try {
    await validateCustomer(plan.item_code, plan.biller_code, plan.identifier);
  } catch {
    const noValidate = /VTU|AIRTIME|DATA|BROADBAND|SURFLINE|POSTPAID PAYMENT/i.test(`${plan.biller_name} ${plan.item_code}`);
    if (!noValidate) return needsAction(plan, "customer check failed", "We could not re-check the account number.");
  }

  const cover = await walletCovers(amountNgn, { context: plan.biller_name, failover: true });
  if (!cover.ok) {
    await log(plan.id, "skipped", "delivery capacity unavailable; will retry tomorrow");
    return "skipped";
  }

  const feeNgn = ngnServiceFee(amountNgn, plan.fee_kind as FeeKind);
  const totalNgn = amountNgn + feeNgn;

  const { data: order, error } = await db
    .from("orders")
    .insert({
      email: plan.email,
      country: "NG",
      currency: "NGN",
      payment_provider: "paystack",
      biller_code: plan.biller_code,
      item_code: plan.item_code,
      biller_name: plan.biller_name,
      identifier: plan.identifier,
      identifier_label: plan.identifier_label,
      customer_name: plan.customer_name,
      amount_ngn: amountNgn,
      service_fee_local: feeNgn,
      fx_ngn_per_gbp: Number(process.env.NGN_PER_GBP ?? getCountry("NG").fxDefault),
      service_fee_pence: 0,
      amount_gbp_pence: 0,
      status: "pending_payment",
      ...(orderIsTest("paystack") ? { is_test: true } : {}),
    })
    .select("id")
    .single();
  if (error || !order) {
    await log(plan.id, "failed", `order insert failed: ${error?.message ?? "unknown"}`);
    return failCharge(plan);
  }

  await db.from("orders").update({ paystack_reference: paystackReferenceFor(order.id) }).eq("id", order.id);

  try {
    const res = await chargeAuthorization({
      email: plan.email,
      amountNgn: totalNgn,
      authorizationCode: plan.authorization_code,
      reference: paystackReferenceFor(order.id),
      metadata: { order_id: order.id, recurring_plan_id: plan.id },
    });

    if (res.paused || res.authorizationUrl) {
      // Paystack wants the payer to approve this charge. Nothing more is charged until they do.
      await db.from("orders").update({ status: "expired", error: "Monthly charge needs customer approval" }).eq("id", order.id);
      await db.from("recurring_plans").update({ status: "needs_action", updated_at: new Date().toISOString() }).eq("id", plan.id);
      await log(plan.id, "paused_for_customer", "Paystack asked for approval", order.id);
      await email(
        plan.email,
        `Please approve your monthly ${plan.biller_name} payment`,
        "Please approve this month's payment",
        `<p>Your bank needs you to approve this month's payment for <b>${esc(plan.biller_name)}</b>. Use the link below to approve it. Nothing is charged until you do.</p>` +
          (res.authorizationUrl ? `<p><a href="${esc(res.authorizationUrl)}">Approve the payment</a></p>` : ""),
        plan.manage_key
      );
      return "skipped";
    }

    if (res.status === "success") {
      await confirmPaystackPayment(order.id);
      await db
        .from("recurring_plans")
        .update({ next_run_on: addOneMonth(plan.next_run_on ?? today), failures: 0, last_order_id: order.id, updated_at: new Date().toISOString() })
        .eq("id", plan.id);
      await log(plan.id, "charged", null, order.id);
      return "charged";
    }

    // Any other status: treat as a failed charge and retry tomorrow.
    await log(plan.id, "failed", `status ${res.status}`, order.id);
    await db.from("orders").update({ status: "expired", error: `Monthly charge ${res.status}` }).eq("id", order.id);
    return failCharge(plan);
  } catch (e) {
    const note = e instanceof PaystackError ? e.message : String((e as any)?.message ?? e);
    await log(plan.id, "failed", note, order.id);
    await db.from("orders").update({ status: "expired", error: `Monthly charge error: ${note.slice(0, 200)}` }).eq("id", order.id);
    return failCharge(plan);
  }
}

async function failCharge(plan: any): Promise<"failed"> {
  const failures = Number(plan.failures ?? 0) + 1;
  const paused = failures >= MAX_FAILURES;
  await supabaseAdmin()
    .from("recurring_plans")
    .update({ failures, status: paused ? "paused" : "active", updated_at: new Date().toISOString() })
    .eq("id", plan.id);
  if (paused) {
    await email(
      plan.email,
      `Monthly ${plan.biller_name} payment paused`,
      "We've paused your monthly payment",
      `<p>Three monthly charges for <b>${esc(plan.biller_name)}</b> didn't go through, so we've paused it. Nothing more will be charged. Check your card, then set it up again at nolgic.com if you still want it.</p>`,
      plan.manage_key
    );
    await alertFounder("Recurring plan paused", `Plan ${plan.id}: ${MAX_FAILURES} failed charges.`);
  }
  return "failed";
}

async function needsAction(plan: any, reason: string, detail: string): Promise<"skipped"> {
  await supabaseAdmin().from("recurring_plans").update({ status: "needs_action", updated_at: new Date().toISOString() }).eq("id", plan.id);
  await log(plan.id, "skipped", reason);
  await email(
    plan.email,
    `Your monthly ${plan.biller_name} payment needs a check`,
    "Your monthly payment needs a check",
    `<p>We couldn't repeat the payment for <b>${esc(plan.biller_name)}</b> this month: ${esc(detail)}</p><p>Nothing has been charged. Set it up again at nolgic.com with the new details.</p>`,
    plan.manage_key
  );
  return "skipped";
}

/** Cancels a plan from its secret link. Idempotent. */
export async function cancelByKey(key: string): Promise<{ ok: boolean; biller?: string }> {
  if (!/^[0-9a-f-]{36}$/i.test(key)) return { ok: false };
  const db = supabaseAdmin();
  const { data: plan } = await db.from("recurring_plans").select("*").eq("manage_key", key).maybeSingle();
  if (!plan) return { ok: false };
  if (plan.status !== "cancelled") {
    await db.from("recurring_plans").update({ status: "cancelled", cancelled_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", plan.id);
    await log(plan.id, "skipped", "cancelled by customer");
    await email(
      plan.email,
      `Monthly ${plan.biller_name} payment cancelled`,
      "Your monthly payment is cancelled",
      `<p>We won't charge you for <b>${esc(plan.biller_name)}</b> again. You can still pay any bill whenever you like at nolgic.com.</p>`,
      plan.manage_key
    );
  }
  return { ok: true, biller: plan.biller_name };
}
