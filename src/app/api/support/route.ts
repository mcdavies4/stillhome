import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase";
import { rateLimit } from "@/lib/ratelimit";
import { alertFounder } from "@/lib/alerts";
import { cap, normaliseEmail } from "@/lib/security";

export const dynamic = "force-dynamic";

// Visitor side of the support chat.
//   POST {token?, email?, name?, message, page?, hp?}  -> starts a thread (needs email) or adds to theirs (needs token)
//   GET  ?token=                                       -> that thread's messages (customer + agent replies)
// The token is a random secret kept in the visitor's browser; nothing else identifies a thread to the public.

const TOKEN_RE = /^[0-9a-f]{32}$/;
const MAX_PER_THREAD = 60;

async function messagesFor(threadId: string) {
  const { data } = await supabaseAdmin()
    .from("support_messages").select("sender,body,created_at").eq("thread_id", threadId).order("created_at", { ascending: true }).limit(MAX_PER_THREAD + 5);
  return (data ?? []).map((m) => ({ from: m.sender as "customer" | "agent", text: m.body as string, at: m.created_at as string }));
}

export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("token") ?? "";
  if (!TOKEN_RE.test(token)) return NextResponse.json({ error: "Bad token" }, { status: 400 });
  if (!(await rateLimit(req, "support-read", 120, 10)).ok) return NextResponse.json({ error: "Slow down" }, { status: 429 });
  const { data: th } = await supabaseAdmin().from("support_threads").select("id").eq("token", token).maybeSingle();
  if (!th) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ messages: await messagesFor(th.id) });
}

export async function POST(req: Request) {
  let b: any;
  try { b = await req.json(); } catch { return NextResponse.json({ error: "Bad request" }, { status: 400 }); }
  if (typeof b?.hp === "string" && b.hp.trim()) return NextResponse.json({ ok: true }); // honeypot: bots fill hidden fields
  if (!(await rateLimit(req, "support", 8, 10)).ok) {
    return NextResponse.json({ error: "You’re sending messages too fast. Please wait a few minutes." }, { status: 429 });
  }
  const message = cap(b?.message, 2000).trim();
  if (!message) return NextResponse.json({ error: "Type your message first." }, { status: 400 });

  const db = supabaseAdmin();
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || req.headers.get("x-real-ip") || "unknown";
  let thread: { id: string; token: string; email: string; name: string | null } | null = null;

  const token = typeof b?.token === "string" ? b.token : "";
  if (token) {
    if (!TOKEN_RE.test(token)) return NextResponse.json({ error: "Bad token" }, { status: 400 });
    const { data } = await db.from("support_threads").select("id,token,email,name").eq("token", token).maybeSingle();
    thread = data ?? null;
  }
  if (!thread) {
    const email = normaliseEmail(b?.email);
    if (!email) return NextResponse.json({ error: "Enter your email so we can reply to you." }, { status: 400 });
    const { data, error } = await db.from("support_threads").insert({
      token: randomBytes(16).toString("hex"), email, name: cap(b?.name, 80).trim() || null, page: cap(b?.page, 200) || null, ip,
    }).select("id,token,email,name").single();
    if (error || !data) { console.error("[support] create failed", error?.message); return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 }); }
    thread = data;
  }

  const { count } = await db.from("support_messages").select("id", { count: "exact", head: true }).eq("thread_id", thread.id);
  if ((count ?? 0) >= MAX_PER_THREAD) return NextResponse.json({ error: "This conversation is full. Please email nolgichq@gmail.com." }, { status: 429 });

  const { error: mErr } = await db.from("support_messages").insert({ thread_id: thread.id, sender: "customer", body: message });
  if (mErr) { console.error("[support] message failed", mErr.message); return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 }); }
  await db.from("support_threads").update({ status: "open", unread_admin: true, last_message_at: new Date().toISOString() }).eq("id", thread.id);

  const app = process.env.NEXT_PUBLIC_APP_URL ?? "https://www.nolgic.com";
  alertFounder(`💬 Support message from ${thread.name || thread.email}`, `${thread.email}${thread.name ? ` (${thread.name})` : ""}\n\n${message}\n\nReply: ${app}/admin/inbox`);

  return NextResponse.json({ token: thread.token, messages: await messagesFor(thread.id) });
}
