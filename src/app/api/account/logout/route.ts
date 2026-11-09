import { NextResponse } from "next/server";
import { clearCookies, sameOrigin } from "@/lib/account";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!sameOrigin(req)) return NextResponse.json({ error: "Bad request" }, { status: 403 });
  const res = NextResponse.json({ ok: true });
  for (const c of clearCookies()) res.headers.append("Set-Cookie", c);
  return res;
}
