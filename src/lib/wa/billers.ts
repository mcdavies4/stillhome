// src/lib/wa/billers.ts
// Multi-category catalogue for the WhatsApp channel, built from the repo's
// existing getBillCategories() — electricity discos, TV (DStv/GOtv/StarTimes),
// and mobile data bundles. Fixed-price items (TV packages, data bundles)
// carry their catalogue amount; electricity is user-priced (amount = 0).

import { getBillCategories } from "@/lib/flutterwave";

export type Category = "electricity" | "tv" | "data";

export interface WaBiller {
  key: string;              // stable `${biller_code}|${item_code}`
  label: string;            // "IKEDC PREPAID" | "DSTV COMPACT" | "MTN 2GB data purchase"
  biller_code: string;
  item_code: string;
  biller_name: string;      // stored on orders.biller_name
  identifier_label: string; // "Meter Number" | "Smartcard Number" | "Phone Number"
  aliases: string[];
  category: Category;
  brand: string;            // "IKEDC (Ikeja)" | "DStv" | "GOtv" | "StarTimes" | "MTN" | ...
  amount: number;           // fixed price in NGN; 0 = user chooses amount
}

interface CatalogueItem {
  biller_code: string;
  item_code: string;
  biller_name?: string;
  name?: string;
  short_name?: string;
  label_name?: string;
  country?: string;
  is_airtime?: boolean;
  amount?: number;
}

// Category + brand by FLW biller_code (from this account's live catalogue).
// Regex fallback below catches electricity under new/unknown codes.
const CODE_MAP: Record<string, { category: Category; brand: string }> = {
  BIL204: { category: "electricity", brand: "AEDC (Abuja)" },
  BIL112: { category: "electricity", brand: "EKEDC (Eko)" },
  BIL113: { category: "electricity", brand: "IKEDC (Ikeja)" },
  BIL114: { category: "electricity", brand: "IBEDC (Ibadan)" },
  BIL115: { category: "electricity", brand: "EEDC (Enugu)" },
  BIL116: { category: "electricity", brand: "PHED (Port Harcourt)" },
  BIL117: { category: "electricity", brand: "BEDC (Benin)" },
  BIL118: { category: "electricity", brand: "YEDC (Yola)" },
  BIL119: { category: "electricity", brand: "KAEDCO (Kaduna)" },
  BIL120: { category: "electricity", brand: "KEDCO (Kano)" },
  BIL215: { category: "electricity", brand: "JED (Jos)" },
  BIL121: { category: "tv", brand: "DStv" },
  BIL122: { category: "tv", brand: "GOtv" },
  BIL123: { category: "tv", brand: "StarTimes" },
  BIL108: { category: "data", brand: "MTN" },
  BIL109: { category: "data", brand: "Glo" },
  BIL110: { category: "data", brand: "Airtel" },
  BIL111: { category: "data", brand: "9mobile" },
  BIL124: { category: "data", brand: "Smile" },
};

const ELECTRIC_RE = /(ELECTRIC|DISCO|IKEDC|EKEDC|AEDC|PHED|EEDC|IBEDC|BEDC|KEDCO|KAEDCO|JED|YEDC)/i;

const ALIAS_HINTS: [RegExp, string[]][] = [
  [/IKEDC|IKEJA/i, ["ikedc", "ikeja", "ikeja electric", "ie"]],
  [/EKEDC|EKO/i, ["ekedc", "eko", "eko electric"]],
  [/ABUJA/i, ["aedc", "abuja", "abuja electric", "abuja disco"]],
  [/PHC|PORT\s*HARCOURT/i, ["phed", "ph", "port harcourt", "phc"]],
  [/ENUGU/i, ["eedc", "enugu"]],
  [/IBADAN/i, ["ibedc", "ibadan"]],
  [/BENIN/i, ["bedc", "benin"]],
  [/KANO/i, ["kedco", "kano"]],
  [/KADUNA/i, ["kaedco", "kaduna"]],
  [/JOS/i, ["jed", "jos"]],
  [/YOLA/i, ["yedc", "yola"]],
];

const IDENTIFIER_LABEL: Record<Category, string> = {
  electricity: "Meter Number",
  tv: "Smartcard Number",
  data: "Phone Number",
};

let cache: { billers: WaBiller[]; at: number } | null = null;
const MEM_CACHE_MS = 10 * 60 * 1000;
const DB_CACHE_MS = 6 * 60 * 60 * 1000;

