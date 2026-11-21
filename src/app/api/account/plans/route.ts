// POST /api/account/plans — pause, resume, cancel or approve a new price on one of the signed-in customer's monthly plans.
// Uses the account session cookie instead of an emailed link. Same rules as /api/plans (only the owner's plans).
import { NextResponse } from "next/server";
import { readSession, sameOrigin } from "@/lib/account";
import { actOnPlan, listPlansForEmail, type PlanAction } from "@/lib/plan-manage";
import { UUID_RE } from "@/lib/security";

export const dynamic = "force-dynamic";

const ACTIONS: PlanAction[] = ["pause", "resume", "cancel", "approve_price"];

export async function POST(req: Request) {
  if (!sameOrigin(req)) return NextResponse.json({ error: "Bad request" }, { status: 403 });
  const email = readSession(req.headers.get("cookie"));
  if (!email) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  let b: any; try { b = await req.json(); } catch { return NextResponse.json({ error: "Bad request" }, { status: 400 }); }
  const action = ACTIONS.find((a) => a === b?.do);
  if (!action || typeof b?.planId !== "string" || !UUID_RE.test(b.planId)) return NextResponse.json({ error: "Bad request" }, { status: 400 });
  const r = await actOnPlan(email, b.planId, action);
  if (!r.ok) return NextResponse.json({ error: r.error ?? "Could not change this plan" }, { status: 400 });
  return NextResponse.json({ ok: true, plans: await listPlansForEmail(email) });
}
