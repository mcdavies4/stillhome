// scripts/check-owner-lookup.ts
// Tests every link in the "Check account name" chain and says which one is broken.
//
//   1. Env: is FLW_SECRET_KEY present and clean?
//   2. Flutterwave auth: can the key list the NG catalogue?
//   3. Flutterwave validate (direct): does a known-good meter return its owner?
//   4. Your live site: do /api/billers (NG + GH) and /api/validate respond correctly?
//
// Run (PowerShell, repo root):
//   npx dotenv -e .env.local -- npx tsx scripts/check-owner-lookup.ts
//
// Optional overrides (set before running):
//   $env:CHECK_METER="47001297002"     # meter to validate (default: your known-good AEDC meter)
//   $env:CHECK_ITEM="UB584"            # FLW item code   (default: Abuja Disco Prepaid)
//   $env:CHECK_BILLER="BIL204"         # FLW biller code (default: Abuja Disco)
//   $env:CHECK_GH_METER="..."          # a real ECG meter, to test Ghana too
//   $env:CHECK_SITE="https://www.nolgic.com"
//
// Read-only. Nothing is charged, vended or written.

const FLW_KEY_RAW = process.env.FLW_SECRET_KEY ?? "";
const FLW_KEY = FLW_KEY_RAW.trim();
const SITE = (process.env.CHECK_SITE ?? "https://www.nolgic.com").replace(/\/$/, "");
const METER = process.env.CHECK_METER ?? "47001297002";
const ITEM = process.env.CHECK_ITEM ?? "UB584";
const BILLER = process.env.CHECK_BILLER ?? "BIL204";
const GH_METER = process.env.CHECK_GH_METER ?? "";
const FLW = "https://api.flutterwave.com/v3";

const C = { reset: "\x1b[0m", red: "\x1b[31m", green: "\x1b[32m", yellow: "\x1b[33m", cyan: "\x1b[36m", grey: "\x1b[90m", bold: "\x1b[1m" };
const results: Record<string, boolean> = {};

function report(key: string, ok: boolean, title: string, note: string) {
  results[key] = ok;
  const tag = ok ? `${C.green}PASS${C.reset}` : `${C.red}FAIL${C.reset}`;
  console.log(`${tag}  ${C.bold}${title}${C.reset}\n      ${C.grey}${note}${C.reset}`);
}

async function timed<T>(fn: () => Promise<T>): Promise<{ v: T; ms: number }> {
  const t = Date.now();
  const v = await fn();
  return { v, ms: Date.now() - t };
}

async function flwGet(path: string) {
  const { v, ms } = await timed(async () => {
    const res = await fetch(`${FLW}${path}`, { headers: { Authorization: `Bearer ${FLW_KEY}` } });
    const text = await res.text();
    let body: any = {};
    try { body = JSON.parse(text); } catch { /* leave empty */ }
    return { status: res.status, body, text };
  });
  return { ...v, ms };
}

async function flwValidate(item: string, biller: string, customer: string) {
  const r = await flwGet(`/bill-items/${encodeURIComponent(item)}/validate?code=${encodeURIComponent(biller)}&customer=${encodeURIComponent(customer)}`);
  const d = r.body?.data;
  const okCode = !d?.response_code || d.response_code === "00";
  const name: string | null = d?.name ?? null;
  return {
    ok: r.status === 200 && r.body?.status !== "error" && okCode && !!name,
    name,
    status: r.status,
    msg: d?.response_message ?? r.body?.message ?? r.text.slice(0, 160),
    ms: r.ms,
  };
}

async function siteGet(path: string) {
  const { v, ms } = await timed(async () => {
    const res = await fetch(`${SITE}${path}`, { redirect: "manual" });
    const text = await res.text();
    let body: any = {};
    try { body = JSON.parse(text); } catch { /* leave empty */ }
    return { status: res.status, location: res.headers.get("location"), body, text };
  });
  return { ...v, ms };
}

