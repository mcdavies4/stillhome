// POST /api/admin/push/send  { mode: "preview" | "send", title?, body?, confirm? }
// preview: counts registered devices. send: needs confirm === "SEND <count>" (the live count).
// Admin password required. Logs counts only.
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { adminGate } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function tokens(): Promise<string[]> {
  const { data, error } = await supabaseAdmin().from("push_tokens").select("token");
  if (error) throw new Error("push_tokens query failed");
  return (data ?? []).map((r: any) => r.token as string);
}

export async function POST(req: Request) {
  const denied = await adminGate(req);
  if (denied) return denied;
  const body = await req.json().catch(() => null) as null | { mode?: string; title?: string; body?: string; confirm?: string };
  if (!body) return NextResponse.json({ error: "Bad request" }, { status: 400 });

  const all = await tokens();
  if (body.mode !== "send") return NextResponse.json({ count: all.length });

  const title = String(body.title ?? "").trim().slice(0, 80);
  const text = String(body.body ?? "").trim().slice(0, 200);
  if (!title || !text) return NextResponse.json({ error: "Title and message are needed" }, { status: 400 });
  if (body.confirm !== `SEND ${all.length}`) return NextResponse.json({ error: `Confirm with "SEND ${all.length}"`, count: all.length }, { status: 409 });

  let sent = 0, failed = 0;
  for (let i = 0; i < all.length; i += 100) {
    const messages = all.slice(i, i + 100).map((to) => ({ to, title, body: text, sound: "default" }));
    const res = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(messages),
    });
    if (res.ok) sent += messages.length; else failed += messages.length;
  }
  console.log(`[admin/push/send] sent=${sent} failed=${failed}`);
  return NextResponse.json({ sent, failed });
}
