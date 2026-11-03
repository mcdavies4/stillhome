// Follow-up for abandoned orders: one short email, once, asking what stopped them, with one-tap reasons.
// Nothing here is on the payment path. It only READS orders and writes to its own two tables.
//
// Who gets an email (all must be true):
//   - the order was started (pending_payment) or timed out (expired), 60 minutes to 48 hours ago
//   - it has an email, is not a test order, and was never paid
//   - the same email has not paid for anything since, has not been emailed by us in the last 7 days, and has not opted out
//   - it is between 08:00 and 21:00 in Nigeria (otherwise it waits for the next run)
// At most MAX_PER_RUN emails per run.

import { supabaseAdmin } from "@/lib/supabase";
import { randomUUID } from "node:crypto";

export const REASONS: { key: string; label: string }[] = [
  { key: "payment_failed", label: "My payment didn't go through" },
  { key: "too_expensive", label: "The price or fee was too high" },
  { key: "wrong_details", label: "I couldn't find or confirm my meter, card or number" },
  { key: "not_sure_safe", label: "I wasn't sure it was safe" },
  { key: "confusing", label: "The site was slow or confusing" },
  { key: "just_looking", label: "I was just looking" },
  { key: "other", label: "Something else" },
];
export const reasonLabel = (k: string | null) => REASONS.find((r) => r.key === k)?.label ?? (k ?? "");

const MAX_PER_RUN = 25;
const MIN_AGE_MS = 60 * 60_000;
const MAX_AGE_MS = 48 * 3600_000;
const COOLDOWN_MS = 7 * 24 * 3600_000;
const WAT_HOUR = (ms: number) => new Date(ms + 3600_000).getUTCHours(); // Nigeria is UTC+1, no daylight saving

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
const naira = (n: number) => `₦${Math.round(Number(n)).toLocaleString("en-NG")}`;

export function followupEmail(o: { biller_name: string | null; amount_ngn: number | string }, token: string) {
  const app = process.env.NEXT_PUBLIC_APP_URL ?? "https://www.nolgic.com";
  const item = `${o.biller_name || "your order"} (${naira(Number(o.amount_ngn))})`;
  const link = `${app}/feedback/${token}`;
  const subject = "Did something go wrong with your Nolgic order?";
  const html = `
  <div style="font-family:system-ui,Arial,sans-serif;max-width:520px;margin:0 auto;color:#12151e;line-height:1.55">
    <h2 style="margin:0 0 10px">Did something go wrong?</h2>
    <p>You started an order for <b>${esc(item)}</b> on Nolgic, but it wasn't completed. <b>No money was taken for it.</b></p>
    <p>We'd like to know what got in the way, so we can fix it. It takes ten seconds:</p>
    <p style="margin:18px 0"><a href="${link}" style="background:#FFB627;color:#0B1026;text-decoration:none;font-weight:700;padding:13px 20px;border-radius:12px;display:inline-block">Tell us what happened</a></p>
    <p>Or just reply to this email. A real person reads every reply.</p>
    <p style="margin-top:22px">If you still want it, you can start again any time at <a href="${app}">nolgic.com</a>.</p>
    <p style="color:#999;font-size:12px;margin-top:26px">The 36th Solutions Ltd, trading as Nolgic. You got this one email because you started an order with this address. We won't send another for this order.
    <a href="${link}?stop=1" style="color:#999">Don't email me like this again</a>.</p>
  </div>`;
  const text = `You started an order for ${item} on Nolgic, but it wasn't completed. No money was taken.\n\nTell us what got in the way (ten seconds): ${link}\nOr just reply to this email.\n\nStart again any time: ${app}\n\nStop these emails: ${link}?stop=1`;
  return { subject, html, text };
}

async function sendEmail(to: string, m: { subject: string; html: string; text: string }): Promise<boolean> {
  if (!process.env.RESEND_API_KEY) return false;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
      body: JSON.stringify({
        from: process.env.RESEND_FROM ?? "Nolgic <noreply@songsnap.online>",
        reply_to: process.env.SUPPORT_EMAIL ?? "nolgichq@gmail.com",
        to, subject: m.subject, html: m.html, text: m.text,
      }),
    });
    if (!res.ok) { console.error("[followup] send failed", res.status, await res.text()); return false; }
    return true;
  } catch (e) { console.error("[followup] send error", e); return false; }
}

