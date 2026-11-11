// Top-up reminders: one gentle email when a customer is probably about to run low on light or TV.
// It only READS orders and writes to its own two tables. Nothing here is on the payment path.
//
// Who gets one (all must be true):
//   - the order is their LATEST delivered order for that meter or smartcard (electricity or TV only)
//   - it is not a test order, has an email, and the email has not opted out
//   - the predicted run-out is close: their own usual gap for that meter (the median of their past gaps, kept between
//     7 and 45 days) or, with only one order so far, 21 days for light and 28 days for TV. The email goes out
//     LEAD_DAYS (2) BEFORE that point, so there is time to top up before the lights go off
//   - it is no more than 10 days past that point (an old order never gets a late "you must be low" email)
//   - that order has not been reminded about before, and the email has had no reminder in the last 7 days
//   - it is between 09:00 and 19:00 UK time
// At most MAX_PER_RUN emails per run.

import { supabaseAdmin } from "@/lib/supabase";
import { feeKindOf } from "@/lib/ngn-fee";
import { appUrl, button, esc, naira, sendMail, shell, type Mail } from "@/lib/mailer";
import { randomUUID } from "node:crypto";
import { tgRemind } from "@/lib/tg/remind";

const DAY = 86400_000;
export const MAX_PER_RUN = 25;
export const DEFAULT_GAP_DAYS = { electricity: 21, tv: 28 } as const;
export const MIN_GAP_DAYS = 7;
export const MAX_GAP_DAYS = 45;
export const GRACE_DAYS = 10;
export const LEAD_DAYS = 2;
export const COOLDOWN_DAYS = 7;
export const HISTORY_DAYS = 180;

export type Hist = { id: string; email: string; identifier: string; biller_code?: string | null; item_code?: string | null; biller_name?: string | null; amount_ngn: number | string; created_at: string };
export type Due = { order: Hist; kind: "electricity" | "tv"; gapDays: number; basis: "own history" | "usual"; ageDays: number };
/** One meter or smartcard and when it is expected to need a top-up. daysLeft is negative once the usual gap has passed. */
export type Forecast = Due & { daysLeft: number; runOutAt: number };

const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

/** UK clock hour (the one place daylight saving matters, so it is computed, not guessed). */
export function ukHour(ms: number): number {
  return Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone: "Europe/London" }).format(new Date(ms))) % 24;
}

export function kindOfOrder(o: Pick<Hist, "biller_code" | "item_code" | "biller_name">): "electricity" | "tv" | null {
  const k = feeKindOf({ biller_code: o.biller_code, item_code: o.item_code, biller_name: o.biller_name });
  if (k === "airtime_data") return null;
  // feeKindOf treats anything unknown as electricity (the safe choice for fees). For a reminder the safe choice is the opposite.
  const t = `${o.biller_name ?? ""} ${o.item_code ?? ""}`;
  if (k === "electricity" && !/ELECTRIC|POWER|DISCO|PREPAID|POSTPAID/i.test(t)) return null;
  return k;
}

/** Pure: for every meter or smartcard in the history, when it is expected to run out. Used by the emails and the account page. */
export function forecastMeters(history: Hist[], now: number): Forecast[] {
  const groups = new Map<string, Hist[]>();
  for (const h of history) {
    const email = String(h.email ?? "").trim().toLowerCase();
    if (!email || !h.identifier) continue;
    const kind = kindOfOrder(h);
    if (!kind) continue;
    const key = `${email}|${kind}|${h.identifier}`;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push({ ...h, email });
  }
  const out: Forecast[] = [];
  for (const [key, list] of Array.from(groups.entries())) {
    list.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    const last = list[list.length - 1];
    const kind = key.split("|")[1] as "electricity" | "tv";
    const gaps: number[] = [];
    for (let i = 1; i < list.length; i++) gaps.push((new Date(list[i].created_at).getTime() - new Date(list[i - 1].created_at).getTime()) / DAY);
    const own = gaps.length >= 1;
    const gapDays = own ? Math.min(MAX_GAP_DAYS, Math.max(MIN_GAP_DAYS, Math.round(median(gaps)))) : DEFAULT_GAP_DAYS[kind];
    const lastMs = new Date(last.created_at).getTime();
    const ageDays = (now - lastMs) / DAY;
    out.push({ order: last, kind, gapDays, basis: own ? "own history" : "usual", ageDays, daysLeft: gapDays - ageDays, runOutAt: lastMs + gapDays * DAY });
  }
  return out;
}

/** Pure: given delivered orders, who is due a reminder now. Tested without a database. */
export function planReminders(
  history: Hist[],
  o: { now: number; optOut: Set<string>; remindedOrders: Set<string>; recentlyEmailed: Set<string>; max?: number },
): Due[] {
  const due: Due[] = [];
  for (const f of forecastMeters(history, o.now)) {
    // From LEAD_DAYS before the predicted run-out until GRACE_DAYS after it.
    if (f.daysLeft > LEAD_DAYS || f.ageDays > f.gapDays + GRACE_DAYS) continue;
    if (o.optOut.has(f.order.email) || o.remindedOrders.has(f.order.id) || o.recentlyEmailed.has(f.order.email)) continue;
    due.push(f);
  }
  due.sort((a, b) => b.ageDays - a.ageDays);
  // one email per address per run, even if they have two meters
  const seen = new Set<string>();
  const out = due.filter((d) => (seen.has(d.order.email) ? false : (seen.add(d.order.email), true)));
  return out.slice(0, o.max ?? MAX_PER_RUN);
}

