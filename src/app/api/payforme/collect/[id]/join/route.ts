import { NextResponse } from "next/server";
import { rateLimit } from "@/lib/ratelimit";
import { payForMeEnabled } from "@/lib/payforme-shared";
import { joinCollect } from "@/lib/payforme-collect";

export const dynamic = "force-dynamic";
export const maxDuration = 30; // the meter / smartcard is checked with the provider

// A person joins a giveaway with their own choice and number. Nothing is charged.
export async function POST(req: Request, { params }: { params: { id: string } }) {
  if (!payForMeEnabled()) return NextResponse.json({ error: "Not available" }, { status: 404 });
  if (!(await rateLimit(req, "pfc-join", 5, 60)).ok) return NextResponse.json({ error: "Too many tries from this connection. Please wait a while." }, { status: 429 });
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || req.headers.get("x-real-ip") || "unknown";
  const body = await req.json().catch(() => null);
  try {
    const r = await joinCollect(params.id, body, ip);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
    return NextResponse.json({ entryKey: r.entryKey });
  } catch (e: any) {
    console.error("[pfc] join crashed", e?.message ?? e);
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