export async function getCatalogue(): Promise<WaBiller[]> {
  if (cache && Date.now() - cache.at < MEM_CACHE_MS) return cache.billers;

  const { db } = await import("./db");
  const { data: row } = await db
    .from("wa_biller_cache")
    .select("data, fetched_at")
    .eq("id", 1)
    .maybeSingle();

  if (row?.data && Date.now() - new Date(row.fetched_at).getTime() < DB_CACHE_MS) {
    const billers = row.data as WaBiller[];
    // Cache rows written by the electricity-only build lack `category` —
    // treat them as stale so the multi-category build repopulates.
    if (billers.length && billers[0].category) {
      cache = { billers, at: Date.now() };
      return billers;
    }
  }

  const billers = await buildFromFlutterwave();
  cache = { billers, at: Date.now() };
  await db
    .from("wa_biller_cache")
    .upsert({ id: 1, data: billers, fetched_at: new Date().toISOString() })
    .then(() => undefined, (e) => console.error("[billers] cache write failed", e));

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

    const mapped = CODE_MAP[i.biller_code];
    const text = `${i.biller_name ?? ""} ${i.name ?? ""} ${i.short_name ?? ""}`;
    let category: Category | null = mapped?.category ?? null;
    let brand = mapped?.brand ?? "";
    if (!category && ELECTRIC_RE.test(text)) {
      category = "electricity";
      brand = (i.biller_name ?? i.name ?? "Electricity").trim();
    }
    if (!category) continue; // churches, taxes, school fees, tolls, etc.

    const key = `${i.biller_code}|${i.item_code}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const label = (i.biller_name ?? i.name ?? i.short_name ?? brand).trim();
    const aliases = new Set<string>([label.toLowerCase(), brand.toLowerCase()]);
    if (category === "electricity") {
      for (const [re, list] of ALIAS_HINTS) if (re.test(text)) list.forEach((a) => aliases.add(a));
    }

    billers.push({
      key,
      label,
      biller_code: i.biller_code,
      item_code: i.item_code,
      biller_name: label,
      identifier_label: i.label_name ?? IDENTIFIER_LABEL[category],
      aliases: Array.from(aliases),
      category,
      brand,
      amount: Number(i.amount ?? 0) || 0,
    });
  }
  return billers;
}

export async function billerByKey(key: string): Promise<WaBiller | undefined> {
  return (await getCatalogue()).find((b) => b.key === key);
}

export async function billerByCodes(billerCode: string, itemCode: string): Promise<WaBiller | undefined> {
  return (await getCatalogue()).find(
    (b) => b.biller_code === billerCode && b.item_code === itemCode
  );
}

/** All entries sharing the chosen entry's disco (electricity only), chosen first. */
export async function billersSameDisco(chosen: WaBiller): Promise<WaBiller[]> {
  const all = await getCatalogue();
  const chosenAliases = new Set(chosen.aliases);
  const siblings = all.filter(
    (b) =>
      b.category === "electricity" &&
      b.key !== chosen.key &&
      b.aliases.some((a) => chosenAliases.has(a))
  );
  return [chosen, ...siblings];
}

/**
 * Match a package request ("compact plus", "2gb", "jolli") against a brand's
 * items. Scores by token overlap; size matches ("2gb") float to the top.
 */
export async function matchPackages(brand: string, query: string, limit = 9): Promise<WaBiller[]> {
  const all = await getCatalogue();
  const pool = all.filter(
    (b) => (b.category === "tv" || b.category === "data") && b.brand.toLowerCase() === brand.toLowerCase()
  );
  const q = query.toLowerCase().replace(/\s+/g, " ").trim();
  if (!q) return popularFirst(pool).slice(0, limit);

  const qTokens = q.split(" ").filter(Boolean);
  const scored = pool
    .map((b) => {
      const label = b.label.toLowerCase();
      let score = 0;
      if (label === q) score += 100;
      if (label.includes(q)) score += 40;
      for (const t of qTokens) if (label.includes(t)) score += 10;
      const qSize = q.match(/(\d+(?:\.\d+)?)\s*(gb|mb|tb)/);
      const lSize = label.match(/(\d+(?:\.\d+)?)\s*(gb|mb|tb)/);
      if (qSize && lSize && qSize[1] === lSize[1] && qSize[2] === lSize[2]) score += 50;
      return { b, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, z) => z.score - a.score);
  return scored.slice(0, limit).map((x) => x.b);
}

const POPULAR = [/COMPACT(?!\s*PLUS)/i, /COMPACT PLUS/i, /YANGA/i, /CONFAM/i, /PADI/i, /PREMIUM(?!\s)/i, /JOLLI/i, /JINJA/i, /MAX/i, /BASIC/i, /CLASSIC/i, /NOVA/i];
function popularFirst(pool: WaBiller[]): WaBiller[] {
  const sorted = pool.slice();
  sorted.sort((a, z) => {
    const ai = POPULAR.findIndex((re) => re.test(a.label));
    const zi = POPULAR.findIndex((re) => re.test(z.label));
    return (ai === -1 ? 99 : ai) - (zi === -1 ? 99 : zi);
  });
  return sorted;
}

export async function brandsForCategory(category: Category): Promise<string[]> {
  const all = await getCatalogue();
  const brands = new Set<string>();
  for (const b of all) if (b.category === category) brands.add(b.brand);
  return Array.from(brands);
}

/** Compact biller/brand overview for the extraction prompt (not every package). */
export async function catalogueForPrompt(): Promise<string> {
  const all = await getCatalogue();
  const elec = all.filter((b) => b.category === "electricity");
  const tvBrands = await brandsForCategory("tv");
  const dataBrands = await brandsForCategory("data");
  return [
    "ELECTRICITY (variable amount, identifier = meter number) — return the exact key:",
    ...elec.map((b) => `- key: ${b.key} | ${b.label} | aliases: ${b.aliases.join(", ")}`),
    `TV SUBSCRIPTIONS (fixed-price packages, identifier = smartcard number) — return brand + package_query, NOT a key. Brands: ${tvBrands.join(", ")}`,
    `MOBILE DATA (fixed-price bundles, identifier = the recipient's phone number) — return brand + package_query (e.g. "2gb", "1.5gb weekly"), NOT a key. Brands: ${dataBrands.join(", ")}`,
  ].join("\n");
}

export async function billersForHelp(): Promise<string> {
  const all = await getCatalogue();
  const discos = new Set<string>();
  for (const b of all) if (b.category === "electricity") {
    const m = b.brand.match(/[A-Z]{3,6}/);
    discos.add(m ? m[0] : b.brand.split(" ")[0]);
  }
  return `Electricity: ${Array.from(discos).slice(0, 12).join(", ")}\nTV: DStv, GOtv, StarTimes\nData: MTN, Glo, Airtel, 9mobile, Smile`;
}
