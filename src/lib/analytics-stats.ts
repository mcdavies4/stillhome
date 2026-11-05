// src/lib/analytics-stats.ts
// Turns raw site_events rows (plus order rows) into the numbers on /admin/analytics. Pure: no database here.
// Days run on Nigerian time (WAT, UTC+1, no daylight saving), because that is where most visitors are.

export type EventRow = {
  created_at: string; kind: "view" | "event"; name: string; path: string | null; detail: string | null; vid: string;
  src: string | null; campaign: string | null; country: string | null; device: string | null; browser: string | null;
};
export type OrderRow = { created_at: string; status: string };

const HOUR = 3600_000, DAY = 86400_000;
export const dayKey = (iso: string | number) => new Date(new Date(iso).getTime() + HOUR).toISOString().slice(0, 10);
/** The instant a Nigerian day starts (that day's 00:00 WAT), as UTC milliseconds. */
export const dayStart = (key: string) => Date.parse(key + "T00:00:00Z") - HOUR;

const top = <T,>(m: Map<string, T>, n: number, by: (v: T) => number) => Array.from(m.entries()).sort((a, b) => by(b[1]) - by(a[1])).slice(0, n);
const uniq = (rows: EventRow[]) => new Set(rows.map((r) => dayKey(r.created_at) + "|" + r.vid)).size;
const groupBy = (rows: EventRow[], key: (r: EventRow) => string | null) => {
  const m = new Map<string, EventRow[]>();
  for (const r of rows) { const k = key(r); if (!k) continue; (m.get(k) ?? m.set(k, []).get(k)!).push(r); }
  return m;
};

// Orders that count as "paid": anything past checkout that wasn't abandoned.
const NOT_PAID = new Set(["pending_payment", "expired", "cancelled"]);

export function buildStats(rows: EventRow[], orders: OrderRow[], opts: { days: 1 | 7 | 30; now?: number }) {
  const now = opts.now ?? Date.now();
  const today = dayKey(now);
  const startMs = dayStart(today) - (opts.days - 1) * DAY;
  const inWin = rows.filter((r) => new Date(r.created_at).getTime() >= startMs);
  const views = inWin.filter((r) => r.kind === "view");
  const events = inWin.filter((r) => r.kind === "event");
  const visitors = uniq(views);

  // Chart: at least 7 days so "Today" still shows a trend.
  const chartDays = Math.max(opts.days, 7);
  const byDay: { day: string; views: number; visitors: number; orders: number }[] = [];
  for (let i = chartDays - 1; i >= 0; i--) {
    const k = dayKey(dayStart(today) - i * DAY + 1);
    const v = rows.filter((r) => r.kind === "view" && dayKey(r.created_at) === k);
    byDay.push({ day: k, views: v.length, visitors: new Set(v.map((r) => r.vid)).size, orders: orders.filter((o) => dayKey(o.created_at) === k && !NOT_PAID.has(o.status)).length });
  }

  const pages = top(groupBy(views, (r) => r.name), 12, (v) => v.length).map(([path, v]) => ({ path, views: v.length, visitors: uniq(v) }));

  const bySrc = groupBy(inWin.filter((r) => r.src && r.src !== "internal"), (r) => r.src);
  const sources = top(bySrc, 10, (v) => uniq(v)).map(([src, v]) => ({
    src, visitors: uniq(v),
    lookups: uniq(v.filter((r) => r.kind === "event" && r.name === "lookup_ok")),
    checkouts: uniq(v.filter((r) => r.kind === "event" && r.name === "checkout_click")),
  }));
  const campaigns = top(groupBy(inWin.filter((r) => r.campaign), (r) => r.campaign), 10, (v) => uniq(v)).map(([campaign, v]) => ({
    campaign, visitors: uniq(v), lookups: uniq(v.filter((r) => r.kind === "event" && r.name === "lookup_ok")), checkouts: uniq(v.filter((r) => r.kind === "event" && r.name === "checkout_click")),
  }));

  const countries = top(groupBy(views, (r) => r.country), 8, (v) => uniq(v)).map(([c, v]) => ({ country: c, visitors: uniq(v) }));
  const devices = top(groupBy(views, (r) => r.device), 3, (v) => uniq(v)).map(([d, v]) => ({ device: d, visitors: uniq(v) }));
  const browsers = top(groupBy(views, (r) => r.browser), 6, (v) => uniq(v)).map(([b, v]) => ({ browser: b, visitors: uniq(v) }));

  const evMap = new Map<string, number>();
  for (const e of events) { const k = e.detail ? `${e.name}|${e.detail}` : e.name; evMap.set(k, (evMap.get(k) ?? 0) + 1); }
  const eventList = Array.from(evMap.entries()).sort((a, b) => b[1] - a[1]).slice(0, 20).map(([k, count]) => { const [name, detail] = k.split("|"); return { name, detail: detail ?? null, count }; });

  const home = uniq(views.filter((r) => r.name === "/"));
  const lookups = uniq(events.filter((r) => r.name === "lookup_ok"));
  const checkouts = uniq(events.filter((r) => r.name === "checkout_click"));
  const paid = orders.filter((o) => new Date(o.created_at).getTime() >= startMs && !NOT_PAID.has(o.status)).length;
  const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);
  const funnel = [
    { step: "Opened the home page", n: home, pct: null as number | null },
    { step: "Looked up a meter, card or number", n: lookups, pct: pct(lookups, home) },
    { step: "Tapped pay", n: checkouts, pct: pct(checkouts, lookups) },
    { step: "Paid orders", n: paid, pct: pct(paid, checkouts) },
  ];

  const online = new Set(rows.filter((r) => new Date(r.created_at).getTime() >= now - 5 * 60_000).map((r) => r.vid)).size;
  return {
    days: opts.days, since: new Date(startMs).toISOString(),
    totals: { views: views.length, visitors, pagesPerVisit: visitors ? Math.round((views.length / visitors) * 10) / 10 : 0, online, lookups, checkouts, paid, conversion: pct(paid, visitors) },
    byDay, pages, sources, campaigns, countries, devices, browsers, events: eventList, funnel,
  };
}
