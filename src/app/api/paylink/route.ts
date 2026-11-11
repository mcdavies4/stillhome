import { NextResponse } from "next/server";
import { rateLimit } from "@/lib/ratelimit";
import { payForMeEnabled } from "@/lib/payforme-shared";
import { createPayLink, payLinkUrl } from "@/lib/paylink";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // every item is checked with the provider before the link exists

// The person who wants their bills paid makes a standing link. Nothing is bought and nobody is charged here.
export async function POST(req: Request) {
  if (!payForMeEnabled()) return NextResponse.json({ error: "Not available" }, { status: 404 });
  if (!(await rateLimit(req, "paylink-create", 5, 60)).ok) return NextResponse.json({ error: "Too many attempts. Please wait a while and try again." }, { status: 429 });
  const body = await req.json().catch(() => null);
  try {
    const r = await createPayLink(body);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
    return NextResponse.json({ slug: r.slug, key: r.key, url: payLinkUrl(r.slug) });
  } catch (e: any) {
    console.error("[paylink] create crashed", e?.message ?? e);
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
