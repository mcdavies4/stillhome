// "Find my order": the customer types the email they paid with and we EMAIL them their recent orders.
// Nothing is ever shown on the page, so nobody can use it to find out whose email is a customer, and the
// links in the email go only to the address that was used at checkout. The links are the order pages
// (/order/<id>), which hold the receipt and the meter token.

import { supabaseAdmin } from "@/lib/supabase";
import { appUrl, button, esc, naira, sendMail, shell, type Mail } from "@/lib/mailer";
import { createHash } from "node:crypto";

const STATUS_WORDS: Record<string, string> = {
  fulfilled: "Delivered",
  paid: "Paid, being delivered",
  needs_review: "Paid, we are confirming delivery",
  failed_refunded: "Not delivered, refunded",
  refund_failed: "Needs our attention, email us",
  pending_payment: "Not paid",
};
export const statusWord = (s: string) => STATUS_WORDS[s] ?? s;

export const LOOKUP_DAYS = 90;
export const LOOKUP_MAX_ORDERS = 8;
/** Per email address: at most this many lookup emails per hour (stops anyone mail-bombing somebody else). */
export const LOOKUP_PER_EMAIL_PER_HOUR = 3;
/** Per IP address: at most this many lookups per 15 minutes. */
export const LOOKUP_PER_IP = 6;

export type LookupOrder = { id: string; biller_name: string | null; identifier: string | null; amount_ngn: number | string; status: string; created_at: string; has_token?: boolean };

export function lookupEmail(orders: LookupOrder[], app = appUrl()): Mail {
  const rows = orders.slice(0, LOOKUP_MAX_ORDERS);
  const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/London" });
  const tail = (s: string | null) => (s && s.length > 4 ? `…${s.slice(-4)}` : s ?? "");
  const li = rows.map((o) => {
    const link = `${app}/order/${o.id}`;
    return `<li style="margin:0 0 12px"><a href="${esc(link)}" style="color:#12151e;font-weight:700">${esc(String(o.biller_name ?? "Order").replace(/\s+VTU$/i, ""))} ${esc(naira(o.amount_ngn))}</a><br><span style="color:#666;font-size:14px">${esc(day(o.created_at))} · ${esc(tail(o.identifier))} · ${esc(statusWord(o.status))}</span></li>`;
  }).join("");
  const text = rows.map((o) => `${String(o.biller_name ?? "Order").replace(/\s+VTU$/i, "")} ${naira(o.amount_ngn)} (${day(o.created_at)}, ${tail(o.identifier)}): ${statusWord(o.status)}\n${app}/order/${o.id}`).join("\n\n");
  return {
    subject: "Your recent Nolgic orders",
    html: shell({
      title: "Your recent Nolgic orders",
      bodyHtml: `<p>You asked us to find your orders. Open one to see the receipt and your meter token.</p><ul style="padding-left:18px;margin:14px 0">${li}</ul><p>If you did not ask for this, you can ignore it. Nobody else can see this email.</p>`,
      footerHtml: "Reply to this email if anything is wrong with an order.",
    }),
    text: `You asked us to find your recent Nolgic orders.\n\n${text}\n\nIf you did not ask for this, ignore this email.`,
  };
}

const hash = (e: string) => createHash("sha256").update(e).digest("hex").slice(0, 20);
export const lookupRoute = (email: string) => `find-order:${hash(email)}`;

/**
 * Sends the lookup email if there is something to send. Returns what happened for tests and logs only:
 * the HTTP route answers the same way whatever this returns.
 */
export async function sendOrderLookup(email: string, ip: string): Promise<"sent" | "none" | "throttled" | "mail_failed"> {
  const db = supabaseAdmin();
  const route = lookupRoute(email);
  try {
    const since = new Date(Date.now() - 3600_000).toISOString();
    const { count } = await db.from("request_log").select("id", { count: "exact", head: true }).eq("route", route).gte("created_at", since);
    if ((count ?? 0) >= LOOKUP_PER_EMAIL_PER_HOUR) return "throttled";
    await db.from("request_log").insert({ ip, route });
  } catch (e) { console.error("[find-order] throttle check failed", e); }

  const since = new Date(Date.now() - LOOKUP_DAYS * 86400_000).toISOString();
  const { data, error } = await db.from("orders")
    .select("id,biller_name,identifier,amount_ngn,status,created_at,is_test,flw_token")
    .eq("email", email).gte("created_at", since).order("created_at", { ascending: false }).limit(40);
  if (error) { console.error("[find-order] query failed", error.message); return "none"; }
  const orders = ((data ?? []) as any[]).filter((o) => !o.is_test && o.status !== "expired").slice(0, LOOKUP_MAX_ORDERS);
  if (!orders.length) return "none";
  return (await sendMail(email, lookupEmail(orders))) ? "sent" : "mail_failed";
}
