import { NextResponse } from "next/server";
import { UUID_RE } from "@/lib/security";
import { payForMeEnabled } from "@/lib/payforme-shared";
import { getCollectView } from "@/lib/payforme-collect";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // reading a joiner's delivery can also move the giveaway along

// What the giveaway link page shows. ?k= (the giver's key) adds the list; ?e= (a joiner's key) adds their own delivery.
export async function GET(req: Request, { params }: { params: { id: string } }) {
  if (!payForMeEnabled()) return NextResponse.json({ error: "Not available" }, { status: 404 });
  if (!UUID_RE.test(params.id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const q = new URL(req.url).searchParams;
  try {
    const view = await getCollectView(params.id, q.get("k"), q.get("e"));
    if (!view) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(view, { headers: { "Cache-Control": "no-store" } });
  } catch (e: any) {
    console.error("[pfc] view failed", e?.message ?? e);
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
