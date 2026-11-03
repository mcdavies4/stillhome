// GET /api/admin/finance?from=YYYY-MM-DD&to=YYYY-MM-DD — the finance summary the admin page shows.
import { NextResponse } from "next/server";
import { adminGate } from "@/lib/admin-auth";
import { loadReport, periodFrom } from "@/lib/finance";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(req: Request) {
  const denied = await adminGate(req);
  if (denied) return denied;
  try {
    const url = new URL(req.url);
    const { from, to } = periodFrom(url);
    const report = await loadReport(from, to, url.searchParams.get("test") === "1");
    // The page does not need every ledger row; the CSV export has them all.
    const { ledger, ...rest } = report;
    return NextResponse.json({ ...rest, ledgerCount: ledger.length });
  } catch (e: any) {
    console.error("[finance] report failed", e?.message ?? e);
    return NextResponse.json({ error: "Couldn't build the report. Check the server log." }, { status: 500 });
  }
}
