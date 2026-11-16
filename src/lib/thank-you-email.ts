// Thank-you email for paying customers. Used only by the admin send route.
// Sender is fixed to the verified domain. Only fulfilled buyers are ever emailed (enforced in the route).

import { esc } from "@/lib/mailer";

export const THANK_YOU_FROM = "Nolgic <hello@mail.nolgic.com>";
export const THANK_YOU_SUBJECT = "Thank you for paying with Nolgic";

export function thankYouHtml(): string {
  const btn = (href: string, label: string, bg: string, fg: string) =>
    `<a href="${esc(href)}" style="background:${bg};color:${fg};text-decoration:none;font-weight:700;padding:13px 20px;border-radius:12px;display:inline-block;margin:0 6px 8px 0">${esc(label)}</a>`;
  return `<!doctype html><html><body style="margin:0;background:#f4f5f8;font-family:system-ui,Arial,sans-serif;color:#12151e">
<div style="max-width:560px;margin:0 auto;background:#ffffff">
  <div style="background:#0B1026;padding:28px 28px 22px">
    <div style="color:#FFB627;font-weight:800;font-size:20px;letter-spacing:-0.2px">Nolgic</div>
    <div style="color:#ffffff;font-size:22px;font-weight:700;margin-top:14px">Thank you for paying with us.</div>
  </div>
  <div style="padding:26px 28px;line-height:1.6;font-size:15px">
    <p style="margin:0 0 14px">Your bill payment went through, and we are grateful you chose Nolgic to pay it.</p>
    <p style="margin:0 0 14px">Every payment helps us make the next one faster and easier. If anything about your order did not go the way you expected, reply to this email and a real person will sort it out.</p>
    <p style="margin:18px 0 8px">Ready for the next one?</p>
    <div>
      ${btn("https://www.nolgic.com", "Pay a bill", "#FFB627", "#0B1026")}
      ${btn("https://t.me/NolgicBot", "Open @NolgicBot", "#e8ebf2", "#0B1026")}
    </div>
  </div>
  <div style="padding:18px 28px 26px;color:#667085;font-size:12px;line-height:1.5;border-top:1px solid #eceef3">
    You are getting this because you paid a bill through Nolgic. The 36th Solutions Ltd, trading as Nolgic.
  </div>
</div></body></html>`;
}

export function thankYouText(): string {
  return `Thank you for paying with Nolgic.

Your bill payment went through, and we are grateful you chose Nolgic to pay it.

If anything about your order did not go the way you expected, reply to this email and a real person will sort it out.

Pay a bill: https://www.nolgic.com
Open @NolgicBot: https://t.me/NolgicBot

The 36th Solutions Ltd, trading as Nolgic.`;
}
