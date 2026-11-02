// src/lib/bulk-email.ts — receipt for a settled bulk airtime batch. Never throws into the pipeline.

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
const n = (v: number) => `₦${Math.round(Number(v)).toLocaleString("en-NG")}`;

export async function sendBulkReceiptEmail(b: Record<string, any>): Promise<boolean> {
  if (!b.email || !process.env.RESEND_API_KEY) return false;
  const total = Number(b.amount_total) + Number(b.service_fee ?? 0);
  const paidNet = total - Number(b.refunded_ngn ?? 0);
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://www.nolgic.com";
  const failed = Number(b.failed_count ?? 0);
  const html = `
  <div style="font-family:system-ui,Arial,sans-serif;max-width:520px;margin:0 auto;color:#12151e">
    <h2 style="margin:0 0 4px">${failed === 0 ? "Bulk airtime delivered ✅" : "Bulk airtime done"}</h2>
    <p style="color:#666;margin:0 0 16px">Batch ${esc(String(b.id).slice(0, 8))}</p>
    <table style="width:100%;border-collapse:collapse;font-size:15px">
      <tr><td style="padding:6px 0;color:#666">Numbers delivered</td><td style="text-align:right">${Number(b.delivered_count ?? 0)} of ${Number(b.recipients_count)}</td></tr>
      <tr><td style="padding:6px 0;color:#666">Airtime delivered</td><td style="text-align:right">${n(b.delivered_ngn ?? 0)}</td></tr>
      ${failed > 0 ? `<tr><td style="padding:6px 0;color:#666">Numbers that failed</td><td style="text-align:right">${failed}</td></tr>
      <tr><td style="padding:6px 0;color:#666">Refunded to you</td><td style="text-align:right">${n(b.refunded_ngn ?? 0)}</td></tr>` : ""}
      <tr><td style="padding:6px 0;color:#666">Service fee</td><td style="text-align:right">${n(b.service_fee ?? 0)}${Number(b.refunded_ngn) >= total ? " (refunded)" : ""}</td></tr>
      <tr><td style="padding:6px 0;color:#666">You paid (after refund)</td><td style="text-align:right;font-weight:600">${n(paidNet)}</td></tr>
    </table>
    ${failed > 0 ? `<p style="font-size:13px;color:#666">Refunds go back to the card or bank account you paid with and can take a few working days to show.</p>` : ""}
    <p style="font-size:13px"><a href="${appUrl}/bulk/${esc(String(b.id))}">See every number</a></p>
    <p style="color:#999;font-size:12px;margin-top:20px">Nolgic sells prepaid digital products. Questions: nolgichq@gmail.com</p>
  </div>`;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
      body: JSON.stringify({
        from: process.env.RESEND_FROM ?? "Nolgic <noreply@songsnap.online>",
        to: b.email,
        subject: `Nolgic bulk airtime — ${Number(b.delivered_count ?? 0)} of ${Number(b.recipients_count)} delivered`,
        html,
      }),
    });
    if (!res.ok) { console.error("[bulk-email] send failed", res.status, await res.text()); return false; }
    return true;
  } catch (e) {
    console.error("[bulk-email] send error", e);
    return false;
  }
}
