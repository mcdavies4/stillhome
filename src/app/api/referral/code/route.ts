import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { UUID_RE } from "@/lib/security";
import { getOrCreateCode, referralsEnabled } from "@/lib/referral";
import { rateLimit } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

// The invite code for the person who paid this order. The order id (a long random number only the payer holds) is the proof.
export async function POST(req: Request) {
  if (!referralsEnabled()) return NextResponse.json({ error: "Not available" }, { status: 404 });
  let body: any; try { body = await req.json(); } catch { return NextResponse.json({ error: "Bad request" }, { status: 400 }); }
  const id = String(body?.orderId ?? "");
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "Bad request" }, { status: 400 });
  const rl = await rateLimit(req, "referral-code", 20, 15);
  if (!rl.ok) return NextResponse.json({ error: "Too many tries" }, { status: 429 });
  try {
    const { data: o } = await supabaseAdmin().from("orders").select("email,status,is_test").eq("id", id).maybeSingle();
    const order = o as any;
    if (!order || order.status !== "fulfilled" || !order.email) return NextResponse.json({ error: "Not available" }, { status: 404 });
    return NextResponse.json({ code: await getOrCreateCode(String(order.email).trim().toLowerCase()) });
  } catch (e) { console.error("[referral] code failed", (e as any)?.message ?? e); return NextResponse.json({ error: "Try again" }, { status: 500 }); }
}
