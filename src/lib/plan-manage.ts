// src/lib/plan-manage.ts — customer side of monthly plans: a sign-in link to see and manage every plan,
// pause / resume / cancel, the day-before reminder, and marketing opt-out.
// Self-contained (no import from recurring.ts) so the two modules don't depend on each other.

import crypto from "crypto";
import { supabaseAdmin } from "@/lib/supabase";
import { sendMail, shell, button, esc, appUrl, naira } from "@/lib/mailer";
import { checkPurchase, currentItemPrice } from "@/lib/bills";
import { ngnMaxOrder } from "@/lib/ngn-fee";
import { getCountry } from "@/lib/countries";

// ───────── signed links (no login: a link is valid for a short time, and is tied to one email) ─────────

function secret(): string {
  const s = process.env.RECURRING_LINK_SECRET;
  if (!s) throw new Error("RECURRING_LINK_SECRET is not set");
  return s;
}

export function signLink(purpose: "plans" | "optout", email: string, ttlMinutes: number): string {
  const payload = Buffer.from(JSON.stringify({ p: purpose, e: email.trim().toLowerCase(), x: Date.now() + ttlMinutes * 60_000 })).toString("base64url");
  const sig = crypto.createHmac("sha256", secret()).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export function verifyLink(purpose: "plans" | "optout", token: string | null | undefined): string | null {
  if (!token || token.length > 600) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const want = crypto.createHmac("sha256", secret()).update(payload).digest("base64url");
  const a = Buffer.from(sig), b = Buffer.from(want);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const d = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (d.p !== purpose || typeof d.e !== "string" || typeof d.x !== "number" || d.x < Date.now()) return null;
    return d.e;
  } catch {
    return null;
  }
}

export const plansPageUrl = (token: string) => `${appUrl()}/plans?token=${encodeURIComponent(token)}`;
export const optoutUrl = (email: string) => `${appUrl()}/api/optout?token=${encodeURIComponent(signLink("optout", email, 60 * 24 * 365 * 5))}`;

/** Emails a sign-in link (30 minutes). Sends only when the email has a live plan, but callers always answer the same way. */
export async function sendPlansLink(email: string): Promise<void> {
  if (!(await anyPlanFor(email))) return;
  const token = signLink("plans", email, 30);
  await sendMail(email, {
    subject: "Your Nolgic monthly payments",
    html: shell({
      title: "Manage your monthly payments",
      bodyHtml:
        `<p>Use this link to see, pause or cancel your monthly payments. It works for 30 minutes.</p>` +
        button(plansPageUrl(token), "Open my monthly payments"),
    }),
    text: `See, pause or cancel your monthly payments (link valid 30 minutes): ${plansPageUrl(token)}`,
  });
}

// ───────── dates (Lagos time) ─────────

export const lagosToday = (now: Date = new Date()) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);

export function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** The next date on or after `fromYmd` that falls on the same day of the month as `dueYmd`. */
export function nextRunOnAfter(fromYmd: string, dueYmd: string): string {
  const day = Number(dueYmd.split("-")[2]);
  const [y, m] = fromYmd.split("-").map(Number);
  for (let k = 0; k < 14; k++) {
    const d = new Date(Date.UTC(y, m - 1 + k, 1));
    const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    const cand = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), Math.min(day, last))).toISOString().slice(0, 10);
    if (cand >= fromYmd) return cand;
  }
  return fromYmd;
}

// ───────── listing and actions ─────────

const VISIBLE = ["active", "on_hold", "needs_action", "paused"];

