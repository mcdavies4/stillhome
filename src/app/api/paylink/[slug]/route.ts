import { NextResponse } from "next/server";
import { payForMeEnabled } from "@/lib/payforme-shared";
import { getPublicLink, payLinkReady } from "@/lib/paylink";

export const dynamic = "force-dynamic";

// What a stranger may see about a bills link: the owner's chosen name, what can be paid, the last four digits.
export async function GET(_req: Request, { params }: { params: { slug: string } }) {
  if (!payForMeEnabled() || !(await payLinkReady())) return NextResponse.json({ error: "Not available" }, { status: 404 });
  const v = await getPublicLink(params.slug).catch(() => null);
  if (!v) return NextResponse.json({ error: "This link wasn't found." }, { status: 404 });
  return NextResponse.json(v);
}
