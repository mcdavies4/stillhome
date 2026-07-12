// src/app/api/whatsapp/webhook/route.ts
// Meta WhatsApp Cloud API webhook. Next.js App Router (Node runtime — crypto).

import { NextRequest } from "next/server";
import { verifySignature } from "@/lib/wa/client";
import { alreadyProcessed } from "@/lib/wa/db";
import { handleInbound } from "@/lib/wa/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60; // Vercel: allow time for extraction + validation

// --- Meta verification handshake -------------------------------------------
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  if (
    p.get("hub.mode") === "subscribe" &&
    p.get("hub.verify_token") === process.env.WHATSAPP_VERIFY_TOKEN
  ) {
    return new Response(p.get("hub.challenge") ?? "", { status: 200 });
  }
  return new Response("Forbidden", { status: 403 });
}

// --- Inbound messages -------------------------------------------------------
interface MetaWebhookBody {
  entry?: {
    changes?: {
      value?: {
        contacts?: { wa_id: string; profile?: { name?: string } }[];
        messages?: {
          id: string;
          from: string;
          type: string;
          text?: { body: string };
          interactive?: {
            type: string;
            button_reply?: { id: string; title: string };
            list_reply?: { id: string; title: string };
          };
        }[];
      };
    }[];
  }[];
}

export async function POST(req: NextRequest) {
  const raw = await req.text();

  // 1. Signature check — reject anything not signed by Meta
  if (!verifySignature(raw, req.headers.get("x-hub-signature-256"))) {
    return new Response("Invalid signature", { status: 401 });
  }

  let body: MetaWebhookBody;
  try {
    body = JSON.parse(raw);
  } catch {
    return new Response("Bad payload", { status: 400 });
  }

  // 2. Collect actual user messages (webhook also delivers statuses — skip those)
  const jobs: Promise<void>[] = [];
  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      if (!value?.messages?.length) continue;
      const profileName = value.contacts?.[0]?.profile?.name;

      for (const msg of value.messages) {
        // 3. Dedupe — Meta redelivers on slow/failed responses
        // eslint-disable-next-line no-await-in-loop
        if (await alreadyProcessed(msg.id)) continue;

        let text = "";
        let buttonId: string | undefined;

        if (msg.type === "text" && msg.text?.body) {
          text = msg.text.body;
        } else if (msg.type === "interactive") {
          const reply = msg.interactive?.button_reply ?? msg.interactive?.list_reply;
          if (reply) {
            buttonId = reply.id;
            text = reply.title;
          }
        } else {
          // images/audio/etc — polite nudge, still counts as contact
          jobs.push(
            handleInbound(msg.from, profileName, "").then(() => undefined).catch(console.error)
          );
          continue;
        }

        jobs.push(
          handleInbound(msg.from, profileName, text, buttonId).catch((err) =>
            console.error("[webhook] handleInbound failed", err)
          )
        );
      }
    }
  }

  // 4. Process before responding (maxDuration covers us). If you see Meta
  //    retries due to slow responses at scale, move `jobs` behind
  //    `waitUntil()` from `next/server` instead.
  await Promise.allSettled(jobs);

  return new Response("OK", { status: 200 });
}
