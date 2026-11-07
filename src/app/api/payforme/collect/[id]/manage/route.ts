import { NextResponse } from "next/server";
import { rateLimit } from "@/lib/ratelimit";
import { payForMeEnabled } from "@/lib/payforme-shared";
import { cancelCollect, closeCollect, removeEntry } from "@/lib/payforme-collect";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // closing checks every person's choice with the provider again

// The giver's actions. Every one needs the giver's secret key.
//   remove { entryId }  take someone off the list
//   close               lock the list and turn it into a giveaway ready to pay
//   cancel              withdraw the link (only while open)
export async function POST(req: Request, { params }: { params: { id: string } }) {
  if (!payForMeEnabled()) return NextResponse.json({ error: "Not available" }, { status: 404 });
  if (!(await rateLimit(req, "pfc-manage", 40, 10)).ok) return NextResponse.json({ error: "Too many tries. Please wait a few minutes." }, { status: 429 });
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || req.headers.get("x-real-ip") || "unknown";
  const body = await req.json().catch(() => null);
  const key = String(body?.key ?? "");
  try {
    if (body?.action === "remove") {
      const r = await removeEntry(params.id, key, String(body?.entryId ?? ""));
      return r.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: r.error }, { status: r.status });
    }
    if (body?.action === "cancel") {
      const r = await cancelCollect(params.id, key);
      return r.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: r.error }, { status: r.status });
    }
    if (body?.action === "close") {
      const r = await closeCollect(params.id, key, ip);
      if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
      return NextResponse.json(r);
    }
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e: any) {
    console.error("[pfc] manage crashed", e?.message ?? e);
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
