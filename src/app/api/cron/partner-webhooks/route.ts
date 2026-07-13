// GET /api/cron/partner-webhooks
// Delivers pending partner webhook events with HMAC-SHA256 signatures
// and exponential backoff. Protect with CRON_SECRET (same pattern as
// your existing Vercel crons). Runs fine every 5 minutes; can also be
// invoked ad hoc after a vend for near-instant delivery.

import { supabaseAdmin, signWebhookPayload } from "@/lib/partners";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_ATTEMPTS = 8;

export async function GET(req: Request) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const db = supabaseAdmin();
  const { data: events } = await db
    .from("partner_webhook_events")
    .select("id, partner_id, event_type, payload, attempts, created_at, partners(webhook_url, webhook_secret)")
    .eq("status", "pending")
    .lte("next_attempt_at", new Date().toISOString())
    .order("created_at", { ascending: true })
    .limit(25);

  let delivered = 0,
    failed = 0,
    skipped = 0;

  for (const ev of events ?? []) {
    const partner = (ev as any).partners;
    if (!partner?.webhook_url) {
      // Partner hasn't configured a URL — park the event as delivered
      // so it doesn't retry forever; they can read state via GET /orders.
      await db
        .from("partner_webhook_events")
        .update({ status: "delivered", delivered_at: new Date().toISOString(), last_error: "no webhook_url configured" })
        .eq("id", ev.id);
      skipped++;
      continue;
    }

    const rawBody = JSON.stringify({
      id: ev.id,
      type: ev.event_type,
      created_at: ev.created_at,
      data: ev.payload,
    });
    const signature = signWebhookPayload(partner.webhook_secret, rawBody);

    let ok = false;
    let errMsg = "";
    try {
      const res = await fetch(partner.webhook_url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Nolgic-Signature": signature,
          "X-Nolgic-Event": ev.event_type,
        },
        body: rawBody,
        signal: AbortSignal.timeout(10_000),
      });
      ok = res.ok;
      if (!ok) errMsg = `HTTP ${res.status}`;
    } catch (e: any) {
      errMsg = e?.message ?? "network error";
    }

    if (ok) {
      await db
        .from("partner_webhook_events")
        .update({ status: "delivered", delivered_at: new Date().toISOString(), attempts: ev.attempts + 1 })
        .eq("id", ev.id);
      delivered++;
    } else {
      const attempts = ev.attempts + 1;
      const terminal = attempts >= MAX_ATTEMPTS;
      // Backoff: 5, 10, 20, 40, 80... minutes
      const delayMin = 5 * Math.pow(2, ev.attempts);
      await db
        .from("partner_webhook_events")
        .update({
          attempts,
          status: terminal ? "failed" : "pending",
          last_error: errMsg,
          next_attempt_at: new Date(Date.now() + delayMin * 60_000).toISOString(),
        })
        .eq("id", ev.id);
      failed++;
    }
  }

  return Response.json({ delivered, failed, skipped });
}
