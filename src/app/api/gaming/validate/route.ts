import { NextResponse } from "next/server";
import { validateGamingAccount, cleanGamingInput } from "@/lib/gaming";
import { FlwError } from "@/lib/flutterwave";
import { rateLimit } from "@/lib/ratelimit";

// Confirms a betting account before the customer pays. Read-only: no money moves here.
export async function POST(req: Request) {
  const { ok } = await rateLimit(req, "gaming-validate", 20, 10);
  if (!ok) return NextResponse.json({ ok: false, error: "Too many attempts. Please wait a few minutes." }, { status: 429 });

  const body = await req.json().catch(() => null);
  const input = cleanGamingInput(body?.service, body?.customerId);
  if (!input) return NextResponse.json({ ok: false, error: "Choose an operator and enter a valid betting ID" }, { status: 400 });

  try {
    const acc = await validateGamingAccount(input.service, input.customerId);
    return NextResponse.json({ ok: true, name: acc.customerName, customerId: acc.customerId, service: acc.service, minimum: acc.minimumNaira });
  } catch (e) {
    const raw = e instanceof FlwError ? e.message : "";
    // Never pass raw provider errors to the browser.
    const msg = raw && !/^(Flutterwave|VTpass|Paybeta) /i.test(raw) ? raw : "Could not validate this betting account";
    return NextResponse.json({ ok: false, error: msg }, { status: 422 });
  }
}
