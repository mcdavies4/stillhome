// src/lib/receipt-ngn.ts
// Receipt email for ₦-paid orders. Separate from the existing sendReceiptEmail
// (which prices things in £) so a naira order never shows "£0.00".
// Never throws into the payment pipeline's happy path: failures are logged.

const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));

export async function sendNgnReceiptEmail(
  order: {
    id: string;
    email?: string | null;
    biller_name: string;
    identifier: string;
    customer_name: string | null;
    amount_ngn: number;
    service_fee_local?: number | null;
  },
  token: string | null
): Promise<boolean> {
  if (!order.email || !process.env.RESEND_API_KEY) return false;

  const fee = Number(order.service_fee_local ?? 0);
  const total = Number(order.amount_ngn) + fee;
  const n = (v: number) => `₦${Number(v).toLocaleString("en-NG")}`;
  const ref = order.id.slice(0, 8); // the same order number the order page shows
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://www.nolgic.com";

  const html = `
  <div style="font-family:system-ui,Arial,sans-serif;max-width:520px;margin:0 auto;color:#12151e">
    <h2 style="margin:0 0 4px">Payment successful ✅</h2>
    <p style="color:#666;margin:0 0 16px">Order number ${ref}</p>
    <table style="width:100%;border-collapse:collapse;font-size:15px">
      <tr><td style="padding:6px 0;color:#666">Item</td><td style="text-align:right">${esc(order.biller_name)}</td></tr>
      <tr><td style="padding:6px 0;color:#666">Account / meter</td><td style="text-align:right">${esc(order.identifier)}</td></tr>
      ${order.customer_name ? `<tr><td style="padding:6px 0;color:#666">Name</td><td style="text-align:right">${esc(order.customer_name)}</td></tr>` : ""}
      <tr><td style="padding:6px 0;color:#666">Amount</td><td style="text-align:right">${n(order.amount_ngn)}</td></tr>
      ${fee > 0 ? `<tr><td style="padding:6px 0;color:#666">Service fee</td><td style="text-align:right">${n(fee)}</td></tr>` : ""}
      <tr><td style="padding:6px 0;color:#666">Total paid</td><td style="text-align:right;font-weight:600">${n(total)}</td></tr>
    </table>
    ${token ? `<div style="margin:18px 0;padding:14px;border:1px solid #e5c36a;background:#fff8e1;border-radius:10px">
      <div style="font-size:12px;color:#8a6d00;letter-spacing:.1em">METER TOKEN</div>
      <div style="font-size:20px;font-family:monospace;letter-spacing:.08em;margin-top:4px">${esc(token)}</div>
    </div>` : ""}
    <p style="font-size:13px"><a href="${appUrl}/order/${order.id}">View your order</a></p>
    <p style="color:#999;font-size:12px;margin-top:20px">Nolgic sells prepaid digital products. Questions: nolgichq@gmail.com</p>
  </div>`;

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
      body: JSON.stringify({
        from: process.env.RESEND_FROM ?? "Nolgic <noreply@songsnap.online>",
        to: order.email,
        subject: `Nolgic receipt — ${order.biller_name} ${n(order.amount_ngn)}`,
        html,
      }),
    });
    if (!res.ok) { console.error("[receipt-ngn] send failed", res.status, await res.text()); return false; }
    return true;
  } catch (e) {
    console.error("[receipt-ngn] send failed", e);
    return false;
  }
}
