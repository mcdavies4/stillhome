// src/app/api/cron/reconcile/route.ts
// Emails the daily reconciliation report.
//
// If you're on Vercel Hobby (2 cron limit, both used), DON'T add this to
// vercel.json. Instead call sendReconcileEmail() from your existing token
// cron route (see the one-liner in the README). This route still works when
// hit directly, so you can test it and use it if you ever free a cron slot.

import { NextRequest } from "next/server";
import { runReconcile, reconEmailHtml } from "@/lib/reconcile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ADMIN_EMAIL = process.env.ADMIN_ALERT_EMAIL ?? "azubuikedavies@gmail.com";

export async function sendReconcileEmail(): Promise<{ ok: boolean; flags: number }> {
  const result = await runReconcile();          // yesterday, deep
  const html = reconEmailHtml(result);
  const subject = result.ok
    ? `✓ Nolgic reconciled — ${result.date} (all matched)`
    : `⚠ Nolgic reconciliation — ${result.date} (${result.flags.length} to check)`;

  // Uses Resend directly to avoid coupling to the app's email helper signature.
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
    },
    body: JSON.stringify({
      from: process.env.RESEND_FROM ?? "Nolgic <noreply@songsnap.online>",
      to: ADMIN_EMAIL,
      subject,
      html,
    }),
  });
  if (!res.ok) console.error("[reconcile] email send failed", res.status, await res.text());
  return { ok: result.ok, flags: result.flags.length };
}

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  const r = await sendReconcileEmail();
  return Response.json({ sent: true, ...r });
}
