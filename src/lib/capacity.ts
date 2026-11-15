import { billsTestMode, getBalance, bestNgnBalance, providerLabel } from "@/lib/bills";
import { alertFounder } from "@/lib/alerts";

// "Can we deliver this order right now?" Asked BEFORE the customer is sent to pay, so nobody pays for something we cannot
// vend. If the bills wallet holds less than the order's delivered value, the customer sees a calm "back in a few minutes"
// notice instead of an error, and the founder gets one email so the wallet gets topped up.
//
// Design rules:
//  - Never block on doubt: if the balance can't be read, or we're in sandbox/test mode, the order goes ahead (as before).
//  - The balance is cached for 45 s so a busy page doesn't hit the provider on every click.
//  - Optional safety margin: WALLET_RESERVE_NGN (default 0) is added to what each order needs.

export type Capacity = { ok: true } | { ok: false; balance: number };

const OK_TTL_MS = 45_000;
const FAIL_TTL_MS = 20_000;
const ALERT_EVERY_MS = 30 * 60_000;

// One cache per reading, so a bulk check and a single-order check never share a number.
const caches = new Map<string, { at: number; balance: number | null }>();
let lastAlert = -Infinity;

export const resetCapacityCache = () => { caches.clear(); lastAlert = -Infinity; };

async function readBalance(key: string, now: number, read: () => Promise<number>): Promise<number | null> {
  const cache = caches.get(key);
  if (cache && now - cache.at < (cache.balance === null ? FAIL_TTL_MS : OK_TTL_MS)) return cache.balance;
  let balance: number | null = null;
  try {
    const v = Number(await read());
    balance = Number.isFinite(v) ? v : null;
  } catch { balance = null; }
  caches.set(key, { at: now, balance });
  return balance;
}

export async function walletCovers(
  neededNgn: number,
  opts: { now?: number; read?: () => Promise<number>; testMode?: boolean; alert?: (subject: string, text: string) => unknown; context?: string; failover?: boolean } = {}
): Promise<Capacity> {
  const now = opts.now ?? Date.now();
  if (opts.testMode ?? billsTestMode()) return { ok: true };
  if (!Number.isFinite(neededNgn) || neededNgn <= 0) return { ok: true };

  const reserve = Math.max(0, Number(process.env.WALLET_RESERVE_NGN ?? 0) || 0);
  // Single orders can fall back to the failover provider's wallet (see fulfil-order); bulk and exams cannot yet.
  const balance = opts.failover
    ? await readBalance("best", now, opts.read ?? bestNgnBalance)
    : await readBalance("active", now, opts.read ?? (() => getBalance("NGN")));
  if (balance === null) return { ok: true }; // can't tell: don't block a customer on a guess
  if (balance >= neededNgn + reserve) return { ok: true };

  if (now - lastAlert >= ALERT_EVERY_MS) {
    lastAlert = now;
    const send = opts.alert ?? alertFounder;
    void send(
      "A customer was told we are restocking: top up the wallet",
      `The ${providerLabel()} wallet is ₦${balance.toLocaleString("en-NG", { maximumFractionDigits: 2 })} and an order needed ₦${Math.round(neededNgn).toLocaleString("en-NG")}` +
        `${reserve ? ` (plus a ₦${reserve.toLocaleString("en-NG")} reserve)` : ""}${opts.context ? ` (${opts.context})` : ""}. ` +
        `They saw "back in a few minutes" and were not charged. New orders stay paused until the wallet is topped up. You get at most one of these emails every 30 minutes.`
    );
  }
  return { ok: false, balance };
}
