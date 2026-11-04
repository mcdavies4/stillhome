import { NextResponse } from "next/server";
import { rateLimit } from "@/lib/ratelimit";
import { createPayRequest, payForMeEnabled } from "@/lib/payforme";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // every item is checked with the provider before the request exists

// The person who needs things paid for makes a request. Nothing is bought and nobody is charged here.
export async function POST(req: Request) {
  if (!payForMeEnabled()) return NextResponse.json({ error: "Not available" }, { status: 404 });
  if (!(await rateLimit(req, "pfm-create", 8, 60)).ok) return NextResponse.json({ error: "Too many requests. Please wait a while and try again." }, { status: 429 });
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || req.headers.get("x-real-ip") || "unknown";
  const body = await req.json().catch(() => null);
  try {
    const r = await createPayRequest(body, ip);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
    return NextResponse.json({ id: r.id, key: r.key, total: r.total, count: r.count });
  } catch (e: any) {
    console.error("[pfm] create crashed", e?.message ?? e);
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
