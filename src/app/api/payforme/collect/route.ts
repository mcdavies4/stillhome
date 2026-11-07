import { NextResponse } from "next/server";
import { rateLimit } from "@/lib/ratelimit";
import { payForMeEnabled } from "@/lib/payforme-shared";
import { createCollect } from "@/lib/payforme-collect";

export const dynamic = "force-dynamic";

// The giver makes a giveaway link. Nothing is charged here.
export async function POST(req: Request) {
  if (!payForMeEnabled()) return NextResponse.json({ error: "Not available" }, { status: 404 });
  if (!(await rateLimit(req, "pfc-create", 6, 60)).ok) return NextResponse.json({ error: "Too many giveaways in a short time. Please wait a while and try again." }, { status: 429 });
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || req.headers.get("x-real-ip") || "unknown";
  const body = await req.json().catch(() => null);
  try {
    const r = await createCollect(body, ip);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
    return NextResponse.json({ id: r.id, key: r.key });
  } catch (e: any) {
    console.error("[pfc] create crashed", e?.message ?? e);
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
