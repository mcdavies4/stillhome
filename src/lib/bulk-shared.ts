// src/lib/bulk-shared.ts
// Pure helpers for bulk airtime, used by BOTH the page and the server (no server-only imports).
// Limits are NEXT_PUBLIC_ variables so the page shows exactly what the server enforces
// (each is read by its full name so Next.js can bake it in; redeploy after changing one).

export type Network = "mtn" | "glo" | "airtel" | "9mobile";
export const NETWORKS: { code: Network; label: string }[] = [
  { code: "mtn", label: "MTN" },
  { code: "glo", label: "Glo" },
  { code: "airtel", label: "Airtel" },
  { code: "9mobile", label: "9mobile" },
];

function num(v: string | undefined, d: number): number {
  const n = Number(v);
  return v !== undefined && v !== "" && Number.isFinite(n) && n > 0 ? Math.floor(n) : d;
}

export const BULK_MIN_EACH = 50; // Paybeta's own minimum per number
export const BULK_MAX_RECIPIENTS = Math.min(1000, num(process.env.NEXT_PUBLIC_BULK_MAX_RECIPIENTS, 100));
export const BULK_MAX_EACH = Math.min(20000, num(process.env.NEXT_PUBLIC_BULK_MAX_EACH, 5000));
export const BULK_MAX_TOTAL = num(process.env.NEXT_PUBLIC_BULK_MAX_TOTAL, 200000);
export const BULK_FIRST_CAP = num(process.env.NEXT_PUBLIC_BULK_FIRST_CAP, 20000); // a brand-new customer's first batch

/** Any Nigerian mobile format -> 11-digit local form (08031234567), or null. */
export function localPhone(raw: unknown): string | null {
  let d = String(raw ?? "").replace(/\D/g, "");
  if (d.startsWith("234") && d.length === 13) d = "0" + d.slice(3);
  else if (d.length === 10 && /^[789]/.test(d)) d = "0" + d;
  return /^0[789]\d{9}$/.test(d) ? d : null;
}

const PREFIXES: Record<Network, string[]> = {
  mtn: ["0803", "0806", "0703", "0706", "0813", "0816", "0810", "0814", "0903", "0906", "0913", "0916", "0704", "07025", "07026"],
  glo: ["0805", "0807", "0705", "0815", "0811", "0905", "0915"],
  airtel: ["0802", "0808", "0708", "0812", "0701", "0902", "0901", "0904", "0907", "0912"],
  "9mobile": ["0809", "0818", "0817", "0909", "0908"],
};

/** A first guess from the number's prefix. Numbers can move network, so the customer can always change it. */
export function guessNetwork(local: string): Network | null {
  for (const n of Object.keys(PREFIXES) as Network[]) {
    if (PREFIXES[n].some((p) => local.startsWith(p))) return n;
  }
  return null;
}

export function parseNetwork(t: string): Network | null {
  const s = t.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (s === "mtn") return "mtn";
  if (s === "glo" || s === "globacom") return "glo";
  if (s === "airtel") return "airtel";
  if (s === "9mobile" || s === "etisalat" || s === "nmobile") return "9mobile";
  return null;
}

export interface DraftRow {
  phone: string;
  amount: number;
  network: Network | "";
}

/**
 * Turns pasted text or a CSV file into rows. One number per line:
 *   08031234567 500
 *   0803 123 4567, 1000, glo
 * Lines without an amount use `defaultAmount` (0 = leave empty for the customer to fill in).
 */
export function parseBulkText(text: string, defaultAmount = 0): { rows: DraftRow[]; skipped: string[] } {
  const rows: DraftRow[] = [];
  const skipped: string[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim().replace(/(?<!\d)(\d{1,3}),(\d{3})(?!\d)/g, "$1$2"); // 2,000 -> 2000
    if (!line) continue;
    if (/^(phone|number|mobile|msisdn)/i.test(line)) continue; // CSV header
    const found = extractPhone(line);
    if (!found) { skipped.push(line); continue; }
    const net = line.split(/[\s,;|\t]+/).map(parseNetwork).find(Boolean) ?? null;
    const am = found.rest.join(" ").replace(/[A-Za-z]+/g, " ").match(/\d[\d,]*/);
    const amount = am ? Math.round(Number(am[0].replace(/,/g, ""))) : defaultAmount;
    rows.push({ phone: found.phone, amount: Number.isFinite(amount) ? amount : 0, network: net ?? guessNetwork(found.phone) ?? "" });
  }
  return { rows, skipped };
}

