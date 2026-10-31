// Run:  npx dotenv -e .env.local -- npx tsx scripts/paybeta-probe.ts
// Prints Paybeta's RAW answers for the data-bundle endpoints so we can see exactly what it expects.
// Read-only (no purchases). Never prints your key.
const key = (process.env.PAYBETA_API_KEY ?? "").trim();
const base = (process.env.PAYBETA_BASE ?? "").trim().replace(/\/+$/, "") ||
  ((process.env.PAYBETA_ENV ?? "sandbox") === "live" ? "https://api.paybeta.ng" : "https://api.sandbox.paybeta.ng");
const headers: Record<string, string> = { "P-API-KEY": key, Accept: "application/json", "Content-Type": "application/json" };

async function call(method: "GET" | "POST", path: string, body?: unknown) {
  try {
    const r = await fetch(`${base}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const t = await r.text();
    console.log(`\n${method} ${path} ${body ? JSON.stringify(body) : ""}\n  HTTP ${r.status}\n  ${t.slice(0, 700).replace(/\s+/g, " ")}`);
  } catch (e: any) { console.log(`\n${method} ${path} -> network error ${e?.message}`); }
}

async function main() {
  if (!key) { console.log("Set PAYBETA_API_KEY in .env.local"); return; }
  console.log(`Probing ${base}`);
  await call("GET", "/v2/data-bundle/providers");
  for (const service of ["mtn_data", "glo_data", "airtel_data", "9mobile_data"]) {
    await call("GET", `/v2/data-bundle/list?service=${service}`);
  }
  await call("POST", "/v2/data-bundle/list", { service: "mtn_data" });
}
main();
