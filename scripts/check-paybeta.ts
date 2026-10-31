// Run:  npx dotenv -e .env.local -- npx tsx scripts/check-paybeta.ts
// Checks the Paybeta connection end to end. Read-only by default.
//   CHECK_VEND=airtime|data|tv|electricity   also performs ONE sandbox vend — refused unless PAYBETA_ENV is sandbox
// Overrides: CHECK_PHONE (default 08011111111)  CHECK_METER  CHECK_SERVICE (electricity slug)  CHECK_TYPE (prepaid|postpaid)
//            CHECK_CARD (smartcard)
// It prints the service ids it found so you can compare them with the Paybeta docs.
import { paybetaConfigured, paybetaIsSandbox, pbGetBillCategories, pbValidate, pbBalance, pbPay, pbReference } from "../src/lib/paybeta";
import { randomUUID } from "crypto";

const rows: { ok: boolean; name: string; detail: string }[] = [];
const add = (ok: boolean, name: string, detail = "") => { rows.push({ ok, name, detail }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `\n      ${detail}` : ""}`); };
const msg = (e: unknown) => String((e as any)?.message ?? e).slice(0, 300);

async function main() {
  console.log(`Paybeta check — ${paybetaIsSandbox() ? "SANDBOX (no real money)" : "LIVE"}\n`);
  if (!paybetaConfigured()) { add(false, "1. Key present", "Set PAYBETA_API_KEY"); return; }
  add(true, "1. Key present");

  try { const b = await pbBalance(); add(true, "2. Auth + wallet balance", `₦${b.toLocaleString()}`); }
  catch (e) { add(false, "2. Auth + wallet balance", msg(e) + "  (401/403 = wrong key or account not approved for live; sandbox key only works on the sandbox)"); }

  let items: Awaited<ReturnType<typeof pbGetBillCategories>> = [];
  try {
    items = await pbGetBillCategories();
    const by = (f: (i: any) => boolean) => items.filter(f).length;
    add(items.length > 0, "3. Catalogue", `${items.length} items — electricity ${by((i) => /electric/i.test(i.biller_name))}, airtime ${by((i) => i.is_airtime)}, TV ${by((i) => /dstv|gotv|startimes/i.test(i.biller_name))}, data ${by((i) => /data/i.test(i.biller_name) && !i.is_airtime)}`);
    const services = Array.from(new Set(items.map((i) => i.biller_code)));
    console.log(`      service ids: ${services.join(", ")}`);
  } catch (e) { add(false, "3. Catalogue", msg(e)); }

  const service = process.env.CHECK_SERVICE ?? items.find((i) => i.item_code === "prepaid")?.biller_code ?? "ikeja-electric";
  const type = process.env.CHECK_TYPE ?? "prepaid";
  const meter = process.env.CHECK_METER ?? "0111100049"; // the meter used in Paybeta's docs examples
  try { const v = await pbValidate(type, service, meter); add(!!v.name, `4. Meter lookup (${service}/${type}, ${meter})`, `name: ${v.name} · minimum vend ₦${v.minimum}`); }
  catch (e) { add(false, `4. Meter lookup (${service}/${type}, ${meter})`, msg(e)); }

  const tv = items.find((i) => /dstv|gotv|startimes/i.test(i.biller_name));
  const card = process.env.CHECK_CARD ?? "8072916698"; // the smartcard used in Paybeta's docs examples
  if (tv) {
    try { const v = await pbValidate(tv.item_code, tv.biller_code, card); add(!!v.name, `5. Smartcard lookup (${tv.biller_code}, ${card})`, `name: ${v.name}`); }
    catch (e) { add(false, `5. Smartcard lookup (${tv.biller_code}, ${card})`, msg(e)); }
  }

  const vend = process.env.CHECK_VEND;
  if (vend) {
    if (!paybetaIsSandbox()) { add(false, "6. Sandbox vend", "Refused: PAYBETA_ENV is live. Only run CHECK_VEND against the sandbox."); return; }
    const phone = process.env.CHECK_PHONE ?? "08011111111";
    const plans: Record<string, () => any> = {
      airtime: () => { const i = items.find((x) => x.is_airtime); return i && { identifier: phone, amountLocal: 100, itemCode: i.item_code, billerCode: i.biller_code, label: `${i.name} ₦100` }; },
      data: () => { const i = items.find((x) => /data/i.test(x.biller_name) && !x.is_airtime); return i && { identifier: phone, amountLocal: i.amount, itemCode: i.item_code, billerCode: i.biller_code, label: `${i.biller_name} ${i.name}` }; },
      tv: () => tv && { identifier: card, amountLocal: tv.amount, itemCode: tv.item_code, billerCode: tv.biller_code, label: `${tv.biller_name} ${tv.name}` },
      electricity: () => ({ identifier: meter, amountLocal: 1000, itemCode: type, billerCode: service, label: `${service} ${type} ₦1,000` }),
    };
    const plan = plans[vend]?.();
    if (!plan) { add(false, `6. Sandbox vend (${vend})`, "Unknown kind or no matching plan in the catalogue. Use airtime | data | tv | electricity."); return; }
    const ref = pbReference(randomUUID());
    try {
      const r = await pbPay({ identifier: plan.identifier, amountLocal: plan.amountLocal, itemCode: plan.itemCode, billerCode: plan.billerCode, reference: ref });
      add(true, `6. Sandbox vend (${plan.label})`, `ref ${ref} · transaction ${r.flw_ref}${r.extra ? ` · token ${r.extra}` : " · no token (normal for non-electricity)"}`);
    } catch (e) { add(false, `6. Sandbox vend (${plan.label})`, `${msg(e)}${(e as any)?.notVended ? "  [definite rejection]" : "  [outcome unknown — would go to review]"}`); }
  }
}

main().catch((e) => add(false, "Unexpected error", msg(e))).finally(() => {
  const failed = rows.filter((r) => !r.ok).length;
  console.log(failed ? `\n${failed} check(s) failed.` : "\nAll checks passed.");
  process.exit(failed ? 1 : 0);
});
