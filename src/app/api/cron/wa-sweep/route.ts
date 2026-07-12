// src/app/api/cron/wa-sweep/route.ts
// Vercel cron: expire stale awaiting_payment conversations proactively so
// users get told without having to message first. Also prunes dedupe rows.
//
// vercel.json:
// { "crons": [{ "path": "/api/cron/wa-sweep", "schedule": "*/10 * * * *" }] }

import { NextRequest } from "next/server";
import Stripe from "stripe";
import { db, resetConversation } from "@/lib/wa/db";
import { sendText } from "@/lib/wa/client";

export const runtime = "nodejs";
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

export async function GET(req: NextRequest) {
  // Vercel cron sends this header; also allow manual trigger with CRON_SECRET
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
      // Guard against race: only expire if still unpaid
      if (order?.status === "awaiting_payment") {
        await db.from("orders").update({ status: "expired" }).eq("id", convo.order_id);
        if (order.stripe_session_id) {
          try { await stripe.checkout.sessions.expire(order.stripe_session_id); } catch { /* paid or gone */ }
        }
        await resetConversation(convo.wa_user_id);
        try {
          await sendText(phone, "Your payment link expired ⏰ Nothing was charged. Say *retry* to place the order again.");
        } catch { /* outside 24h window — silent is fine here */ }
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
