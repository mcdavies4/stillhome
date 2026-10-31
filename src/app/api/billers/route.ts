import { NextResponse } from "next/server";
import { getBillCategories } from "@/lib/bills";
import { isSupportedCountry, DEFAULT_COUNTRY } from "@/lib/countries";

// Always run on the server per request, and let the CDN keep a good answer for an hour.
// (A failed answer is sent with no-store, so an outage can never get stuck in the cache.)
export const dynamic = "force-dynamic";

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
    return NextResponse.json(
      { country, items: deduped },
      { headers: { "Cache-Control": deduped.length ? "public, s-maxage=3600, stale-while-revalidate=86400" : "no-store" } }
    );
  } catch (e: any) {
    console.error("[billers] catalogue failed:", e?.message ?? e);
    return NextResponse.json({ error: e?.message ?? "Catalogue unavailable" }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
