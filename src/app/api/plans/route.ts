// /api/plans — powers the manage-plans page.
//   GET  ?token=…                      → the signed-in email's plans
//   POST {action:"request", email}     → emails a 30-minute sign-in link (same answer whether or not a plan exists)
//   POST {action:"act", token, planId, do:"pause"|"resume"|"cancel"}
// No login: the signed link ties access to one email and expires.

import { NextResponse } from "next/server";
import { rateLimit } from "@/lib/ratelimit";
import { verifyLink, listPlansForEmail, actOnPlan, sendPlansLink } from "@/lib/plan-manage";

export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ACTIONS = ["pause", "resume", "cancel"] as const;

export async function GET(req: Request) {
  const email = verifyLink("plans", new URL(req.url).searchParams.get("token"));
  if (!email) return NextResponse.json({ error: "This link has expired. Request a new one." }, { status: 401 });
  return NextResponse.json({ email, plans: await listPlansForEmail(email) });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as null | { action?: string; email?: string; token?: string; planId?: string; do?: string };
  if (!body) return NextResponse.json({ error: "Bad request" }, { status: 400 });

  if (body.action === "request") {
    const email = String(body.email ?? "").trim().toLowerCase();
    if (!EMAIL_RE.test(email) || email.length > 200) return NextResponse.json({ error: "Enter a valid email" }, { status: 400 });
    const rl = await rateLimit(req, "plans_request", 20, 60);
    if (!rl.ok) return NextResponse.json({ error: "Too many requests. Try again in an hour." }, { status: 429 });
    try { await sendPlansLink(email); } catch (e) { console.error("[plans] link email failed", e); }
    return NextResponse.json({ ok: true, message: "If this email has a monthly payment with us, a sign-in link is on its way. Check spam too." });
  }

  if (body.action === "act") {
    const email = verifyLink("plans", body.token);
    if (!email) return NextResponse.json({ error: "This link has expired. Request a new one." }, { status: 401 });
    const action = ACTIONS.find((a) => a === body.do);
    if (!action || !body.planId) return NextResponse.json({ error: "Bad request" }, { status: 400 });
    const r = await actOnPlan(email, body.planId, action);
    if (!r.ok) return NextResponse.json({ error: r.error ?? "Could not change this plan" }, { status: 400 });
    return NextResponse.json({ ok: true, plans: await listPlansForEmail(email) });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
