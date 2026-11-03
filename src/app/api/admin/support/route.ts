import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { adminGate } from "@/lib/admin-auth";
import { cap } from "@/lib/security";
import { UUID_RE } from "@/lib/security";

export const dynamic = "force-dynamic";

// Founder side of the support chat (Authorization: Bearer <ADMIN_PASSWORD>, same as /api/admin).
//   GET            -> thread list, newest activity first
//   GET ?id=       -> one thread's messages (marks it read)
//   POST {id, body}            -> reply: saved, then emailed to the customer
//   POST {id, action: "close" | "reopen"}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));

export async function GET(req: Request) {
  const denied = await adminGate(req);
  if (denied) return denied;
  const db = supabaseAdmin();
  const id = new URL(req.url).searchParams.get("id");

  if (id) {
    if (!UUID_RE.test(id)) return NextResponse.json({ error: "Bad id" }, { status: 400 });
    const [{ data: thread }, { data: msgs }] = await Promise.all([
      db.from("support_threads").select("id,email,name,status,page,created_at").eq("id", id).maybeSingle(),
      db.from("support_messages").select("id,sender,body,created_at").eq("thread_id", id).order("created_at", { ascending: true }),
    ]);
    if (!thread) return NextResponse.json({ error: "Not found" }, { status: 404 });
    await db.from("support_threads").update({ unread_admin: false }).eq("id", id);
    return NextResponse.json({ thread, messages: msgs ?? [] });
  }

  const { data: threads } = await db.from("support_threads")
    .select("id,email,name,status,unread_admin,last_message_at").order("last_message_at", { ascending: false }).limit(100);
  const ids = (threads ?? []).map((t) => t.id);
  const last = new Map<string, { sender: string; body: string }>();
  if (ids.length) {
    const { data: ms } = await db.from("support_messages").select("thread_id,sender,body,created_at").in("thread_id", ids).order("created_at", { ascending: false }).limit(600);
    for (const m of ms ?? []) if (!last.has(m.thread_id)) last.set(m.thread_id, { sender: m.sender, body: m.body });
  }
  return NextResponse.json({
    threads: (threads ?? []).map((t) => ({ ...t, preview: (last.get(t.id)?.body ?? "").slice(0, 120), lastFrom: last.get(t.id)?.sender ?? null })),
    unread: (threads ?? []).filter((t) => t.unread_admin).length,
  });
}

export async function POST(req: Request) {
  const denied = await adminGate(req);
  if (denied) return denied;
  let b: any;
  try { b = await req.json(); } catch { return NextResponse.json({ error: "Bad request" }, { status: 400 }); }
  const id = String(b?.id ?? "");
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "Bad id" }, { status: 400 });
  const db = supabaseAdmin();

  if (b.action === "close" || b.action === "reopen") {
    await db.from("support_threads").update({ status: b.action === "close" ? "closed" : "open" }).eq("id", id);
    return NextResponse.json({ ok: true });
  }

  const body = cap(b?.body, 4000).trim();
  if (!body) return NextResponse.json({ error: "Write a reply first." }, { status: 400 });
  const { data: thread } = await db.from("support_threads").select("id,email,name").eq("id", id).maybeSingle();
  if (!thread) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { error } = await db.from("support_messages").insert({ thread_id: id, sender: "agent", body });
  if (error) return NextResponse.json({ error: "Could not save the reply." }, { status: 500 });
  await db.from("support_threads").update({ unread_admin: false, last_message_at: new Date().toISOString() }).eq("id", id);

  // Email the reply. If this fails the reply is still saved and shows in their chat next time they open it.
  let emailed = false;
  if (process.env.RESEND_API_KEY) {
    const app = process.env.NEXT_PUBLIC_APP_URL ?? "https://www.nolgic.com";
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
        body: JSON.stringify({
          from: process.env.RESEND_FROM ?? "Nolgic <noreply@songsnap.online>",
          reply_to: "nolgichq@gmail.com",
          to: thread.email,
          subject: "Nolgic support replied to your message",
          html: `<div style="font-family:system-ui,Arial,sans-serif;max-width:520px;margin:0 auto;color:#12151e">
            <p style="margin:0 0 12px">${thread.name ? `Hi ${esc(thread.name)},` : "Hi,"}</p>
            <div style="white-space:pre-wrap;padding:14px;border-radius:10px;background:#f4f5f8">${esc(body)}</div>
            <p style="font-size:13px;color:#666;margin-top:16px">Reply to this email, or open the chat on <a href="${app}">nolgic.com</a> to continue.</p>
            <p style="color:#999;font-size:12px">Nolgic · nolgichq@gmail.com</p></div>`,
        }),
      });
      emailed = res.ok;
      if (!res.ok) console.error("[support] reply email failed", res.status, await res.text());
    } catch (e) { console.error("[support] reply email error", e); }
  }
  return NextResponse.json({ ok: true, emailed });
}
