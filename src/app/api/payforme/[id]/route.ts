import { NextResponse } from "next/server";
import { UUID_RE } from "@/lib/security";
import { getPayRequestView, payForMeEnabled, syncPayRequest } from "@/lib/payforme";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // a payment confirmed from here may buy the items

// What the request page shows. Polling it is also what finishes a request if a webhook never arrived.
// Tokens only come back when the secret key (?k=) that the person who asked holds is sent too.
export async function GET(req: Request, { params }: { params: { id: string } }) {
  if (!payForMeEnabled()) return NextResponse.json({ error: "Not available" }, { status: 404 });
  const id = params.id;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    await syncPayRequest(id);
    const view = await getPayRequestView(id, new URL(req.url).searchParams.get("k"));
    if (!view) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(view, { headers: { "Cache-Control": "no-store" } });
  } catch (e: any) {
    console.error("[pfm] view failed", e?.message ?? e);
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
