"use client";

import { useCallback, useEffect, useState } from "react";

// Support inbox for the founder. Uses the same ADMIN_PASSWORD sign-in as /admin (kept in sessionStorage for the tab).
type Th = { id: string; email: string; name: string | null; status: "open" | "closed"; unread_admin: boolean; last_message_at: string; preview: string; lastFrom: string | null };
type Msg = { id: string; sender: "customer" | "agent"; body: string; created_at: string };
const when = (s: string) => new Date(s).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export default function Inbox() {
  const [authed, setAuthed] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [threads, setThreads] = useState<Th[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [thread, setThread] = useState<{ email: string; name: string | null; status: string; page: string | null } | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  useEffect(() => { try { setAuthed(sessionStorage.getItem("nolgic-admin")); } catch {} setReady(true); }, []);

  const api = useCallback(async (path: string, init?: RequestInit) => {
    const r = await fetch(path, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}), Authorization: `Bearer ${authed}` } });
    if (r.status === 401) { setAuthed(null); throw new Error("unauthorized"); }
    return r;
  }, [authed]);

  const loadList = useCallback(async () => {
    if (!authed) return;
    try { const r = await api("/api/admin/support"); if (r.ok) setThreads((await r.json()).threads ?? []); } catch {}
  }, [authed, api]);
  const open = useCallback(async (id: string) => {
    setSel(id); setNote("");
    try {
      const r = await api(`/api/admin/support?id=${id}`);
      if (r.ok) { const d = await r.json(); setThread(d.thread); setMsgs(d.messages ?? []); }
      loadList();
    } catch {}
  }, [api, loadList]);

  useEffect(() => { loadList(); const t = setInterval(loadList, 30000); return () => clearInterval(t); }, [loadList]);

  async function send() {
    if (!sel || !reply.trim()) return;
    setBusy(true); setNote("");
    try {
      const r = await api("/api/admin/support", { method: "POST", body: JSON.stringify({ id: sel, body: reply }) });
      const d = await r.json();
      if (!r.ok) { setNote(d.error ?? "Failed"); return; }
      setReply(""); setNote(d.emailed ? "Sent and emailed." : "Saved. The email didn’t send (it will still show in their chat).");
      open(sel);
    } catch {} finally { setBusy(false); }
  }
  async function setStatus(action: "close" | "reopen") {
    if (!sel) return;
    await api("/api/admin/support", { method: "POST", body: JSON.stringify({ id: sel, action }) }).catch(() => {});
    open(sel); loadList();
  }

  if (!ready) return null;
  if (!authed) {
    return (
      <main id="content" className="max-w-md mx-auto px-5 pt-16">
        <h1 className="font-display font-bold text-2xl">Support inbox</h1>
        <p className="text-haze mt-3">Sign in on the <a href="/admin" className="underline">admin page</a> first, then come back here.</p>
      </main>
    );
  }

  return (
    <main id="content" className="max-w-5xl mx-auto px-5 pt-8 pb-24">
      <div className="flex items-baseline justify-between">
        <h1 className="font-display font-bold text-3xl">Support inbox</h1>
        <a href="/admin" className="text-sm text-haze underline">Back to admin</a>
      </div>
      <div className="mt-6 grid md:grid-cols-[18rem_1fr] gap-5">
        <ul className="rounded-2xl border border-line bg-panel divide-y divide-line self-start max-h-[70vh] overflow-y-auto">
          {threads.length === 0 && <li className="p-4 text-haze text-sm">No messages yet.</li>}
          {threads.map((t) => (
            <li key={t.id}>
              <button type="button" onClick={() => open(t.id)} className={`w-full text-left p-4 hover:bg-sunk ${sel === t.id ? "bg-sunk" : ""}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold truncate">{t.name || t.email}</span>
                  {t.unread_admin && <span className="w-2.5 h-2.5 rounded-full bg-cta shrink-0" aria-label="Unread" />}
                </div>
                <p className="text-sm text-haze truncate mt-0.5">{t.lastFrom === "agent" ? "You: " : ""}{t.preview}</p>
                <p className="text-xs text-haze mt-1">{when(t.last_message_at)}{t.status === "closed" ? " · closed" : ""}</p>
              </button>
            </li>
          ))}
        </ul>

        <section className="rounded-2xl border border-line bg-panel p-5 min-h-[16rem]">
          {!sel || !thread ? <p className="text-haze">Pick a conversation.</p> : (
            <>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-display font-bold text-lg">{thread.name || thread.email}</p>
                  <p className="text-sm text-haze">{thread.email}{thread.page ? ` · from ${thread.page}` : ""}</p>
                </div>
                <button type="button" onClick={() => setStatus(thread.status === "open" ? "close" : "reopen")} className="text-sm px-3 h-9 rounded-xl border border-line hover:bg-sunk">
                  {thread.status === "open" ? "Mark done" : "Reopen"}
                </button>
              </div>
              <div className="mt-4 space-y-3 max-h-[45vh] overflow-y-auto">
                {msgs.map((m) => (
                  <div key={m.id} className={m.sender === "agent" ? "flex justify-end" : "flex justify-start"}>
                    <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 whitespace-pre-wrap break-words ${m.sender === "agent" ? "bg-cta text-oncta" : "bg-sunk"}`}>
                      {m.body}
                      <p className="text-xs opacity-60 mt-1">{when(m.created_at)}</p>
                    </div>
                  </div>
                ))}
              </div>
              <textarea value={reply} onChange={(e) => setReply(e.target.value)} rows={3} placeholder="Write your reply. It is emailed to the customer and shown in their chat."
                className="mt-4 w-full rounded-xl bg-sunk border border-line p-3 focus:outline-none focus:ring-2 focus:ring-cta/60" aria-label="Reply" />
              <div className="mt-3 flex items-center gap-3">
                <button type="button" onClick={send} disabled={busy || !reply.trim()} className="h-11 px-6 rounded-xl bg-cta text-oncta font-display font-bold disabled:opacity-40">{busy ? "Sending…" : "Send reply"}</button>
                {note && <span className="text-sm text-haze" role="status">{note}</span>}
              </div>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