export function reminderEmail(d: Due, token: string, app = appUrl()): Mail {
  const o = d.order;
  const days = Math.max(1, Math.round(d.ageDays));
  const tail = o.identifier.length > 4 ? `…${o.identifier.slice(-4)}` : o.identifier;
  const what = d.kind === "tv" ? `your ${String(o.biller_name ?? "TV").replace(/\s+VTU$/i, "")} subscription (card ${tail})` : `light on meter ${tail}`;
  const subject = d.kind === "tv" ? "Time to renew your TV?" : "Running low on light?";
  const link = `${app}/?rt=${token}#pay`;   // opens checkout with this meter, plan, amount and email already filled
  const stop = `${app}/reminders/${token}`;
  const runOut = new Date(new Date(o.created_at).getTime() + d.gapDays * DAY).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Africa/Lagos" });
  // If Pay for Me is open, offer the other way out: a friend or relative can cover it. Nothing is promised that isn't switched on.
  const pfm = process.env.NEXT_PUBLIC_PAYFORME_ENABLED === "1";
  const bills = pfm && process.env.NEXT_PUBLIC_BILLSLINK_ENABLED === "1";
  const family = !pfm ? null : bills
    ? { html: `<a href="${app}/ask" style="color:#666">Ask a friend or relative to pay it</a>, or <a href="${app}/for/new" style="color:#666">make a bills link</a> they can use any time.`, text: `Ask someone to pay it: ${app}/ask . Or make a bills link: ${app}/for/new` }
    : { html: `<a href="${app}/ask" style="color:#666">Ask a friend or relative to pay it</a>.`, text: `Ask someone to pay it: ${app}/ask` };
  const guess = d.basis === "own history"
    ? ` You usually top up about every ${d.gapDays} days, so it may run out around ${runOut}.`
    : "";
  const line = d.kind === "tv"
    ? `It has been ${days} days since you paid ${naira(o.amount_ngn)} for ${esc(what)}.${guess} If it is about to run out, you can renew it in a minute.`
    : `It has been ${days} days since you paid ${naira(o.amount_ngn)} for ${esc(what)}.${guess} If the units are getting low, you can top up in a minute.`;
  return {
    subject,
    html: shell({
      title: subject,
      bodyHtml: `<p>${line}</p>${button(link, d.kind === "tv" ? "Renew now" : "Top up now")}<p>You see the account name before any money moves, and you get your receipt${d.kind === "tv" ? "" : " and token"} by email.</p>${family ? `<p style="color:#666">Would you rather someone else covered it? ${family.html}</p>` : ""}`,
      footerHtml: `You got this because you paid for this with us before. We send at most one of these per payment. <a href="${esc(stop)}" style="color:#999">Stop these reminders</a>.`,
    }),
    text: `${line.replace(/&[a-z]+;/g, "")}\n\n${d.kind === "tv" ? "Renew" : "Top up"}: ${link}${family ? `\n\nWould you rather someone else covered it? ${family.text}` : ""}\n\nStop these reminders: ${stop}`,
  };
}

export type SweepResult = { considered: number; due: number; sent: number; note?: string };

export async function sweepReminders(opts: { now?: number; max?: number; ignoreHours?: boolean } = {}): Promise<SweepResult> {
  const now = opts.now ?? Date.now();
  if (!process.env.RESEND_API_KEY) return { considered: 0, due: 0, sent: 0, note: "RESEND_API_KEY missing" };
  const h = ukHour(now);
  if (!opts.ignoreHours && (h < 9 || h >= 19)) return { considered: 0, due: 0, sent: 0, note: "outside 09:00-19:00 UK time" };

  const db = supabaseAdmin();
  const since = new Date(now - HISTORY_DAYS * DAY).toISOString();
  const { data, error } = await db.from("orders")
    .select("id,email,identifier,biller_code,item_code,biller_name,amount_ngn,created_at,is_test")
    .eq("status", "fulfilled").gte("created_at", since).order("created_at", { ascending: false }).limit(1000);
  if (error) throw error;
  const history = ((data ?? []) as any[]).filter((o) => !o.is_test) as Hist[];
  if (!history.length) return { considered: 0, due: 0, sent: 0 };

  const emails = Array.from(new Set(history.map((o) => String(o.email ?? "").trim().toLowerCase()).filter(Boolean)));
  const [{ data: opt }, { data: logged }] = await Promise.all([
    db.from("reminder_optout").select("email").in("email", emails),
    db.from("reminder_log").select("order_id,email,sent_at").in("email", emails),
  ]);
  const optOut = new Set(((opt ?? []) as any[]).map((r) => String(r.email).toLowerCase()));
  const remindedOrders = new Set(((logged ?? []) as any[]).map((r) => r.order_id as string));
  const recentlyEmailed = new Set(((logged ?? []) as any[]).filter((r) => new Date(r.sent_at).getTime() >= now - COOLDOWN_DAYS * DAY).map((r) => String(r.email).toLowerCase()));

  const due = planReminders(history, { now, optOut, remindedOrders, recentlyEmailed, max: opts.max });
  let sent = 0;
  for (const d of due) {
    // Claim first (the primary key stops two runs sending the same reminder), then send; give the claim back if the send fails.
    const token = randomUUID();
    const { error: claimErr } = await db.from("reminder_log").insert({ order_id: d.order.id, email: d.order.email, identifier: d.order.identifier, token });
    if (claimErr) continue;
    const ok = await sendMail(d.order.email, reminderEmail(d, token));
    if (!ok) { await db.from("reminder_log").delete().eq("order_id", d.order.id); continue; }
    sent++;
    await tgRemind(d, token); // customers who also use the Telegram bot get it there too (best effort, never throws)
  }
  return { considered: history.length, due: due.length, sent };
}
