// scripts/dump-billers-by-country.ts
// Pulls Flutterwave bill categories per country so you can SEE what utility
// billers actually exist before designing any expansion.
//
// Run:
//   $env:FLW_SECRET_KEY="FLWSECK_your_live_key"
//   npx tsx scripts/dump-billers-by-country.ts
//
//   # or a subset:
//   npx tsx scripts/dump-billers-by-country.ts NG GH KE
//
// Read-only. Prints a per-country summary + a category breakdown so you can
// judge at a glance whether "Nolgic <country>" is a rich product or a thin one.

const KEY = process.env.FLW_SECRET_KEY;
if (!KEY) {
  console.error("Set FLW_SECRET_KEY first:  $env:FLW_SECRET_KEY=\"FLWSECK_...\"");
  process.exit(1);
}

// Flutterwave-supported countries most relevant to an African diaspora play.
// NG is your baseline; the rest are candidates to evaluate.
const DEFAULT_COUNTRIES = ["NG", "GH", "KE", "UG", "TZ", "ZA", "RW"];

interface BillItem {
  biller_code: string;
  item_code: string;
  biller_name?: string;
  name?: string;
  short_name?: string;
  country?: string;
  is_airtime?: boolean;
  amount?: number;
  label_name?: string;
}

const CATEGORY_RES: [string, RegExp][] = [
  ["Electricity", /(ELECTRIC|DISCO|IKEDC|EKEDC|AEDC|PHED|EEDC|IBEDC|BEDC|KEDCO|KAEDCO|JED|YEDC|ECG|KPLC|UMEME|POWER|PREPAID|POSTPAID)/i],
  ["TV / Cable", /(DSTV|GOTV|STARTIME|CABLE|DECODER|MULTICHOICE|ZUKU|AZAM)/i],
  ["Airtime", /(AIRTIME|VTU|RECHARGE|TOP\s*UP)/i],
  ["Data / Internet", /(DATA|BUNDLE|MB|GB|INTERNET|BROADBAND|SPECTRANET|SMILE|SWIFT)/i],
  ["Water", /(WATER|WATERWORKS|NWSC)/i],
];

function categorise(text: string, isAirtime?: boolean): string {
  if (isAirtime) return "Airtime";
  for (const [name, re] of CATEGORY_RES) if (re.test(text)) return name;
  return "Other (taxes, tolls, tuition, betting, etc.)";
}

async function fetchCountry(country: string): Promise<BillItem[]> {
  const res = await fetch(
    `https://api.flutterwave.com/v3/bill-categories?country=${country}`,
    { headers: { Authorization: `Bearer ${KEY}` } }
  );
  if (!res.ok) {
    console.error(`  [${country}] HTTP ${res.status} — ${await res.text()}`);
    return [];
  }
  const data = (await res.json()) as { status?: string; data?: BillItem[]; message?: string };
  if (data.status !== "success" || !Array.isArray(data.data)) {
    console.error(`  [${country}] ${data.message ?? "no data"}`);
    return [];
  }
  return data.data;
}

async function main() {
  const args = process.argv.slice(2).map((s) => s.toUpperCase()).filter((s) => /^[A-Z]{2}$/.test(s));
  const countries = args.length ? args : DEFAULT_COUNTRIES;

  console.log(`\nFlutterwave bill coverage by country\n${"=".repeat(40)}`);

  const summary: { country: string; total: number; cats: Record<string, number> }[] = [];

  for (const country of countries) {
    const items = await fetchCountry(country);
    if (!items.length) { summary.push({ country, total: 0, cats: {} }); continue; }

    const cats: Record<string, number> = {};
    const seen = new Set<string>();
    const utilityExamples: Record<string, string[]> = {};

    for (const i of items) {
      const key = `${i.biller_code}|${i.item_code}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const text = `${i.biller_name ?? ""} ${i.name ?? ""} ${i.short_name ?? ""}`;
      const cat = categorise(text, i.is_airtime);
      cats[cat] = (cats[cat] ?? 0) + 1;
      if (cat !== "Other (taxes, tolls, tuition, betting, etc.)") {
        (utilityExamples[cat] ??= []);
        if (utilityExamples[cat].length < 4) {
          const label = (i.biller_name ?? i.name ?? i.short_name ?? "").trim();
          if (label && !utilityExamples[cat].includes(label)) utilityExamples[cat].push(label);
        }
      }
    }

    summary.push({ country, total: seen.size, cats });

    console.log(`\n${country}  —  ${seen.size} unique billers`);
    const order = ["Electricity", "TV / Cable", "Airtime", "Data / Internet", "Water", "Other (taxes, tolls, tuition, betting, etc.)"];
    for (const cat of order) {
      if (!cats[cat]) continue;
      const ex = utilityExamples[cat]?.length ? `  e.g. ${utilityExamples[cat].join(", ")}` : "";
      console.log(`   ${cat.padEnd(20)} ${String(cats[cat]).padStart(3)}${ex}`);
    }
  }

  // Verdict table — utility depth is what matters for a Nolgic-style product.
  console.log(`\n${"=".repeat(40)}\nUTILITY DEPTH (the categories Nolgic actually sells)\n`);
  console.log("Country  Electric  TV   Airtime  Data  Water   → verdict");
  for (const s of summary) {
    const e = s.cats["Electricity"] ?? 0;
    const t = s.cats["TV / Cable"] ?? 0;
    const a = s.cats["Airtime"] ?? 0;
    const d = s.cats["Data / Internet"] ?? 0;
    const w = s.cats["Water"] ?? 0;
    const utilityTotal = e + t + a + d + w;
    const verdict =
      s.total === 0 ? "no access / not supported"
      : e >= 3 && (t + a + d) >= 3 ? "RICH — viable Nolgic market"
      : utilityTotal >= 3 ? "THIN — partial (maybe airtime/data only)"
      : "MINIMAL — not worth it yet";
    console.log(
      `${s.country.padEnd(8)} ${String(e).padStart(6)}  ${String(t).padStart(3)}  ${String(a).padStart(6)}  ${String(d).padStart(4)}  ${String(w).padStart(4)}   → ${verdict}`
    );
  }
  console.log("");
}

main().catch((e) => { console.error("dump failed:", e); process.exit(2); });
