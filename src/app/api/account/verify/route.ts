import { NextResponse } from "next/server";
import { normaliseEmail } from "@/lib/security";
import { rateLimit } from "@/lib/ratelimit";
import { accountsEnabled, sameOrigin, sessionCookies, verifyCode } from "@/lib/account";

export const dynamic = "force-dynamic";

// Step 2 of sign-in: check the code and start a 30-day session.
export async function POST(req: Request) {
  if (!sameOrigin(req)) return NextResponse.json({ error: "Bad request" }, { status: 403 });
  if (!accountsEnabled()) return NextResponse.json({ error: "Accounts aren't switched on yet." }, { status: 503 });
  let body: any; try { body = await req.json(); } catch { return NextResponse.json({ error: "Bad request" }, { status: 400 }); }
  const email = normaliseEmail(body?.email);
  const code = String(body?.code ?? "").replace(/\s/g, "");
  if (!email || !/^\d{6}$/.test(code)) return NextResponse.json({ error: "Enter the 6-digit code from the email." }, { status: 400 });
  const rl = await rateLimit(req, "acct-verify", 20, 15);
  if (!rl.ok) return NextResponse.json({ error: "Too many tries. Please wait a few minutes." }, { status: 429 });
  const r = await verifyCode(email, code);
  if (!r.ok) {
    const msg = r.reason === "locked" ? "Too many wrong codes. Ask for a new code." : r.reason === "expired" ? "That code has expired. Ask for a new one." : "That code isn't right. Check the email and try again.";
    return NextResponse.json({ error: msg, reason: r.reason }, { status: r.reason === "locked" ? 429 : 400 });
  }
  const res = NextResponse.json({ ok: true });
  for (const c of sessionCookies(email)) res.headers.append("Set-Cookie", c);
  return res;
}
