// src/app/api/cron/wa-sweep/route.ts
// Vercel cron (*/10): proactively expire stale WhatsApp payment links and
// prune webhook-dedupe rows.
//
// vercel.json:
// { "crons": [{ "path": "/api/cron/wa-sweep", "schedule": "*/10 * * * *" }] }

import { NextRequest } from "next/server";
import { stripe } from "@/lib/stripe";
import { db, resetConversation } from "@/lib/wa/db";
import { sendText } from "@/lib/wa/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const now = new Date().toISOString();
  const { data: stale } = await db
    .from("wa_conversations")
    .select("wa_user_id, order_id, wa_users!inner(wa_phone)")
    .eq("state", "awaiting_payment")
    .lt("expires_at", now);

  let expired = 0;
  for (const convo of stale ?? []) {
    const phone = (convo as unknown as { wa_users: { wa_phone: string } }).wa_users.wa_phone;
    if (convo.order_id) {
      const { data: order } = await db
        .from("orders")
        .select("status, stripe_session_id")
        .eq("id", convo.order_id)
        .single();
      // Race guard: only expire if genuinely still unpaid
      if (order?.status === "pending_payment") {
        await db.from("orders").update({ status: "expired" }).eq("id", convo.order_id);
        if (order.stripe_session_id) {
          try { await stripe.checkout.sessions.expire(order.stripe_session_id); } catch { /* paid or gone */ }
        }
        await resetConversation(convo.wa_user_id);
        try {
          await sendText(phone, "Your payment link expired ⏰ Nothing was charged. Say *retry* to place the order again.");
        } catch { /* outside 24h window — silence is fine */ }
        expired++;
      } else {
        await resetConversation(convo.wa_user_id);
      }
    } else {
      await resetConversation(convo.wa_user_id);
    }
  }

  await db.rpc("wa_prune_processed_messages");

  return Response.json({ expired, swept_at: now });
}