export type SweepResult = { considered: number; sent: number; skipped: Record<string, number>; note?: string };

export async function sweepFollowups(opts: { now?: number; max?: number; ignoreHours?: boolean } = {}): Promise<SweepResult> {
  const now = opts.now ?? Date.now();
  const max = opts.max ?? MAX_PER_RUN;
  const skipped: Record<string, number> = {};
  const skip = (why: string) => { skipped[why] = (skipped[why] ?? 0) + 1; };
  if (!process.env.RESEND_API_KEY) return { considered: 0, sent: 0, skipped, note: "RESEND_API_KEY missing" };
  const h = WAT_HOUR(now);
  if (!opts.ignoreHours && (h < 8 || h >= 21)) return { considered: 0, sent: 0, skipped, note: "outside 08:00-21:00 Nigeria time" };

  const db = supabaseAdmin();
  const since = new Date(now - MAX_AGE_MS).toISOString();
  const before = new Date(now - MIN_AGE_MS).toISOString();
  const { data: cand, error } = await db.from("orders").select("*").in("status", ["pending_payment", "expired"]).gte("created_at", since).lt("created_at", before).order("created_at", { ascending: true }).limit(300);
  if (error) throw error;
  const orders = ((cand ?? []) as any[]).filter((o) => {
    const t = new Date(o.created_at).getTime();
    return t >= now - MAX_AGE_MS && t <= now - MIN_AGE_MS; // (also enforced here, whatever the query did)
  });
  if (!orders.length) return { considered: 0, sent: 0, skipped };

  const emails = Array.from(new Set(orders.map((o) => String(o.email ?? "").trim().toLowerCase()).filter(Boolean)));
  const [{ data: done }, { data: opt }, { data: paid }, { data: recent }] = await Promise.all([
    db.from("order_followups").select("order_id").in("order_id", orders.map((o) => o.id)),
    db.from("followup_optout").select("email").in("email", emails),
    db.from("orders").select("email,created_at,status").in("email", emails).in("status", ["paid", "fulfilled", "needs_review"]).gte("created_at", since),
    db.from("order_followups").select("email,sent_at").in("email", emails).gte("sent_at", new Date(now - COOLDOWN_MS).toISOString()),
  ]);
  const doneIds = new Set(((done ?? []) as any[]).map((r) => r.order_id));
  const optOut = new Set(((opt ?? []) as any[]).map((r) => String(r.email).toLowerCase()));
  const paidAfter = (email: string, at: string) => ((paid ?? []) as any[]).some((p) => String(p.email).toLowerCase() === email && new Date(p.created_at) >= new Date(at));
  const emailedRecently = new Set(((recent ?? []) as any[]).filter((r) => new Date(r.sent_at).getTime() >= now - COOLDOWN_MS).map((r) => String(r.email).toLowerCase()));

  let sent = 0;
  for (const o of orders) {
    if (sent >= max) break;
    const email = String(o.email ?? "").trim().toLowerCase();
    if (!email) { skip("no email"); continue; }
    if (o.is_test) { skip("test order"); continue; }
    if (doneIds.has(o.id)) { skip("already followed up"); continue; }
    if (optOut.has(email)) { skip("opted out"); continue; }
    if (emailedRecently.has(email)) { skip("emailed this week"); continue; }
    if (paidAfter(email, o.created_at)) { skip("paid since"); continue; }

    // Claim the order first (the unique key stops two runs sending the same email), then send; give the claim back if the send fails.
    const token = randomUUID();
    const { error: claimErr } = await db.from("order_followups").insert({ order_id: o.id, email, token });
    if (claimErr) { skip("claim failed"); continue; }
    const ok = await sendEmail(email, followupEmail(o, token));
    if (!ok) { await db.from("order_followups").delete().eq("order_id", o.id); skip("send failed"); continue; }
    emailedRecently.add(email);
    sent++;
  }
  return { considered: orders.length, sent, skipped };
}
