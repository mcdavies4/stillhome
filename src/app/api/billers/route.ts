import { NextResponse } from "next/server";
import { getBillCategories } from "@/lib/flutterwave";
import { isSupportedCountry, DEFAULT_COUNTRY } from "@/lib/countries";

export const revalidate = 3600; // catalogue changes rarely

export async function GET(req: Request) {
  // ?country=GH (defaults to NG). Only supported countries are allowed.
  const url = new URL(req.url);
  const raw = (url.searchParams.get("country") ?? DEFAULT_COUNTRY).toUpperCase();
  const country = isSupportedCountry(raw) ? raw : DEFAULT_COUNTRY;

  try {
    const items = await getBillCategories(country);
    const seen = new Set<string>();
    const deduped = items.filter((i) => {
      const key = `${i.biller_code}:${i.item_code}:${i.short_name ?? i.name}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return NextResponse.json({ country, items: deduped });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 502 });
  }
}
