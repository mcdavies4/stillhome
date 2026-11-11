import { NextResponse } from "next/server";
import { rateLimit } from "@/lib/ratelimit";
import { payForMeEnabled } from "@/lib/payforme-shared";
import { startPayLinkPayment } from "@/lib/paylink";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Someone presses Pay on a bills link: returns the gateway's hosted checkout URL. Nothing is bought until the payment is verified.
export async function POST(req: Request, { params }: { params: { slug: string } }) {
  if (!payForMeEnabled()) return NextResponse.json({ error: "Not available" }, { status: 404 });
  if (!(await rateLimit(req, "paylink-pay", 8, 10)).ok) return NextResponse.json({ error: "Too many attempts. Please wait a few minutes." }, { status: 429 });
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || req.headers.get("x-real-ip") || "unknown";
  const body = await req.json().catch(() => null);
  try {
    const r = await startPayLinkPayment(params.slug, body, ip);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
    return NextResponse.json({ url: r.url });
  } catch (e: any) {
    console.error("[paylink] pay crashed", e?.message ?? e);
    return NextResponse.json({ error: "We couldn't start the payment. Please try again." }, { status: 500 });
  }
}
