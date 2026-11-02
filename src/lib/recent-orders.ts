// Anonymous "recent orders" notices for the website.
//
// Only REAL, delivered, non-test orders are ever described, and only these facts: what kind of
// product, the amount, and roughly when. No name, email, meter / phone number, token, order id or
// location leaves the server. Notices are held back a few minutes and the time is rounded, and
// nothing is shown at all until there are enough real orders that no single customer stands out.

export const MIN_REAL_ORDERS = 3; // show nothing until at least this many qualify
export const DELAY_MINUTES = 10; // an order is only described this long after it was made
export const WINDOW_HOURS = 72; // look back this far

export type RecentOrderRow = { biller_name: string | null; amount_ngn: number | string | null; created_at: string };
export type RecentNotice = { text: string; when: string };

const naira = (n: number) => `₦${Math.round(n).toLocaleString("en-NG")}`;

function network(name: string): string {
  const m = name.match(/MTN|AIRTEL|GLO|9MOBILE|ETISALAT/i);
  if (!m) return "";
  const v = m[0].toUpperCase();
  return v === "MTN" ? "MTN" : v === "AIRTEL" ? "Airtel" : v === "GLO" ? "Glo" : "9mobile";
}

export function whenLabel(createdAtMs: number, nowMs: number): string {
  const mins = (nowMs - createdAtMs) / 60000;
  if (mins < 30) return "a few minutes ago";
  if (mins < 90) return "in the last hour";
  if (mins < 24 * 60) return "today";
  if (mins < 48 * 60) return "yesterday";
  return "this week";
}

/** One short sentence for an order, or null if we can't describe it without guessing. */
export function describeOrder(row: RecentOrderRow, nowMs = Date.now()): RecentNotice | null {
  const amount = Number(row.amount_ngn);
  const name = String(row.biller_name ?? "");
  if (!Number.isFinite(amount) || amount <= 0 || !name) return null;
  const when = whenLabel(new Date(row.created_at).getTime(), nowMs);
  const net = network(name);
  let text: string | null = null;
  if (/DSTV|GOTV|STARTIMES/i.test(name)) {
    const brand = /DSTV/i.test(name) ? "DStv" : /GOTV/i.test(name) ? "GOtv" : "StarTimes";
    text = `Someone paid ${naira(amount)} for ${brand}`;
  } else if (/ELECTRIC|DISCO|PREPAID METER|POWER/i.test(name) || /EKEDC|IKEDC|EEDC|AEDC|IBEDC|PHED|KEDCO|BEDC|JED|YEDC/i.test(name)) {
    text = `Someone bought ${naira(amount)} of electricity`;
  } else if (/DATA|BROADBAND|SURFLINE|BUNDLE/i.test(name)) {
    text = `Someone bought ${naira(amount)} ${net ? net + " " : ""}data`;
  } else if (/VTU|AIRTIME/i.test(name) || net) {
    text = `Someone bought ${naira(amount)} ${net ? net + " " : ""}airtime`;
  }
  return text ? { text, when } : null;
}

/** Turns qualifying rows into notices, or [] while there are too few to show anyone safely. */
export function buildNotices(rows: RecentOrderRow[], nowMs = Date.now()): RecentNotice[] {
  const ok = rows.map((r) => describeOrder(r, nowMs)).filter((n): n is RecentNotice => !!n);
  return ok.length >= MIN_REAL_ORDERS ? ok.slice(0, 12) : [];
}
