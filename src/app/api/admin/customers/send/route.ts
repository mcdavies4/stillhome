// POST /api/admin/customers/send
// Body: { mode: "preview" | "test" | "send", from?: "YYYY-MM-DD", to?: "YYYY-MM-DD", testTo?: string, confirm?: string }
//  preview: counts fulfilled buyers in the range. Sends nothing.
//  test:    sends one thank-you email to testTo only.
//  send:    sends to every buyer in the range. Only runs when confirm === "SEND <count>" where count is the live count.
// Auth: admin password (adminGate). Logs counts only, never addresses.

import { NextResponse } from "next/server";
import { adminGate } from "@/lib/admin-auth";
import { buyerEmails } from "@/lib/buyers";
import { THANK_YOU_FROM, THANK_YOU_SUBJECT, thankYouHtml, thankYouText } from "@/lib/thank-you-email";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const MAX_SEND = 2000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const sendOne = (to: string) => ({ from: THANK_YOU_FROM, reply_to: process.env.SUPPORT_EMAIL ?? "nolgichq@gmail.com", to, subject: THANK_YOU_SUBJECT, html: thankYouHtml(), text: thankYouText() });

export async function POST(req: Request) {
  const denied = await adminGate(req);
  if (denied) return denied;
  if (!process.env.RESEND_API_KEY) return NextResponse.json({ error: "RESEND_API_KEY is not set" }, { status: 500 });

  const body = await req.json().catch(() => null) as null | { mode?: string; from?: string; to?: string; testTo?: string; confirm?: string };
  if (!body) return NextResponse.json({ error: "Bad request" }, { status: 400 });
  const from = body.from || null;
  const to = body.to || null;
  if ((from && !DATE_RE.test(from)) || (to && !DATE_RE.test(to))) return NextResponse.json({ error: "Dates must be YYYY-MM-DD" }, { status: 400 });

  const auth = { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" };

  if (body.mode === "preview" || !body.mode) {
    const emails = await buyerEmails(from, to);
    return NextResponse.json({ count: emails.length, from, to });
  }

  if (body.mode === "test") {
    const testTo = (body.testTo ?? "").trim().toLowerCase();
    if (!testTo.includes("@")) return NextResponse.json({ error: "Enter an email for the test" }, { status: 400 });
    const res = await fetch("https://api.resend.com/emails", { method: "POST", headers: auth, body: JSON.stringify(sendOne(testTo)) });
    console.log(`[admin/customers/send] test ${res.ok ? "sent" : "FAILED " + res.status}`);
    return NextResponse.json({ sent: res.ok ? 1 : 0, failed: res.ok ? 0 : 1 });
  }

  if (body.mode === "send") {
    const emails = await buyerEmails(from, to);
    if (emails.length === 0) return NextResponse.json({ error: "No buyers in this range" }, { status: 400 });
    if (emails.length > MAX_SEND) return NextResponse.json({ error: `Over ${MAX_SEND} recipients. Narrow the dates.` }, { status: 400 });
    if (body.confirm !== `SEND ${emails.length}`) return NextResponse.json({ error: `Confirm with "SEND ${emails.length}"`, count: emails.length }, { status: 409 });

    let sent = 0, failed = 0;
    for (let i = 0; i < emails.length; i += 100) {
      const chunk = emails.slice(i, i + 100).map(sendOne);
      const res = await fetch("https://api.resend.com/emails/batch", { method: "POST", headers: auth, body: JSON.stringify(chunk) });
      if (res.ok) sent += chunk.length; else failed += chunk.length;
    }
    console.log(`[admin/customers/send] thank-you from=${from ?? "-"} to=${to ?? "-"} sent=${sent} failed=${failed}`);
    return NextResponse.json({ sent, failed });
  }

  return NextResponse.json({ error: "Unknown mode" }, { status: 400 });
}
