// Sandbox sweep: buys ONE of every product Nolgic sells (every airtime network, the cheapest plan of every
// data and TV provider, prepaid + postpaid for every electricity company) and requeries each one.
// Sandbox only (fake money). Refused if VTPASS_ENV is live.
//   npx dotenv -e .env.local -- npx tsx scripts/check-vtpass-all.ts
// Sandbox test numbers (VTpass docs): phone 08011111111, smartcard 1212121212,
//   meter 1111111111111 (prepaid) / 1010101010101 (postpaid, documented for AEDC).
// A FAIL with code 028 just means that product isn't ticked in sandbox Product Settings.
// Code 019 = VTpass's duplicate guard (same service + same number within 30 s): wait a minute between runs
// and never run two sweeps at once.
import { vtpassConfigured, vtpassIsSandbox, vtGetBillCategories, vtLookupItem, vtPay, vtStatus, vtRequestId } from "../src/lib/vtpass";
import { randomUUID } from "crypto";

type Plan = { group: string; label: string; billerCode: string; itemCode: string; identifier: string; amountLocal: number };
const msg = (e: unknown) => String((e as any)?.message ?? e).slice(0, 160);
const TV = new Set(["dstv", "gotv", "startimes", "showmax"]);
const PHONE = "08011111111";

async function main() {
  if (!vtpassConfigured()) { console.log("FAIL  VTPASS_API_KEY / VTPASS_PUBLIC_KEY / VTPASS_SECRET_KEY not set"); process.exit(1); }
  if (!vtpassIsSandbox()) { console.log("Refused: VTPASS_ENV is live. This sweep only runs against the sandbox."); process.exit(1); }

  const items = await vtGetBillCategories();
  const plans: Plan[] = [];

  for (const i of items.filter((x) => x.is_airtime))
    plans.push({ group: "airtime", label: i.biller_code, billerCode: i.biller_code, itemCode: i.item_code, identifier: PHONE, amountLocal: 100 });

  const dataTv = items.filter((x) => !x.is_airtime && !/-electric$/i.test(x.biller_code));
  const cheapest: Record<string, any> = {};
  for (const i of dataTv) if (!cheapest[i.biller_code] || i.amount < cheapest[i.biller_code].amount) cheapest[i.biller_code] = i;
  for (const code of Object.keys(cheapest)) {
    const i = cheapest[code];
    const tv = TV.has(code);
    const phoneBased = !tv || code === "showmax";
    // smile / spectranet identify an account id that VTpass publishes no sandbox number for
    if (/^(smile|spectranet)/i.test(code)) { console.log(`SKIP  data/${code} — no documented sandbox account number`); continue; }
    plans.push({ group: tv ? "tv" : "data", label: `${code} (${i.name})`, billerCode: code, itemCode: i.item_code, identifier: phoneBased ? PHONE : "1212121212", amountLocal: i.amount });
  }

  const discos = Array.from(new Set(items.filter((x) => /-electric$/i.test(x.biller_code)).map((x) => x.biller_code)));
  for (const code of discos) {
    const { min } = await vtLookupItem(code, "prepaid"); // some DISCOs have a minimum above ₦1,000
    const amountLocal = Math.max(1000, min);
    plans.push({ group: "electricity", label: `${code} prepaid (₦${amountLocal})`, billerCode: code, itemCode: "prepaid", identifier: "1111111111111", amountLocal });
    plans.push({ group: "electricity", label: `${code} postpaid (₦${amountLocal})`, billerCode: code, itemCode: "postpaid", identifier: "1010101010101", amountLocal });
  }

  console.log(`VTpass SANDBOX sweep — ${plans.length} products\n`);
  let pass = 0; const failed: string[] = [];
  for (const p of plans) {
    const ref = vtRequestId(randomUUID());
    try {
      const r = await vtPay({ identifier: p.identifier, amountLocal: p.amountLocal, itemCode: p.itemCode, billerCode: p.billerCode, reference: ref, phone: PHONE });
      const s = await vtStatus(ref);
      const ok = s.state === "success";
      const tok = p.group === "electricity" && r.extra ? ` token ok (${r.extra.replace(/\D/g, "").length} digits)` : "";
      console.log(`${ok ? "PASS" : "FAIL"}  ${p.group}/${p.label} — requery ${s.state}${tok}`);
      if (ok) pass++; else failed.push(`${p.group}/${p.label}: requery ${s.state}`);
    } catch (e) {
      const m = msg(e);
      console.log(`FAIL  ${p.group}/${p.label} — ${m}${/028/.test(m) ? "  → tick it in Product Settings" : ""}`);
      failed.push(`${p.group}/${p.label}: ${m}`);
    }
  }
  console.log(`\n${pass}/${plans.length} passed.${failed.length ? " Failures listed above." : ""}`);
}
main().catch((e) => { console.log("Unexpected error:", msg(e)); process.exit(1); });
