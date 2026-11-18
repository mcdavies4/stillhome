// POST /api/mail/inbound — Resend "email.received" webhook for replies to our campaign emails.
//   "stop" / "unsubscribe" / "remove me" replies → opted out of marketing and confirmed.
//   Everything else → forwarded to the support inbox, so no reply is lost.
// Requires RESEND_WEBHOOK_SECRET (the webhook's signing secret). Unsigned requests are refused.
import crypto from "crypto";
import { NextResponse } from "next/server";
import { isStopReply, optOut } from "@/lib/plan-manage";
import { sendMail, shell, esc } from "@/lib/mailer";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const SUPPORT = () => process.env.SUPPORT_EMAIL ?? "nolgichq@gmail.com";

function signatureOk(raw: string, h: Headers, secret: string): boolean {
  const id = h.get("svix-id"), ts = h.get("svix-timestamp"), sig = h.get("svix-signature");
  if (!id || !ts || !sig) return false;
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const want = crypto.createHmac("sha256", key).update(`${id}.${ts}.${raw}`).digest("base64");
  const wantBuf = Buffer.from(want);
  return sig.split(" ").some((part) => {
    const [v, val] = part.split(",");
    if (v !== "v1" || !val) return false;
    const b = Buffer.from(val);
    return b.length === wantBuf.length && crypto.timingSafeEqual(b, wantBuf);
  });
}

const addressOf = (from: string) => (from.match(/<([^>]+)>/)?.[1] ?? from).trim().toLowerCase();

export async function POST(req: Request) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "Not configured" }, { status: 500 });
  const raw = await req.text();
  if (!signatureOk(raw, req.headers, secret)) return NextResponse.json({ error: "Bad signature" }, { status: 401 });

  let evt: any;
  try { evt = JSON.parse(raw); } catch { return NextResponse.json({ ok: true }); }
  if (evt?.type !== "email.received" || !evt.data) return NextResponse.json({ ok: true });

  const from = addressOf(String(evt.data.from ?? ""));
  const emailId = String(evt.data.email_id ?? "");
  if (!from.includes("@") || !emailId) return NextResponse.json({ ok: true });

  // Fetch the body (the webhook carries only metadata).
  let text = "";
  let subject = String(evt.data.subject ?? "(no subject)");
  try {
    const r = await fetch(`https://api.resend.com/emails/receiving/${encodeURIComponent(emailId)}`, {
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
    });
    if (r.ok) { const body = await r.json(); text = String(body.text ?? ""); }
  } catch (e) { console.error("[mail/inbound] body fetch failed", e); }

  if (isStopReply(text)) {
    await optOut(from, "reply");
    await sendMail(from, {
      subject: "You're unsubscribed from Nolgic emails",
      html: shell({ title: "You're unsubscribed", bodyHtml: "<p>You won't get marketing emails from Nolgic. Receipts and reminders for any monthly payments you've set up will still come.</p>" }),
      text: "You're unsubscribed from Nolgic marketing emails. Receipts and monthly payment reminders still come.",
    });
    return NextResponse.json({ ok: true, action: "opted_out" });
  }

  await sendMail(SUPPORT(), {
    subject: `Reply from ${from}: ${subject}`,
    html: shell({ title: "Customer reply", bodyHtml: `<p><b>From:</b> ${esc(from)}</p><pre style="white-space:pre-wrap;font-family:inherit">${esc(text.slice(0, 5000))}</pre>` }),
    text: `From: ${from}\n\n${text.slice(0, 5000)}`,
  });
  return NextResponse.json({ ok: true, action: "forwarded" });
}
