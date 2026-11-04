import { NextResponse } from "next/server";
import { normaliseEmail } from "@/lib/security";
import { rateLimit } from "@/lib/ratelimit";
import { LOOKUP_PER_IP, sendOrderLookup } from "@/lib/find-order";

export const dynamic = "force-dynamic";

// "Find my order": emails the customer their recent orders. The answer is the SAME whether or not that address
// has any orders, so this can never be used to discover who is a customer.
export async function POST(req: Request) {
  let body: any; try { body = await req.json(); } catch { return NextResponse.json({ error: "Bad request" }, { status: 400 }); }
  if (typeof body?.website === "string" && body.website) return NextResponse.json({ ok: true }); // honeypot: bots fill it, people never see it
  const email = normaliseEmail(body?.email);
  if (!email) return NextResponse.json({ error: "Enter the email address you used when you paid." }, { status: 400 });

  const rl = await rateLimit(req, "find-order", LOOKUP_PER_IP, 15);
  if (!rl.ok) return NextResponse.json({ error: "Too many tries. Please wait a few minutes and try again." }, { status: 429 });

  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || req.headers.get("x-real-ip") || "unknown";
  try { await sendOrderLookup(email, ip); } catch (e) { console.error("[find-order] failed", (e as any)?.message ?? e); }
  return NextResponse.json({ ok: true });
}
