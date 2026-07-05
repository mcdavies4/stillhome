import { NextResponse } from "next/server";
import { validateCustomer, FlwError } from "@/lib/flutterwave";

export async function POST(req: Request) {
  const { itemCode, billerCode, identifier } = await req.json();
  if (!itemCode || !billerCode || !identifier) {
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
    const msg = e instanceof FlwError ? e.message : "Could not validate this number";
    return NextResponse.json({ ok: false, error: msg }, { status: 422 });
  }
}
