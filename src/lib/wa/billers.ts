// src/lib/wa/billers.ts
// Electricity catalogue for the WhatsApp channel — built dynamically from the
// repo's existing getBillCategories() (same source the website uses), so there
// are no hardcoded biller/item codes to drift out of date.

import { getBillCategories } from "@/lib/flutterwave";

export interface WaBiller {
  key: string;          // stable `${biller_code}|${item_code}`
  label: string;        // human label, e.g. "IKEDC PREPAID"
  biller_code: string;
  item_code: string;
  biller_name: string;  // as stored on orders.biller_name
  identifier_label: string; // usually "Meter Number"
  aliases: string[];
}

// FLW category items — loose shape, matching what the site's catalogue returns.
interface CatalogueItem {
  biller_code: string;
  item_code: string;
  biller_name?: string;
  name?: string;
  short_name?: string;
  label_name?: string;
  country?: string;
  is_airtime?: boolean;
}

const ELECTRIC_RE = /(ELECTRIC|DISCO|PREPAID|POSTPAID|IKEDC|EKEDC|AEDC|PHED|EEDC|IBEDC|BEDC|KEDCO|KAEDCO|JED|APLE|YEDC)/i;

// Common diaspora shorthand → matched against biller text
const ALIAS_HINTS: [RegExp, string[]][] = [
  [/IKEDC|IKEJA/i, ["ikedc", "ikeja", "ikeja electric", "ie"]],
  [/EKEDC|EKO/i, ["ekedc", "eko", "eko electric"]],
  [/AEDC|ABUJA/i, ["aedc", "abuja", "abuja electric"]],
  [/PHED|PORT\s*HARCOURT/i, ["phed", "ph", "port harcourt"]],
  [/EEDC|ENUGU/i, ["eedc", "enugu"]],
  [/IBEDC|IBADAN/i, ["ibedc", "ibadan"]],
  [/BEDC|BENIN/i, ["bedc", "benin"]],
  [/KEDCO|KANO/i, ["kedco", "kano"]],
  [/KAEDCO|KADUNA/i, ["kaedco", "kaduna"]],
  [/JED|JOS/i, ["jed", "jos"]],
  [/YEDC|YOLA/i, ["yedc", "yola"]],
];

let cache: { billers: WaBiller[]; at: number } | null = null;
const MEM_CACHE_MS = 10 * 60 * 1000;       // hot instance: skip even the DB read
const DB_CACHE_MS = 6 * 60 * 60 * 1000;    // refetch FLW at most every 6h

export async function getElectricityBillers(): Promise<WaBiller[]> {
  // 1. Hot in-memory cache (same warm instance)
  if (cache && Date.now() - cache.at < MEM_CACHE_MS) return cache.billers;

  // 2. Supabase-backed cache — survives serverless cold starts, so messages
  //    never pay Flutterwave's slow catalogue fetch (5-15s) on a cold instance.
  const { db } = await import("./db");
  const { data: row } = await db
    .from("wa_biller_cache")
    .select("data, fetched_at")
    .eq("id", 1)
    .maybeSingle();

  if (row?.data && Date.now() - new Date(row.fetched_at).getTime() < DB_CACHE_MS) {
    const billers = row.data as WaBiller[];
    cache = { billers, at: Date.now() };
    return billers;
  }

  // 3. Cache miss/stale → fetch FLW, store for every other instance
  const billers = await buildFromFlutterwave();
  cache = { billers, at: Date.now() };
  await db
    .from("wa_biller_cache")
    .upsert({ id: 1, data: billers, fetched_at: new Date().toISOString() })
    .then(() => undefined, (e) => console.error("[billers] cache write failed", e));

  // Stale-if-error: if FLW returned nothing but we had an old row, use it.
  if (!billers.length && row?.data) {
    const staleBillers = row.data as WaBiller[];
    cache = { billers: staleBillers, at: Date.now() };
    return staleBillers;
  }
  return billers;
}

async function buildFromFlutterwave(): Promise<WaBiller[]> {
  const items = (await getBillCategories()) as unknown as CatalogueItem[];
  const seen = new Set<string>();
  const billers: WaBiller[] = [];

  for (const i of items) {
    if (i.is_airtime) continue;
    if (i.country && i.country !== "NG") continue;
    const text = `${i.biller_name ?? ""} ${i.name ?? ""} ${i.short_name ?? ""}`;
    if (!ELECTRIC_RE.test(text)) continue;

    const key = `${i.biller_code}|${i.item_code}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const aliases = new Set<string>();
    for (const [re, list] of ALIAS_HINTS) {
      if (re.test(text)) list.forEach((a) => aliases.add(a));
    }
    const label = (i.biller_name ?? i.name ?? i.short_name ?? "Electricity").trim();
    aliases.add(label.toLowerCase());

    billers.push({
      key,
      label,
      biller_code: i.biller_code,
      item_code: i.item_code,
      biller_name: label,
      identifier_label: i.label_name ?? "Meter Number",
      aliases: Array.from(aliases),
    });
  }

  return billers;
}

export async function billerByKey(key: string): Promise<WaBiller | undefined> {
  return (await getElectricityBillers()).find((b) => b.key === key);
}

export async function billerByCodes(billerCode: string, itemCode: string): Promise<WaBiller | undefined> {
  return (await getElectricityBillers()).find(
    (b) => b.biller_code === billerCode && b.item_code === itemCode
  );
}

/**
 * All catalogue entries belonging to the same disco as `chosen` (shared alias),
 * chosen first. FLW's catalogue often lists several entries per disco
 * (prepaid/postpaid variants, duplicate item codes) and only one of them will
 * validate a given meter — the caller tries them in order.
 */
export async function billersSameDisco(chosen: WaBiller): Promise<WaBiller[]> {
  const all = await getElectricityBillers();
  const chosenAliases = new Set(chosen.aliases);
  const siblings = all.filter(
    (b) => b.key !== chosen.key && b.aliases.some((a) => chosenAliases.has(a))
  );
  return [chosen, ...siblings];
}

/** Compact list for the Claude extraction prompt. */
export function billersForPrompt(billers: WaBiller[]): string {
  return billers
    .map((b) => `- key: ${b.key} | label: ${b.label} | aliases: ${b.aliases.join(", ")}`)
    .join("\n");
}

/** Short human list for help copy. */
export function billersForHelp(billers: WaBiller[]): string {
  const names = new Set<string>();
  for (const b of billers) {
    const m = b.label.match(/[A-Z]{3,6}/);
    names.add(m ? m[0] : b.label.split(" ")[0]);
  }
  return Array.from(names).slice(0, 12).join(", ");
}
