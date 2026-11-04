"use client";

import { useCallback, useEffect, useState } from "react";

type Data = {
  status: { level: "info" | "warn"; message: string }; maxLen: number;
  reminders: { sent_30d: number; came_back: number; opted_out: number; tableReady: boolean };
  referrals: { enabled: boolean; count: number; fees_waived_ngn: number; tableReady: boolean; recent: { id: string; referrer_email: string; referee_email: string; referee_waived_ngn: number; referrer_waived_ngn: number; created_at: string }[] };
};

// Founder-only. Uses the admin password already stored by /admin in this tab.
export default function AdminGrowth() {
  const [d, setD] = useState<Data | null>(null);
  const [state, setState] = useState<"load" | "noauth" | "error">("load");
  const [msg, setMsg] = useState("");
  const [level, setLevel] = useState<"info" | "warn">("info");
  const [text, setText] = useState("");
  const [note, setNote] = useState("");
  const pass = () => { try { return sessionStorage.getItem("nolgic-admin"); } catch { return null; } };

  const load = useCallback(async () => {
    const p = pass(); if (!p) { setState("noauth"); return; }
    try {
      const r = await fetch("/api/admin/growth", { headers: { Authorization: `Bearer ${p}` } });
      const j = await r.json();
      if (!r.ok) { setMsg(j.error ?? "Failed"); setState("error"); return; }
      setD(j); setLevel(j.status.level); setText(j.status.message);
    } catch { setMsg("Request failed"); setState("error"); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function save(clear = false) {
    const p = pass(); if (!p) return;
    setNote("");
    const r = await fetch("/api/admin/growth", { method: "POST", headers: { Authorization: `Bearer ${p}`, "Content-Type": "application/json" }, body: JSON.stringify({ level, message: clear ? "" : text }) });
    const j = await r.json();
    if (!r.ok) { setNote(`${j.error ?? "Failed"}${j.hint ? `. ${j.hint}` : ""}`); return; }
    if (clear) setText("");
    setNote(clear ? "Notice cleared. It disappears from the site within a minute." : "Saved. It shows on the site within a minute.");
    load();
  }

  if (state === "noauth") return <main className="max-w-xl mx-auto px-5 pt-12"><p>Sign in at <a className="underline" href="/admin">/admin</a> first, then come back.</p></main>;
  if (state === "error") return <main className="max-w-xl mx-auto px-5 pt-12"><p className="text-bad">{msg}</p></main>;
  if (!d) return <main className="max-w-xl mx-auto px-5 pt-12"><p className="text-haze">Loading…</p></main>;

  return (
    <main className="max-w-3xl mx-auto px-5 pt-10 pb-24">
      <a href="/admin" className="text-sm text-haze underline">Back to dashboard</a>
      <h1 className="font-display font-extrabold text-3xl mt-3">Growth</h1>

      <section className="mt-8 rounded-2xl border border-line p-5">
        <h2 className="font-display font-bold text-xl">Site notice</h2>
        <p className="text-haze text-sm mt-1">One short line shown across the top of every public page. Leave it empty for no notice.</p>
        <label htmlFor="st-text" className="mt-4">Message <span className="text-haze font-normal">({text.length}/{d.maxLen})</span></label>
        <input id="st-text" value={text} maxLength={d.maxLen} onChange={(e) => setText(e.target.value)} placeholder="e.g. Deliveries are a little slow today. Your payment is safe." />
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 font-normal"><input type="radio" name="lvl" checked={level === "info"} onChange={() => setLevel("info")} /> Information</label>
          <label className="flex items-center gap-2 font-normal"><input type="radio" name="lvl" checked={level === "warn"} onChange={() => setLevel("warn")} /> Heads-up (amber)</label>
        </div>
        <div className="mt-4 flex gap-2">
          <button type="button" onClick={() => save(false)} className="h-11 px-5 rounded-xl bg-cta text-oncta font-display font-bold">Show notice</button>
          <button type="button" onClick={() => save(true)} className="h-11 px-5 rounded-xl border border-paper/25 font-semibold">Clear notice</button>
        </div>
        {note && <p className="text-sm mt-3" role="status">{note}</p>}
      </section>

      <section className="mt-6 rounded-2xl border border-line p-5">
        <h2 className="font-display font-bold text-xl">Top-up reminders</h2>
        {!d.reminders.tableReady ? <p className="text-bad text-sm mt-2">Run migration 0022_growth.sql in Supabase first.</p> : (
          <p className="text-haze mt-2">Last 30 days: <b className="text-paper">{d.reminders.sent_30d}</b> sent, <b className="text-paper">{d.reminders.came_back}</b> paid again afterwards, <b className="text-paper">{d.reminders.opted_out}</b> people have asked to stop.</p>
        )}
      </section>

      <section className="mt-6 rounded-2xl border border-line p-5">
        <h2 className="font-display font-bold text-xl">Referrals</h2>
        {!d.referrals.enabled && <p className="text-haze text-sm mt-2">Switched off. Set NEXT_PUBLIC_REFERRALS_ENABLED=1 in Vercel and redeploy to turn it on.</p>}
        {!d.referrals.tableReady ? <p className="text-bad text-sm mt-2">Run migration 0022_growth.sql in Supabase first.</p> : (
          <>
            <p className="text-haze mt-2"><b className="text-paper">{d.referrals.count}</b> invited friends so far. Service fees waived in total: <b className="text-paper">₦{Math.round(d.referrals.fees_waived_ngn).toLocaleString("en-NG")}</b>.</p>
            {d.referrals.recent.length > 0 && (
              <ul className="mt-3 text-sm divide-y divide-line">
                {d.referrals.recent.map((r) => (
                  <li key={r.id} className="py-2 flex flex-wrap justify-between gap-2"><span>{r.referrer_email} invited {r.referee_email}</span><span className="text-haze">{new Date(r.created_at).toLocaleDateString("en-GB")}</span></li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>
    </main>
  );
}
