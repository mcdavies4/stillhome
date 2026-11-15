import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { adminGate } from "@/lib/admin-auth";
import { UUID_RE } from "@/lib/security";
import { draftReply } from "@/lib/support-draft";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// POST { id } -> { draft }. Drafts only: nothing is saved or sent. The founder reads it, edits it, and sends it
// through the normal reply box. Auth: the same admin password as /api/admin.
export async function POST(req: Request) {
  const denied = await adminGate(req);
  if (denied) return denied;
  let b: any;
  try { b = await req.json(); } catch { return NextResponse.json({ error: "Bad request" }, { status: 400 }); }
  const id = String(b?.id ?? "");
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "Bad id" }, { status: 400 });

  const db = supabaseAdmin();
  const { data: thread } = await db.from("support_threads").select("id,page").eq("id", id).maybeSingle();
  if (!thread) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { data: msgs } = await db.from("support_messages").select("sender,body,created_at").eq("thread_id", id).order("created_at", { ascending: true });

  try {
    const draft = await draftReply(msgs ?? [], (thread as any).page ?? null);
    return NextResponse.json({ draft });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Couldn't draft a reply." }, { status: 503 });
  }
}
