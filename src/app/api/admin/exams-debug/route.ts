import { NextResponse } from "next/server";
import { adminGate } from "@/lib/admin-auth";
import { pbExamDebug, pbExamCatalogue } from "@/lib/paybeta";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Founder-only (Authorization: Bearer <ADMIN_PASSWORD>). Shows what Paybeta returns for the exam calls and what
// Nolgic made of it. Nothing secret is included: shapes, short samples, codes and prices.
export async function GET(req: Request) {
  const denied = await adminGate(req);
  if (denied) return denied;
  const calls = await pbExamDebug();
  let parsed: unknown;
  try { parsed = (await pbExamCatalogue()).map((i) => `${i.service} | ${i.code} | ${i.name} | ₦${i.price}`); }
  catch (e) { parsed = `catalogue error: ${String((e as any)?.message ?? e)}`; }
  return NextResponse.json({ parsed, calls });
}