export async function listPlansForEmail(email: string) {
  const db = supabaseAdmin();
  const { data } = await db
    .from("recurring_plans")
    .select("id, biller_name, identifier, identifier_label, customer_name, amount_ngn, pending_amount_ngn, status, next_run_on, card_last4, card_brand, failures")
    .eq("email", email.toLowerCase())
    .in("status", VISIBLE)
    .order("created_at", { ascending: false });
  const plans = data ?? [];
  if (plans.length === 0) return [];

  // Past successful charges for these plans, newest first, with the amounts from their orders.
  const { data: logs } = await db
    .from("recurring_charge_log")
    .select("plan_id, order_id, created_at")
    .in("plan_id", plans.map((p) => p.id))
    .eq("outcome", "charged")
    .order("created_at", { ascending: false })
    .limit(60);
  const orderIds = (logs ?? []).map((l) => l.order_id).filter(Boolean) as string[];
  const { data: orders } = orderIds.length
    ? await db.from("orders").select("id, amount_ngn, service_fee_local").in("id", orderIds)
    : { data: [] as any[] };
  const byOrder = new Map((orders ?? []).map((o: any) => [o.id, o]));

  return plans.map((p) => ({
    ...p,
    history: (logs ?? [])
      .filter((l) => l.plan_id === p.id)
      .slice(0, 6)
      .map((l) => {
        const o: any = byOrder.get(l.order_id);
        return { at: l.created_at, order_id: l.order_id, amount_ngn: o?.amount_ngn ?? null, fee_ngn: o?.service_fee_local ?? null };
      }),
  }));
}

export async function anyPlanFor(email: string): Promise<boolean> {
  const { count } = await supabaseAdmin()
    .from("recurring_plans")
    .select("id", { count: "exact", head: true })
    .eq("email", email.toLowerCase())
    .in("status", VISIBLE);
  return (count ?? 0) > 0;
}

export type PlanAction = "pause" | "resume" | "cancel" | "approve_price";

/** Acts on one plan, only if it belongs to the signed-in email. */
export async function actOnPlan(email: string, planId: string, action: PlanAction): Promise<{ ok: boolean; error?: string }> {
  const db = supabaseAdmin();
  const { data: plan } = await db.from("recurring_plans").select("*").eq("id", planId).maybeSingle();
  if (!plan || plan.email !== email.toLowerCase()) return { ok: false, error: "Plan not found" };
  const now = new Date().toISOString();

  if (action === "pause") {
    if (plan.status !== "active") return { ok: false, error: "Only an active plan can be paused" };
    await db.from("recurring_plans").update({ status: "on_hold", paused_at: now, updated_at: now }).eq("id", planId);
    await db.from("recurring_charge_log").insert({ plan_id: planId, outcome: "skipped", note: "paused by customer" });
    return { ok: true };
  }
  if (action === "resume") {
    if (plan.status !== "on_hold") return { ok: false, error: "Only a paused plan can be resumed" };
    const today = lagosToday();
    const next = nextRunOnAfter(today, plan.next_run_on ?? today);
    await db.from("recurring_plans").update({ status: "active", paused_at: null, failures: 0, next_run_on: next, updated_at: now }).eq("id", planId);
    await db.from("recurring_charge_log").insert({ plan_id: planId, outcome: "skipped", note: "resumed by customer" });
    return { ok: true };
  }
  if (action === "approve_price") {
    if (plan.status !== "needs_action" || !plan.pending_amount_ngn) return { ok: false, error: "There is no new price to approve on this plan" };
    const newAmt = Number(plan.pending_amount_ngn);
    if (newAmt > ngnMaxOrder(getCountry("NG").maxLocal)) return { ok: false, error: "This amount is above our order limit, so it can't be approved." };
    const check = await checkPurchase(plan.biller_code, plan.item_code, newAmt);
    if (!check.ok) {
      // The price moved again: store the latest one and ask again.
      const latest = await currentItemPrice(plan.biller_code, plan.item_code).catch(() => null);
      if (latest && latest !== newAmt) {
        await db.from("recurring_plans").update({ pending_amount_ngn: latest, updated_at: now }).eq("id", planId);
        return { ok: false, error: `The price changed again, to ${naira(latest)}. Check the new price and approve again.` };
      }
      return { ok: false, error: check.error ?? "This bill is not available right now. Try again later." };
    }
    await db.from("recurring_plans").update({ status: "active", amount_ngn: newAmt, pending_amount_ngn: null, failures: 0, updated_at: now }).eq("id", planId);
    await db.from("recurring_charge_log").insert({ plan_id: planId, outcome: "skipped", note: "new price approved by customer" });
    await sendMail(plan.email, {
      subject: `Monthly ${plan.biller_name} payment: new price approved`,
      html: shell({ title: "New price approved", bodyHtml: `<p>Your monthly payment for <b>${esc(plan.biller_name)}</b> is now ${naira(newAmt)} plus the service fee. We'll charge the new amount on your next charge date.</p>` }),
      text: `Your monthly payment for ${plan.biller_name} is now ${naira(newAmt)} plus the service fee. We'll charge the new amount on your next charge date.`,
    });
    return { ok: true };
  }
  if (action === "cancel") {
    if (plan.status === "cancelled") return { ok: true };
    await db.from("recurring_plans").update({ status: "cancelled", cancelled_at: now, updated_at: now }).eq("id", planId);
    await db.from("recurring_charge_log").insert({ plan_id: planId, outcome: "skipped", note: "cancelled by customer" });
    await sendMail(plan.email, {
      subject: `Monthly ${plan.biller_name} payment cancelled`,
      html: shell({ title: "Your monthly payment is cancelled", bodyHtml: `<p>We won't charge you for <b>${esc(plan.biller_name)}</b> again.</p>` }),
      text: `Your monthly payment for ${plan.biller_name} is cancelled. We won't charge you again.`,
    });
    return { ok: true };
  }
  return { ok: false, error: "Unknown action" };
}

