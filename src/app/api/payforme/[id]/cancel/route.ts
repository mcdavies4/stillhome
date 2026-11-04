import { NextResponse } from "next/server";
import { rateLimit } from "@/lib/ratelimit";
import { cancelPayRequest, payForMeEnabled } from "@/lib/payforme";

export const dynamic = "force-dynamic";

// The person who asked can withdraw the request until someone starts paying.
export async function POST(req: Request, { params }: { params: { id: string } }) {
  if (!payForMeEnabled()) return NextResponse.json({ error: "Not available" }, { status: 404 });
  if (!(await rateLimit(req, "pfm-cancel", 10, 10)).ok) return NextResponse.json({ error: "Too many attempts." }, { status: 429 });
  const body = await req.json().catch(() => null);
  const r = await cancelPayRequest(params.id, String(body?.key ?? ""));
  return r.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: r.error }, { status: 400 });
}
