// Bulk airtime helpers for the app. The same rules as the website's src/lib/bulk-shared.ts;
// the limits and the fee come from the server (/api/bulk/config), so the two can never disagree.
import type { BulkConfig } from "./api";

export type Network = "mtn" | "glo" | "airtel" | "9mobile";
export const NETWORKS: { code: Network; label: string }[] = [
  { code: "mtn", label: "MTN" }, { code: "glo", label: "Glo" }, { code: "airtel", label: "Airtel" }, { code: "9mobile", label: "9mobile" },
];

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
export function guessNetwork(local: string): Network | null {
  for (const n of Object.keys(PREFIXES) as Network[]) if (PREFIXES[n].some((p) => local.startsWith(p))) return n;
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

export type DraftRow = { phone: string; amount: number; network: Network | "" };

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

/** One number per line: "08031234567 500", "0803 123 4567, 1000, glo". Lines without an amount use defaultAmount. */
export function parseBulkText(text: string, defaultAmount = 0): { rows: DraftRow[]; skipped: string[] } {
  const rows: DraftRow[] = [];
  const skipped: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim().replace(/(?<!\d)(\d{1,3}),(\d{3})(?!\d)/g, "$1$2");
    if (!line) continue;
    if (/^(phone|number|mobile|msisdn)/i.test(line)) continue;
    const found = extractPhone(line);
    if (!found) { skipped.push(line); continue; }
    const net = line.split(/[\s,;|\t]+/).map(parseNetwork).find(Boolean) ?? null;
    const am = found.rest.join(" ").replace(/[A-Za-z]+/g, " ").match(/\d[\d,]*/);
    const amount = am ? Math.round(Number(am[0].replace(/,/g, ""))) : defaultAmount;
    rows.push({ phone: found.phone, amount: Number.isFinite(amount) ? amount : 0, network: net ?? guessNetwork(found.phone) ?? "" });
  }
  return { rows, skipped };
}

export type Checked = { phone: string; amount: number; network: Network };
const n0 = (v: number) => `₦${Math.round(v).toLocaleString("en-NG")}`;

export function checkRows(rows: DraftRow[], c: BulkConfig): { ok: true; rows: Checked[]; total: number } | { ok: false; error: string } {
  if (!rows.length) return { ok: false, error: "Add at least one number." };
  if (rows.length > c.maxRecipients) return { ok: false, error: `You can top up at most ${c.maxRecipients} numbers at a time.` };
  const out: Checked[] = [];
  let total = 0;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const phone = localPhone(r.phone);
    if (!phone) return { ok: false, error: `Row ${i + 1}: "${String(r.phone).slice(0, 20)}" isn’t a valid Nigerian mobile number.` };
    const network = parseNetwork(String(r.network));
    if (!network) return { ok: false, error: `Row ${i + 1}: choose a network for ${phone}.` };
    const amount = Math.round(Number(r.amount));
    if (!Number.isFinite(amount) || amount < c.minEach) return { ok: false, error: `Row ${i + 1}: the minimum is ${n0(c.minEach)} per number.` };
    if (amount > c.maxEach) return { ok: false, error: `Row ${i + 1}: the maximum is ${n0(c.maxEach)} per number.` };
    total += amount;
    out.push({ phone, amount, network });
  }
  if (total > c.maxTotal) return { ok: false, error: `One batch can be at most ${n0(c.maxTotal)}. Split it into two batches.` };
  return { ok: true, rows: out, total };
}

export const batchFee = (total: number, c: BulkConfig) =>
  Math.round(Math.min(c.fee.max, Math.max(c.fee.min, (total * c.fee.pct) / 100)));
