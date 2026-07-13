// scripts/create-partner.mjs
// Creates a partner + wallet + API key, and prints the key ONCE.
//
// Usage (PowerShell / cmd, from repo root):
//   node scripts/create-partner.mjs "Acme Remit" acme-remit ops@acmeremit.co.uk test
//   node scripts/create-partner.mjs "Acme Remit" acme-remit ops@acmeremit.co.uk live
//
// Requires env vars (same values as your Vercel project):
//   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// Tip: create a .env.local and run with:  node --env-file=.env.local scripts/create-partner.mjs ...

import { createClient } from "@supabase/supabase-js";
import { createHash, randomBytes } from "node:crypto";

const [name, slug, email, environment = "test"] = process.argv.slice(2);
if (!name || !slug || !email) {
  console.error('Usage: node scripts/create-partner.mjs "<Name>" <slug> <email> [test|live]');
  process.exit(1);
}
if (!["test", "live"].includes(environment)) {
  console.error("Environment must be 'test' or 'live'.");
  process.exit(1);
}

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

// 1. Partner (upsert on slug so re-running just adds a key)
let { data: partner, error } = await db
  .from("partners")
  .upsert({ name, slug, contact_email: email }, { onConflict: "slug" })
  .select()
  .single();
if (error) {
  console.error("Failed to create partner:", error.message);
  process.exit(1);
}

// 2. Wallet (no-op if it exists)
await db.from("partner_wallets").upsert({ partner_id: partner.id }, { onConflict: "partner_id" });

// 3. API key
const key = `nolgic_${environment}_${randomBytes(32).toString("base64url")}`;
const hash = createHash("sha256").update(key).digest("hex");
const { error: keyErr } = await db.from("partner_api_keys").insert({
  partner_id: partner.id,
  environment,
  key_prefix: key.slice(0, 16),
  key_hash: hash,
  label: `${environment} key ${new Date().toISOString().slice(0, 10)}`,
});
if (keyErr) {
  console.error("Failed to create key:", keyErr.message);
  process.exit(1);
}

// 4. Test wallets get free float so you can demo immediately.
if (environment === "test") {
  const TOPUP = 100_000; // £1,000 in pence
  const { data: w } = await db
    .from("partner_wallets")
    .select("balance_pence")
    .eq("partner_id", partner.id)
    .single();
  const newBalance = (w?.balance_pence ?? 0) + TOPUP;
  await db.from("partner_wallets").update({ balance_pence: newBalance }).eq("partner_id", partner.id);
  await db.from("partner_ledger").insert({
    partner_id: partner.id,
    entry_type: "topup",
    amount_pence: TOPUP,
    balance_after_pence: newBalance,
    note: "test-mode float",
  });
  console.log(`Test wallet topped up: £${(TOPUP / 100).toFixed(2)}`);
}

console.log("\n================ PARTNER CREATED ================");
console.log("Partner ID: ", partner.id);
console.log("Slug:       ", partner.slug);
console.log("Webhook sig secret (give to partner):", partner.webhook_secret);
console.log("\nAPI KEY (shown once — store it now):\n");
console.log("  " + key);
console.log("\n=================================================");
