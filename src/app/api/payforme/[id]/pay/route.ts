import { NextResponse } from "next/server";
import { rateLimit } from "@/lib/ratelimit";
import { payForMeEnabled, startPayRequestPayment } from "@/lib/payforme";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// The payer presses Pay: returns the gateway's hosted checkout URL. Nothing is bought until the payment is verified.
export async function POST(req: Request, { params }: { params: { id: string } }) {
  if (!payForMeEnabled()) return NextResponse.json({ error: "Not available" }, { status: 404 });
  if (!(await rateLimit(req, "pfm-pay", 10, 10)).ok) return NextResponse.json({ error: "Too many attempts. Please wait a few minutes." }, { status: 429 });
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || req.headers.get("x-real-ip") || "unknown";
  const body = await req.json().catch(() => null);
  try {
    const r = await startPayRequestPayment(params.id, body, ip);
    if (!r.ok) return NextResponse.json({ error: r.error, ...(r.busy ? { busy: true } : {}) }, { status: r.status, headers: r.busy ? { "Retry-After": "120" } : {} });
    return NextResponse.json({ url: r.url });
  } catch (e: any) {
    console.error("[pfm] pay crashed", e?.message ?? e);
    return NextResponse.json({ error: "We couldn't start the payment. Please try again." }, { status: 500 });
  }
}
