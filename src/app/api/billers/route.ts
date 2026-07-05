import { NextResponse } from "next/server";
import { getBillCategories } from "@/lib/flutterwave";

export const revalidate = 3600; // catalogue changes rarely

export async function GET() {
  try {
    const items = await getBillCategories();
    const seen = new Set<string>();
    const deduped = items.filter((i) => {
      const key = `${i.biller_code}:${i.item_code}:${i.short_name ?? i.name}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return NextResponse.json({ items: deduped });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 502 });
  }
}
