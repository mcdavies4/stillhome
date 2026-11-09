import { NextResponse } from "next/server";
import { normaliseEmail } from "@/lib/security";
import { rateLimit } from "@/lib/ratelimit";
import { accountsEnabled, requestCode, sameOrigin } from "@/lib/account";

export const dynamic = "force-dynamic";

// Step 1 of sign-in: email a 6-digit code. The answer is the same whether or not the address is known.
export async function POST(req: Request) {
  if (!sameOrigin(req)) return NextResponse.json({ error: "Bad request" }, { status: 403 });
  if (!accountsEnabled()) return NextResponse.json({ error: "Accounts aren't switched on yet." }, { status: 503 });
  let body: any; try { body = await req.json(); } catch { return NextResponse.json({ error: "Bad request" }, { status: 400 }); }
  if (typeof body?.website === "string" && body.website) return NextResponse.json({ ok: true }); // honeypot
  const email = normaliseEmail(body?.email);
  if (!email) return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  const rl = await rateLimit(req, "acct-request", 6, 15);
  if (!rl.ok) return NextResponse.json({ error: "Too many tries. Please wait a few minutes and try again." }, { status: 429 });
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || req.headers.get("x-real-ip") || "unknown";
  const r = await requestCode(email, ip);
  if (r === "throttled") return NextResponse.json({ error: "We've already sent you a few codes. Check your inbox and spam, or try again in an hour." }, { status: 429 });
  if (r === "mail_failed") return NextResponse.json({ error: "We couldn't send the email just now. Please try again in a minute." }, { status: 502 });
  return NextResponse.json({ ok: true });
}
