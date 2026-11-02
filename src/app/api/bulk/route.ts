import { NextResponse } from "next/server";
import { UUID_RE } from "@/lib/security";
import { getBulkView, syncBulk } from "@/lib/bulk";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // a poll may confirm a payment, submit the batch, or settle it

// Batch status for the /bulk/[id] page. Each call also moves the batch forward (confirm payment, submit,
// read Paybeta's results, settle + refund), so the batch finishes even if no webhook ever arrives.
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id || !UUID_RE.test(id)) return NextResponse.json({ error: "Missing id" }, { status: 400 });
  await syncBulk(id);
  const view = await getBulkView(id);
  if (!view) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(view);
}
