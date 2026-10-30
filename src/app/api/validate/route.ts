import { NextResponse } from "next/server";
import { validateCustomer, FlwError } from "@/lib/bills";
import { rateLimit } from "@/lib/ratelimit";

export async function POST(req: Request) {
  const { ok } = await rateLimit(req, "validate", 20, 10);
  if (!ok) return NextResponse.json({ ok: false, error: "Too many attempts — please wait a few minutes." }, { status: 429 });

  const body = await req.json().catch(() => null);
  const { itemCode, billerCode, identifier } = body ?? {};
  if (
    typeof itemCode !== "string" || typeof billerCode !== "string" || typeof identifier !== "string" ||
    !itemCode || !billerCode || !identifier ||
    itemCode.length > 64 || billerCode.length > 64 || identifier.length > 64
  ) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }
  try {
    const result = await validateCustomer(itemCode, billerCode, String(identifier).trim());
    return NextResponse.json({
      ok: true,
      name: result.name,
      minimum: result.minimum,
      maximum: result.maximum,
    });
  } catch (e) {
    // Never forward raw provider errors ("Flutterwave HTTP 500: {...}") to the browser.
    const raw = e instanceof FlwError ? e.message : "";
    const msg = raw && !/^(Flutterwave|VTpass) /i.test(raw) ? raw : "Could not validate this number";
    return NextResponse.json({ ok: false, error: msg }, { status: 422 });
  }
}
