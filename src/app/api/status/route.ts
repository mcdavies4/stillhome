import { NextResponse } from "next/server";
import { readStatus } from "@/lib/site-status";

export const dynamic = "force-dynamic";

// The site-wide notice, if there is one. Always answers 200: a problem reading it just means "no notice".
export async function GET() {
  const s = await readStatus();
  return NextResponse.json(s ?? {}, { headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60" } });
}
