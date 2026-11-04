// One small sender for the customer emails added after launch (order lookup, top-up reminders).
// Same Resend setup as the follow-up email. Never throws; returns false when it could not send.

export const esc = (s: string) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
export const naira = (n: number | string) => `₦${Math.round(Number(n)).toLocaleString("en-NG")}`;
export const appUrl = () => (process.env.NEXT_PUBLIC_APP_URL ?? "https://www.nolgic.com").replace(/\/$/, "");

export type Mail = { subject: string; html: string; text: string };

export async function sendMail(to: string, m: Mail): Promise<boolean> {
  if (!process.env.RESEND_API_KEY) return false;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
      body: JSON.stringify({
        from: process.env.RESEND_FROM ?? process.env.EMAIL_FROM ?? "Nolgic <noreply@songsnap.online>",
        reply_to: process.env.SUPPORT_EMAIL ?? "nolgichq@gmail.com",
        to, subject: m.subject, html: m.html, text: m.text,
      }),
    });
    if (!res.ok) { console.error("[mailer] send failed", res.status, (await res.text()).slice(0, 300)); return false; }
    return true;
  } catch (e) { console.error("[mailer] send error", e); return false; }
}

/** The common shell: plain, one button, a quiet footer. */
export function shell(opts: { title: string; bodyHtml: string; footerHtml?: string }) {
  return `<div style="font-family:system-ui,Arial,sans-serif;max-width:520px;margin:0 auto;color:#12151e;line-height:1.55">
    <h2 style="margin:0 0 10px">${esc(opts.title)}</h2>${opts.bodyHtml}
    <p style="color:#999;font-size:12px;margin-top:26px">The 36th Solutions Ltd, trading as Nolgic.${opts.footerHtml ? " " + opts.footerHtml : ""}</p></div>`;
}
export const button = (href: string, label: string) =>
  `<p style="margin:18px 0"><a href="${esc(href)}" style="background:#FFB627;color:#0B1026;text-decoration:none;font-weight:700;padding:13px 20px;border-radius:12px;display:inline-block">${esc(label)}</a></p>`;