async function main() {
  console.log(`\n${C.bold}${C.cyan}Nolgic — account-name lookup check${C.reset}  ${C.grey}(site: ${SITE})${C.reset}\n`);

  // ---- 1. env ----
  if (!FLW_KEY) {
    report("env", false, "1. FLW_SECRET_KEY", "Missing. Check .env.local has FLW_SECRET_KEY=... (no quotes, no spaces around =).");
    return summary();
  }
  const dirty = FLW_KEY_RAW !== FLW_KEY || /["'\s]/.test(FLW_KEY);
  const mode = FLW_KEY.startsWith("FLWSECK_TEST") ? "TEST key" : FLW_KEY.startsWith("FLWSECK") ? "LIVE key" : "unrecognised prefix";
  report("env", !dirty && mode !== "unrecognised prefix", "1. FLW_SECRET_KEY present",
    `${mode}, ${FLW_KEY.length} chars${dirty ? " — contains quotes/whitespace, re-paste it cleanly" : ""}${mode === "TEST key" ? " — test keys cannot validate real meters" : ""}`);

  // ---- 2. FLW auth + catalogue ----
  const cat = await flwGet("/bill-categories?country=NG");
  if (cat.status === 200 && Array.isArray(cat.body?.data)) {
    report("flwAuth", true, "2. Flutterwave auth + NG catalogue", `${cat.body.data.length} items in ${cat.ms}ms`);
  } else {
    const hint = cat.status === 401 ? "Key rejected — wrong key, or rotated in the FLW dashboard." :
                 cat.status === 403 ? "Forbidden — IP/permission restriction on the key." :
                 cat.status >= 500 ? "Flutterwave is having an outage; retry in a few minutes." : "See raw message.";
    report("flwAuth", false, "2. Flutterwave auth + NG catalogue", `HTTP ${cat.status}: ${cat.body?.message ?? cat.text.slice(0, 160)}  →  ${hint}`);
  }

  // ---- 3. FLW validate, direct ----
  const v1 = await flwValidate(ITEM, BILLER, METER);
  if (v1.ok) {
    report("flwValidate", true, `3. Direct validate (${BILLER}/${ITEM}, meter ${METER})`, `Owner returned: "${v1.name}" in ${v1.ms}ms`);
  } else {
    report("flwValidate", false, `3. Direct validate (${BILLER}/${ITEM}, meter ${METER})`, `HTTP ${v1.status}: ${v1.msg}`);
  }

  if (GH_METER) {
    const g = await flwValidate("UB231", "BIL142", GH_METER);
    report("flwValidateGH", g.ok, "3b. Direct validate — Ghana ECG (BIL142/UB231)",
      g.ok ? `Owner returned: "${g.name}" in ${g.ms}ms` : `HTTP ${g.status}: ${g.msg}`);
  }

  // ---- 4. live site ----
  for (const country of ["NG", "GH"]) {
    const r = await siteGet(`/api/billers?country=${country}`);
    if (r.status >= 300 && r.status < 400) {
      report(`site${country}`, false, `4. Site /api/billers?country=${country}`,
        `HTTP ${r.status} redirect to ${r.location}. Browsers follow this, webhooks don't — fine for the page, but note it.`);
      continue;
    }
    const items: any[] = r.body?.items ?? [];
    const wrongCountry = items.length > 0 && items.some((i) => i.country && i.country !== country);
    const ok = r.status === 200 && items.length > 0 && !wrongCountry && (r.body?.country ?? country) === country;
    report(`site${country}`, ok, `4. Site /api/billers?country=${country}`,
      r.status !== 200 ? `HTTP ${r.status}: ${r.body?.error ?? r.text.slice(0, 160)}`
      : items.length === 0 ? "200 but zero billers returned"
      : wrongCountry ? `Returned billers for the WRONG country (route is serving a cached ${items[0].country} list)`
      : `${items.length} billers, all ${country} (${r.ms}ms)`);
  }

  {
    const { v, ms } = await timed(async () => {
      const res = await fetch(`${SITE}/api/validate`, {
        method: "POST",
        redirect: "manual",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemCode: ITEM, billerCode: BILLER, identifier: METER }),
      });
      const text = await res.text();
      let body: any = {};
      try { body = JSON.parse(text); } catch { /* leave empty */ }
      return { status: res.status, body, text, location: res.headers.get("location") };
    });
    if (v.status >= 300 && v.status < 400) {
      report("siteValidate", false, "4. Site POST /api/validate", `HTTP ${v.status} redirect to ${v.location} — POST body is dropped on redirect. Check CHECK_SITE uses the canonical (www) domain.`);
    } else if (v.status === 200 && v.body?.ok && v.body?.name) {
      report("siteValidate", true, "4. Site POST /api/validate", `Owner returned: "${v.body.name}" in ${ms}ms`);
    } else {
      report("siteValidate", false, "4. Site POST /api/validate", `HTTP ${v.status}: ${v.body?.error ?? v.text.slice(0, 200)}`);
    }
  }

  summary();
}

function summary() {
  console.log(`\n${C.bold}${C.cyan}Diagnosis${C.reset}`);
  const r = results;
  const say = (m: string) => console.log("  " + m);

  if (r.env === false) say("Fix the key in .env.local (and in Vercel → Settings → Environment Variables), redeploy, rerun.");
  else if (r.flwAuth === false) say("Flutterwave is rejecting the key or is down. In the FLW dashboard check Settings → API keys: has the secret key been rotated? If so, update FLW_SECRET_KEY in Vercel + .env.local and redeploy.");
  else if (r.flwValidate === false && r.siteValidate === false) say("The break is on Flutterwave's side, not your code: the key works but the validate call fails for a meter that worked before. Read the message above. 'Invalid customer id' on a known-good meter = a bad/stale item code or biller downtime; retry later or try the postpaid item (UB585). Your app can't fix this; raising it with FLW support with the message above is the move.");
  else if (r.flwValidate === true && r.siteValidate === false) say("Flutterwave works but your site's /api/validate doesn't. The fault is in that route or the deploy. Paste src/app/api/validate/route.ts and the Vercel log line for a failed lookup and I'll fix it.");
  else if (r.siteNG === false || r.siteGH === false) say("Lookup chain is fine but the billers list is broken. Read the billers line above; if it says 'WRONG country', deploy the hardened billers-route.ts.");
  else if (r.flwValidate === true && r.siteValidate === true) say("Everything passes. If the page still fails, the problem is in the browser: hard-refresh (Ctrl+Shift+R), try another network, and tell me the exact message the page shows.");
  console.log("");
  process.exit(Object.values(r).every(Boolean) ? 0 : 1);
}

main().catch((e) => { console.error("check failed to run:", e); process.exit(2); });
