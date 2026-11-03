// GET /api/admin/finance/export?type=pnl|ledger|refunds|expenses&format=pdf|csv&from=&to=  (Authorization: Bearer <ADMIN_PASSWORD>)
import { adminGate } from "@/lib/admin-auth";
import { expensesCsv, ledgerCsv, loadReport, logAudit, periodFrom, pnlCsv, refundsCsv } from "@/lib/finance";
import { pnlPdf } from "@/lib/finance-pdf";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(req: Request) {
  const denied = await adminGate(req);
  if (denied) return denied;
  const url = new URL(req.url);
  const type = url.searchParams.get("type") ?? "pnl";
  const format = url.searchParams.get("format") ?? "csv";
  const { from, to } = periodFrom(url);
  try {
    const r = await loadReport(from, to, url.searchParams.get("test") === "1");
    const stem = `nolgic-${type}-${from}_to_${to}`;
    await logAudit(req, "export", `${type}.${format}`, { from, to });
    if (type === "pnl" && format === "pdf") {
      const bytes = await pnlPdf(r);
      return new Response(Buffer.from(bytes), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${stem}.pdf"`, "Cache-Control": "no-store" } });
    }
    const csv = type === "pnl" ? pnlCsv(r) : type === "ledger" ? ledgerCsv(r) : type === "refunds" ? refundsCsv(r) : type === "expenses" ? expensesCsv(r) : null;
    if (csv == null || format !== "csv") return Response.json({ error: "Unknown export" }, { status: 400 });
    return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${stem}.csv"`, "Cache-Control": "no-store" } });
  } catch (e: any) {
    console.error("[finance] export failed", e?.message ?? e);
    return Response.json({ error: "Couldn't build that download." }, { status: 500 });
  }
}
