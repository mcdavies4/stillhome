// Calendar months for statements (client-safe: no PDF code in here). Months are Nigerian time (WAT, UTC+1).
export const STATEMENT_MONTHS_BACK = 24;
const WAT_MS = 3600_000;

export const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** "2026-11" -> the UTC instants of 1 Nov 00:00 and 1 Dec 00:00 in Nigerian time. Null if not a real, past-or-current month within range. */
export function monthRange(ym: unknown, now = Date.now()): { from: string; to: string; label: string } | null {
  if (typeof ym !== "string" || !MONTH_RE.test(ym)) return null;
  const [y, m] = ym.split("-").map(Number);
  const start = Date.UTC(y, m - 1, 1) - WAT_MS;
  const end = Date.UTC(y, m, 1) - WAT_MS;
  const nowWat = new Date(now + WAT_MS);
  const curIdx = nowWat.getUTCFullYear() * 12 + nowWat.getUTCMonth();
  const idx = y * 12 + (m - 1);
  if (idx > curIdx || curIdx - idx >= STATEMENT_MONTHS_BACK) return null;
  const label = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
  return { from: new Date(start).toISOString(), to: new Date(end).toISOString(), label };
}

/** The last N month keys, newest first, for the picker. */
export function recentMonths(now = Date.now(), n = 12): { key: string; label: string }[] {
  const w = new Date(now + WAT_MS); let y = w.getUTCFullYear(), m = w.getUTCMonth();
  const out: { key: string; label: string }[] = [];
  for (let i = 0; i < n; i++) {
    out.push({ key: `${y}-${String(m + 1).padStart(2, "0")}`, label: new Date(Date.UTC(y, m, 1)).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }) });
    m--; if (m < 0) { m = 11; y--; }
  }
  return out;
}

