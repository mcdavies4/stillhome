import { NextResponse } from "next/server";
import { rateLimit } from "@/lib/ratelimit";
import { payForMeEnabled } from "@/lib/payforme-shared";
import { deleteLink, getOwnerLink, setLinkActive } from "@/lib/paylink";

export const dynamic = "force-dynamic";

// The owner's own view and controls. Everything here needs the secret key that was shown once when the link was made.
export async function POST(req: Request, { params }: { params: { slug: string } }) {
  if (!payForMeEnabled()) return NextResponse.json({ error: "Not available" }, { status: 404 });
  if (!(await rateLimit(req, "paylink-manage", 30, 10)).ok) return NextResponse.json({ error: "Too many attempts. Please wait a few minutes." }, { status: 429 });
  const body = await req.json().catch(() => null);
  const key = String(body?.key ?? "");
  const action = String(body?.action ?? "view");
  try {
    if (action === "pause" || action === "resume") {
      if (!(await setLinkActive(params.slug, key, action === "resume"))) return NextResponse.json({ error: "Not found" }, { status: 404 });
    } else if (action === "delete") {
      if (!(await deleteLink(params.slug, key))) return NextResponse.json({ error: "Not found" }, { status: 404 });
      return NextResponse.json({ deleted: true });
    } else if (action !== "view") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const v = await getOwnerLink(params.slug, key);
    if (!v) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(v);
  } catch (e: any) {
    console.error("[paylink] manage crashed", e?.message ?? e);
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
