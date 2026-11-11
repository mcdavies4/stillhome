// src/lib/tg/stats.ts
// The owner's numbers for /stats and /failed. Pure: it takes rows and returns text, so it can be tested without a database.

import { esc } from "./api";

const naira = (n: number) => `₦${Math.round(n).toLocaleString("en-NG")}`;
const WAT_MS = 3600_000; // Nigeria is UTC+1 all year

export interface StatOrder { id?: string; status: string; amount_ngn: number | string; source?: string | null; created_at: string; rep?: string | null; is_test?: boolean | null }

export interface Period { orders: number; delivered: number; deliveredNgn: number; refunded: number; stuck: number; tgOrders: number; tgDelivered: number; tgDeliveredNgn: number }
export interface StatsData {
  today: Period;
  week: Period;
  reps: { code: string; orders: number; delivered: number; deliveredNgn: number; viaTelegram: number }[];
  users: { total: number; newToday: number; blocked: number; optedOut: number };
  /** Where this week's new bot customers came from: a Nolgic button (hero, footer...), a rep link, or just found the bot. */
  sources?: { label: string; count: number }[];
}

export function countSources(joiners: { src?: string | null; ref?: string | null; created_at: string }[], now = Date.now()): { label: string; count: number }[] {
  const weekStart = now - 7 * 86400_000;
  const m = new Map<string, number>();
  for (const j of joiners) {
    if (!(new Date(j.created_at).getTime() >= weekStart)) continue;
    const k = j.ref ? `rep ${j.ref}` : j.src ? j.src : "found the bot directly";
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return Array.from(m, ([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count).slice(0, 8);
}

/** Midnight in Nigeria (WAT) for the day containing `now`, as a UTC timestamp. */
export const startOfLagosDay = (now = Date.now()): number => Math.floor((now + WAT_MS) / 86400_000) * 86400_000 - WAT_MS;

const blank = (): Period => ({ orders: 0, delivered: 0, deliveredNgn: 0, refunded: 0, stuck: 0, tgOrders: 0, tgDelivered: 0, tgDeliveredNgn: 0 });

function add(p: Period, o: StatOrder) {
  const amt = Number(o.amount_ngn) || 0;
  const tg = o.source === "telegram";
  if (o.status === "pending_payment") return; // never paid: not an order yet
  p.orders++;
  if (tg) p.tgOrders++;
  if (o.status === "fulfilled") { p.delivered++; p.deliveredNgn += amt; if (tg) { p.tgDelivered++; p.tgDeliveredNgn += amt; } }
  else if (o.status === "failed_refunded") p.refunded++;
  else p.stuck++; // paid / needs_review / refund_failed
}

export function computeStats(orders: StatOrder[], users: StatsData["users"], now = Date.now()): StatsData {
  const todayStart = startOfLagosDay(now);
  const weekStart = now - 7 * 86400_000;
  const today = blank(), week = blank();
  const reps = new Map<string, { code: string; orders: number; delivered: number; deliveredNgn: number; viaTelegram: number }>();
  for (const o of orders) {
    if (o.is_test) continue;
    const t = new Date(o.created_at).getTime();
    if (!(t >= weekStart)) continue;
    add(week, o);
    if (t >= todayStart) add(today, o);
    if (o.rep && o.status !== "pending_payment") {
      const r = reps.get(o.rep) ?? { code: o.rep, orders: 0, delivered: 0, deliveredNgn: 0, viaTelegram: 0 };
      r.orders++;
      if (o.source === "telegram") r.viaTelegram++;
      if (o.status === "fulfilled") { r.delivered++; r.deliveredNgn += Number(o.amount_ngn) || 0; }
      reps.set(o.rep, r);
    }
  }
  return { today, week, reps: Array.from(reps.values()).sort((a, b) => b.deliveredNgn - a.deliveredNgn).slice(0, 8), users };
}

const line = (label: string, p: Period) => {
  const parts = [`${p.orders} paid`, `${p.delivered} delivered (${naira(p.deliveredNgn)})`];
  if (p.refunded) parts.push(`${p.refunded} refunded`);
  if (p.stuck) parts.push(`⚠️ ${p.stuck} not finished`);
  return `<b>${label}</b>\n${parts.join(" · ")}\nvia the bot: ${p.tgOrders} paid, ${p.tgDelivered} delivered (${naira(p.tgDeliveredNgn)})`;
};

export function fmtStats(s: StatsData): string {
  const out = [line("Today", s.today), "", line("Last 7 days", s.week)];
  if (s.reps.length) {
    out.push("", "<b>Reps, last 7 days</b>");
    for (const r of s.reps) out.push(`${esc(r.code)}: ${r.orders} paid, ${r.delivered} delivered (${naira(r.deliveredNgn)})${r.viaTelegram ? `, ${r.viaTelegram} from Telegram` : ""}`);
  }
  if (s.sources?.length) out.push("", `<b>New bot customers, 7 days</b>\n${s.sources.map((x) => `${esc(x.label)}: ${x.count}`).join(" · ")}`);
  out.push("", `<b>Bot customers</b>\n${s.users.total} reachable · ${s.users.newToday} new today · ${s.users.blocked} blocked the bot · ${s.users.optedOut} stopped announcements`);
  return out.join("\n");
}

export interface FailureRow { ref: string; status: string; biller: string; amount: number; ageMin: number; source: string }

const WHY: Record<string, string> = {
  needs_review: "waiting on the provider",
  refund_failed: "REFUND FAILED, needs you",
  failed_refunded: "refunded",
  paid: "paid, not delivered yet",
};

export function fmtFailures(rows: FailureRow[]): string {
  if (!rows.length) return "✅ Nothing stuck or failed in the last 3 days.";
  const lines = [`<b>Needs a look (last 3 days)</b>`];
  for (const r of rows.slice(0, 15)) {
    const age = r.ageMin >= 120 ? `${Math.round(r.ageMin / 60)}h` : `${Math.round(r.ageMin)}m`;
    lines.push(`${r.status === "refund_failed" ? "🚨" : r.status === "failed_refunded" ? "↩️" : "⏳"} ${esc(r.ref)} · ${esc(r.biller)} · ${naira(r.amount)} · ${age} ago\n   ${WHY[r.status] ?? esc(r.status)}${r.source === "telegram" ? " · bot" : ""}`);
  }
  if (rows.length > 15) lines.push(`…and ${rows.length - 15} more in the admin.`);
  return lines.join("\n");
}
