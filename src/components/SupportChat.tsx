"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

// Leave-a-message chat. Not an instant chat: a person reads it and replies later by email, and the reply also
// appears here when the visitor comes back. The thread is identified only by a random token kept in this browser.
type Msg = { from: "customer" | "agent"; text: string; at: string };
const TOKEN_KEY = "nolgic-chat-token";
const SEEN_KEY = "nolgic-chat-seen";

const store = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch {} },
};

export default function SupportChat() {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [hp, setHp] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [unread, setUnread] = useState(0);
  const endRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { setToken(store.get(TOKEN_KEY)); }, []);

  const load = useCallback(async (tk: string) => {
    try {
      const r = await fetch(`/api/support?token=${tk}`, { cache: "no-store" });
      if (r.status === 404) { store.set(TOKEN_KEY, ""); setToken(null); setMsgs([]); return; }
      if (!r.ok) return;
      const d = await r.json();
      setMsgs(d.messages ?? []);
    } catch { /* offline: keep what we have */ }
  }, []);

  // Count replies the visitor hasn't seen yet; refresh while the panel is open.
  useEffect(() => {
    if (!token) return;
    load(token);
    const id = setInterval(() => load(token), open ? 15000 : 90000);
    return () => clearInterval(id);
  }, [token, open, load]);

  useEffect(() => {
    const agent = msgs.filter((m) => m.from === "agent").length;
    if (open) { store.set(SEEN_KEY, String(agent)); setUnread(0); }
    else setUnread(Math.max(0, agent - Number(store.get(SEEN_KEY) ?? 0)));
  }, [msgs, open]);

  useEffect(() => { if (open) endRef.current?.scrollIntoView({ block: "end" }); }, [msgs, open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (path?.startsWith("/admin")) return null;

  async function send() {
    setErr("");
    const message = text.trim();
    if (!message) return;
    if (!token && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) { setErr("Enter your email so we can reply to you."); return; }
    setBusy(true);
    try {
      const r = await fetch("/api/support", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, email: email.trim(), name: name.trim(), message, page: path, hp }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(d.error ?? "Couldn’t send that. Please try again."); return; }
      if (d.token) { store.set(TOKEN_KEY, d.token); setToken(d.token); }
      setMsgs(d.messages ?? []);
      setText("");
    } catch { setErr("Couldn’t reach Nolgic. Check your connection and try again."); }
    finally { setBusy(false); }
  }

  return (
    <>
      {!open && (
        <button type="button" onClick={() => { setOpen(true); setTimeout(() => boxRef.current?.focus(), 50); }}
          aria-label={unread ? `Open chat, ${unread} new repl${unread > 1 ? "ies" : "y"}` : "Open chat"}
          className="fixed right-4 bottom-20 sm:bottom-5 z-50 h-14 pl-4 pr-5 rounded-full bg-cta text-oncta font-display font-bold shadow-card flex items-center gap-2 hover:brightness-105 active:brightness-95">
          <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5.5A2.5 2.5 0 016.5 3h11A2.5 2.5 0 0120 5.5v8a2.5 2.5 0 01-2.5 2.5H11l-4.5 4v-4h0A2.5 2.5 0 014 13.5v-8z" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" /></svg>
          Help
          {unread > 0 && <span className="ml-1 min-w-[1.4rem] h-[1.4rem] px-1 rounded-full bg-bad text-white text-xs flex items-center justify-center">{unread}</span>}
        </button>
      )}

      {open && (
        <div role="dialog" aria-label="Chat with Nolgic"
          className="fixed z-50 inset-x-0 bottom-0 sm:inset-x-auto sm:right-5 sm:bottom-5 sm:w-[24rem] max-h-[85vh] flex flex-col rounded-t-3xl sm:rounded-3xl border border-line bg-panel text-paper shadow-card">
          <div className="flex items-center justify-between px-5 py-4 border-b border-line">
            <div>
              <p className="font-display font-bold text-lg leading-tight">Chat with Nolgic</p>
              <p className="text-xs text-haze mt-0.5">A person reads every message and replies here and by email.</p>
            </div>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close chat" className="h-10 w-10 rounded-xl text-haze hover:text-paper hover:bg-sunk text-2xl leading-none">×</button>
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3 min-h-[8rem]" aria-live="polite">
            {msgs.length === 0 && (
              <p className="text-sm text-haze leading-relaxed">
                Ask about an order, a payment or a refund. Include your order number if you have it (it’s on the order page and in your receipt email). We aren’t online all the time, so we’ll reply when we can.
              </p>
            )}
            {msgs.map((m, i) => (
              <div key={i} className={m.from === "customer" ? "flex justify-end" : "flex justify-start"}>
                <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-[15px] leading-snug whitespace-pre-wrap break-words ${m.from === "customer" ? "bg-cta text-oncta" : "bg-sunk text-paper"}`}>
                  {m.from === "agent" && <p className="text-xs font-semibold text-haze mb-0.5">Nolgic</p>}
                  {m.text}
                </div>
              </div>
            ))}
            {msgs.length > 0 && msgs[msgs.length - 1].from === "customer" && (
              <p className="text-xs text-haze">Message received. We’ll reply here and to your email.</p>
            )}
            <div ref={endRef} />
          </div>

          <div className="px-5 pb-5 pt-3 border-t border-line">
            {!token && (
              <div className="grid grid-cols-2 gap-2 mb-2">
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name (optional)" autoComplete="name" aria-label="Your name"
                  className="h-11 rounded-xl bg-sunk border border-line px-3 text-[15px] focus:outline-none focus:ring-2 focus:ring-cta/60" />
                <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Your email" type="email" autoComplete="email" aria-label="Your email"
                  className="h-11 rounded-xl bg-sunk border border-line px-3 text-[15px] focus:outline-none focus:ring-2 focus:ring-cta/60" />
              </div>
            )}
            {/* honeypot: hidden from people, filled in by bots */}
            <input value={hp} onChange={(e) => setHp(e.target.value)} tabIndex={-1} autoComplete="off" aria-hidden="true" className="hidden" name="website" />
            <div className="flex items-end gap-2">
              <textarea ref={boxRef} value={text} onChange={(e) => setText(e.target.value)} rows={2} maxLength={2000} placeholder="Type your message" aria-label="Message"
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }}
                className="flex-1 rounded-xl bg-sunk border border-line px-3 py-2.5 text-[15px] resize-none focus:outline-none focus:ring-2 focus:ring-cta/60" />
              <button type="button" onClick={send} disabled={busy || !text.trim()}
                className="h-11 px-4 rounded-xl bg-cta text-oncta font-display font-bold disabled:opacity-40">{busy ? "…" : "Send"}</button>
            </div>
            {err && <p className="text-bad text-sm mt-2" role="alert">{err}</p>}
          </div>
        </div>
      )}
    </>
  );
}