/** Finds the phone number in one line, tolerating spaces inside it ("0803 123 4567"). `rest` is everything else. */
function extractPhone(line: string): { phone: string; rest: string[] } | null {
  const fields = line.split(/[,;|\t]/).map((x) => x.trim()).filter(Boolean);
  if (fields.length > 1) {
    for (let i = 0; i < fields.length; i++) {
      const p = localPhone(fields[i].replace(/[^\d]/g, ""));
      if (p && !/[A-Za-z]/.test(fields[i])) return { phone: p, rest: fields.filter((_, j) => j !== i) };
    }
    return null;
  }
  const tokens = line.split(/\s+/);
  let acc = "";
  for (let i = 0; i < tokens.length; i++) {
    if (/[A-Za-z]/.test(tokens[i])) { if (acc) break; else continue; }
    acc += tokens[i].replace(/[^\d]/g, "");
    const p = localPhone(acc);
    if (p) return { phone: p, rest: tokens.slice(i + 1) };
    if (acc.length > 13) break;
  }
  return null;
}

export type CheckedRow = { phone: string; amount: number; network: Network };

/** Same rules on the page and the server. Returns the cleaned rows or a message the customer can act on. */
export function checkRows(rows: DraftRow[]): { ok: true; rows: CheckedRow[]; total: number } | { ok: false; error: string } {
  if (!rows.length) return { ok: false, error: "Add at least one number." };
  if (rows.length > BULK_MAX_RECIPIENTS) return { ok: false, error: `You can top up at most ${BULK_MAX_RECIPIENTS} numbers at a time.` };
  const out: CheckedRow[] = [];
  let total = 0;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const phone = localPhone(r.phone);
    if (!phone) return { ok: false, error: `Row ${i + 1}: "${String(r.phone).slice(0, 20)}" isn't a valid Nigerian mobile number.` };
    const network = parseNetwork(String(r.network));
    if (!network) return { ok: false, error: `Row ${i + 1}: choose a network for ${phone}.` };
    const amount = Math.round(Number(r.amount));
    if (!Number.isFinite(amount) || amount < BULK_MIN_EACH) return { ok: false, error: `Row ${i + 1}: the minimum is ₦${BULK_MIN_EACH} per number.` };
    if (amount > BULK_MAX_EACH) return { ok: false, error: `Row ${i + 1}: the maximum is ₦${BULK_MAX_EACH.toLocaleString("en-NG")} per number.` };
    total += amount;
    out.push({ phone, amount, network });
  }
  if (total > BULK_MAX_TOTAL) return { ok: false, error: `One batch can be at most ₦${BULK_MAX_TOTAL.toLocaleString("en-NG")}. Split it into two batches.` };
  return { ok: true, rows: out, total };
}

export const maskPhone = (p: string) => (p.length === 11 ? `${p.slice(0, 4)}***${p.slice(7)}` : p);

export type BulkStatus = "pending_payment" | "paid" | "processing" | "settling" | "settled" | "needs_review" | "refund_failed" | "expired";

export interface BulkView {
  id: string;
  status: BulkStatus;
  count: number;
  amount_total: number;
  service_fee: number;
  delivered: number;
  failed: number;
  delivered_ngn: number;
  refunded_ngn: number;
  created_at: string;
  recipients: { row: number; network: Network; phone: string; amount: number; status: "queued" | "delivered" | "failed" }[];
}

/**
 * Service fee for a whole batch: BULK_FEE_PCT % of the airtime total, never below MIN, never above MAX (whole naira).
 * Separate from the single-airtime fee because one batch carries many numbers' worth of airtime, so the single
 * ₦100 cap would leave a large batch earning almost nothing after Flutterwave's 2% pay-in cost.
 * Defaults 1% / ₦20 / ₦500. Env: NEXT_PUBLIC_BULK_FEE_PCT / _MIN / _MAX.
 */
export function bulkFee(total: number): number {
  const f = (v: string | undefined, d: number) => {
    const x = Number(v);
    return v !== undefined && v !== "" && Number.isFinite(x) && x >= 0 ? x : d;
  };
  const pct = f(process.env.NEXT_PUBLIC_BULK_FEE_PCT, 1);
  const min = f(process.env.NEXT_PUBLIC_BULK_FEE_MIN, 20);
  const max = Math.max(min, f(process.env.NEXT_PUBLIC_BULK_FEE_MAX, 500));
  return Math.round(Math.min(max, Math.max(min, (total * pct) / 100)));
}
