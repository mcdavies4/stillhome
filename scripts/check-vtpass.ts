// Run:  npx dotenv -e .env.local -- npx tsx scripts/check-vtpass.ts
// Checks the VTpass connection end to end. Read-only by default.
//   CHECK_VEND=1   also performs ONE vend — refused unless VTPASS_ENV is sandbox
// Overrides: CHECK_SERVICE (default abuja-electric)  CHECK_TYPE (prepaid|postpaid)
//            CHECK_METER (default: VTpass sandbox test meter 1111111111111)
import { vtpassConfigured, vtpassIsSandbox, vtGetBillCategories, vtValidate, vtBalance, vtPay, vtStatus, vtRequestId } from "../src/lib/vtpass";
import { randomUUID } from "crypto";

const rows: { ok: boolean; name: string; detail: string }[] = [];
const add = (ok: boolean, name: string, detail = "") => { rows.push({ ok, name, detail }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `\n      ${detail}` : ""}`); };
const msg = (e: unknown) => String((e as any)?.message ?? e).slice(0, 300);

async function main() {
  console.log(`VTpass check — ${vtpassIsSandbox() ? "SANDBOX (no real money)" : "LIVE"}\n`);
  if (!vtpassConfigured()) { add(false, "1. Keys present", "Set VTPASS_API_KEY, VTPASS_PUBLIC_KEY, VTPASS_SECRET_KEY"); return; }
  add(true, "1. Keys present");

  try { const b = await vtBalance(); add(true, "2. Auth + wallet balance", `₦${b.toLocaleString()}`); }
  catch (e) { add(false, "2. Auth + wallet balance", msg(e) + "  (code 027 = server IP not whitelisted; 087 = wrong keys)"); }

  try {
    const items = await vtGetBillCategories();
    const by = (f: (i: any) => boolean) => items.filter(f).length;
    add(items.length > 0, "3. Catalogue", `${items.length} items — electricity ${by((i) => /electric/i.test(i.biller_name))}, airtime ${by((i) => i.is_airtime)}, TV ${by((i) => /dstv|gotv|startimes|showmax/i.test(i.biller_name))}, data ${by((i) => /data/i.test(i.biller_name) && !i.is_airtime)}`);
  } catch (e) { add(false, "3. Catalogue", msg(e)); }

  const service = process.env.CHECK_SERVICE ?? "abuja-electric";
  const type = process.env.CHECK_TYPE ?? "prepaid";
  const meter = process.env.CHECK_METER ?? "1111111111111";
  try { const v = await vtValidate(type, service, meter); add(!!v.name, `4. Lookup (${service}/${type}, ${meter})`, `name: ${v.name}`); }
  catch (e) { add(false, `4. Lookup (${service}/${type}, ${meter})`, msg(e)); }

  if (process.env.CHECK_VEND === "1") {
    if (!vtpassIsSandbox()) { add(false, "5. Sandbox vend", "Refused: VTPASS_ENV is live. Only run CHECK_VEND against the sandbox."); return; }
    const ref = vtRequestId(randomUUID());
    try {
      const r = await vtPay({ identifier: "08011111111", amountLocal: 100, itemCode: "airtime", billerCode: "mtn", reference: ref, phone: "08011111111" });
      add(true, "5. Sandbox vend (MTN airtime ₦100)", `ref ${ref} · transaction ${r.flw_ref}`);
      const s = await vtStatus(ref);
      add(s.state === "success", "6. Requery", `state=${s.state} (${s.detail})`);
    } catch (e) { add(false, "5. Sandbox vend", msg(e)); }
  }
}

main().catch((e) => add(false, "Unexpected error", msg(e))).finally(() => {
  const failed = rows.filter((r) => !r.ok).length;
  console.log(failed ? `\n${failed} check(s) failed.` : "\nAll checks passed.");
  process.exit(failed ? 1 : 0);
});