// ───────── day-before reminder ─────────

/** Emails each active plan whose charge is tomorrow. Runs from the daily cron. Never throws. */
export async function sendReminders(now: Date = new Date()): Promise<number> {
  const db = supabaseAdmin();
  const tomorrow = addDays(lagosToday(now), 1);
  const { data } = await db
    .from("recurring_plans")
    .select("id, email, biller_name, identifier_label, identifier, amount_ngn, last_reminder_on, next_run_on")
    .eq("status", "active")
    .eq("next_run_on", tomorrow);
  let sent = 0;
  for (const p of data ?? []) {
    if (p.last_reminder_on === tomorrow) continue;
    try {
      const token = signLink("plans", p.email, 60 * 24 * 7);
      const ok = await sendMail(p.email, {
        subject: `Tomorrow: your monthly ${p.biller_name} payment`,
        html: shell({
          title: "Your monthly payment is tomorrow",
          bodyHtml:
            `<p>Tomorrow we'll charge your card ${naira(p.amount_ngn)} plus the service fee to pay <b>${esc(p.biller_name)}</b> for ${esc(p.identifier_label)} ${esc(p.identifier)}.</p>` +
            `<p>Want to skip or stop it? You can do that any time.</p>` +
            button(plansPageUrl(token), "Manage my monthly payments"),
        }),
        text: `Tomorrow we'll charge ${naira(p.amount_ngn)} plus the service fee for ${p.biller_name}. Manage: ${plansPageUrl(token)}`,
      });
      if (ok) {
        await db.from("recurring_plans").update({ last_reminder_on: tomorrow }).eq("id", p.id);
        sent++;
      }
    } catch (e) {
      console.error("[plans] reminder failed (non-fatal)", e);
    }
  }
  return sent;
}

// ───────── replies ─────────

/** True when a customer's reply asks to stop: the first line starts with stop, unsubscribe, remove or opt out. */
export function isStopReply(text: string): boolean {
  const first = text.split(/\r?\n/).map((l) => l.trim()).find((l) => l.length > 0) ?? "";
  return /^(stop|unsubscribe|opt[- ]?out|remove( me)?|cancel)\b/i.test(first);
}

// ───────── marketing opt-out ─────────

export async function optOut(email: string, source: string) {
  await supabaseAdmin().from("email_optouts").upsert({ email: email.trim().toLowerCase(), source }, { onConflict: "email" });
}

/** Removes anyone who has opted out. Use before any marketing send. */
export async function removeOptedOut(emails: string[]): Promise<string[]> {
  if (emails.length === 0) return emails;
  const lower = emails.map((e) => e.trim().toLowerCase());
  const out = new Set<string>();
  for (let i = 0; i < lower.length; i += 200) {
    const chunk = lower.slice(i, i + 200);
    const { data } = await supabaseAdmin().from("email_optouts").select("email").in("email", chunk);
    (data ?? []).forEach((r: any) => out.add(r.email));
  }
  return lower.filter((e) => !out.has(e));
}
