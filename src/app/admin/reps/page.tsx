"use client";

import { useCallback, useEffect, useState } from "react";

type Row = {
  code: string; name: string; active: boolean; note: string | null; link: string; tgLink?: string | null;
  visits: number; lookups: number; checkoutClicks: number;
  orders: number; delivered: number; customers: number; newCustomers: number; deliveredNgn: number;
  recent: { id: string; email: string; status: string; amount_ngn: number; created_at: string; isNew: boolean }[];
};
type Data = { days: number; reps: Row[]; tableReady: boolean };

const naira = (n: number) => `₦${Math.round(n).toLocaleString("en-NG")}`;

// Founder-only. Uses the admin password already stored by /admin in this tab.
export default function AdminReps() {
  const [d, setD] = useState<Data | null>(null);
  const [state, setState] = useState<"load" | "noauth" | "error">("load");
  const [msg, setMsg] = useState("");
  const [days, setDays] = useState(30);
  const [open, setOpen] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [f, setF] = useState({ code: "", name: "", note: "" });
  const pass = () => { try { return sessionStorage.getItem("nolgic-admin"); } catch { return null; } };

  const load = useCallback(async () => {
    const p = pass(); if (!p) { setState("noauth"); return; }
    try {
      const r = await fetch(`/api/admin/reps?days=${days}`, { headers: { Authorization: `Bearer ${p}` }, cache: "no-store" });
      const j = await r.json();
      if (!r.ok) { setMsg(j.error ?? "Failed"); setState("error"); return; }
      setD(j);
    } catch { setMsg("Request failed"); setState("error"); }
  }, [days]);
  useEffect(() => { load(); }, [load]);

  async function save(body: Record<string, unknown>, okMsg: string) {
    const p = pass(); if (!p) return;
    setNote("");
    const r = await fetch("/api/admin/reps", { method: "POST", headers: { Authorization: `Bearer ${p}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json();
    if (!r.ok) { setNote(`${j.error ?? "Failed"}${j.hint ? ` ${j.hint}` : ""}`); return; }
    setNote(okMsg); load();
  }
  const copy = async (t: string) => { try { await navigator.clipboard.writeText(t); setNote("Link copied."); } catch { setNote(t); } };

  if (state === "noauth") return <main className="max-w-xl mx-auto px-5 pt-12"><p>Sign in at <a className="underline" href="/admin">/admin</a> first, then come back.</p></main>;
  if (state === "error") return <main className="max-w-xl mx-auto px-5 pt-12"><p className="text-bad">{msg}</p></main>;
  if (!d) return <main className="max-w-xl mx-auto px-5 pt-12"><p className="text-haze">Loading…</p></main>;

  const total = d.reps.reduce((a, r) => ({ orders: a.orders + r.orders, delivered: a.delivered + r.delivered, newC: a.newC + r.newCustomers, ngn: a.ngn + r.deliveredNgn }), { orders: 0, delivered: 0, newC: 0, ngn: 0 });

  return (
    <main className="max-w-3xl mx-auto px-5 pt-10 pb-24">
      <a href="/admin" className="text-sm text-haze underline">Back to dashboard</a>
      <h1 className="font-display font-extrabold text-3xl mt-3">Sales reps</h1>
      <p className="text-haze mt-2">Each rep gets their own link. Every order that link brings in is tagged to them. The first rep link a customer opens is the one counted, for 30 days. This is for seeing what works; nothing is owed from here.</p>

      {!d.tableReady && <p className="text-bad mt-4">Run supabase/migrations/0026_reps.sql in Supabase first.</p>}

      <div className="mt-6 flex flex-wrap items-center gap-2" role="group" aria-label="Period">
        {[7, 30, 90].map((n) => (
          <button key={n} type="button" onClick={() => setDays(n)} aria-pressed={days === n}
            className={`h-10 px-4 rounded-xl border font-semibold ${days === n ? "bg-cta text-oncta border-cta" : "border-line"}`}>Last {n} days</button>
        ))}
      </div>

      {d.reps.length > 0 && (
        <p className="mt-4 text-haze">All reps, last {d.days} days: <b className="text-paper">{total.orders}</b> orders, <b className="text-paper">{total.delivered}</b> delivered, <b className="text-paper">{total.newC}</b> new customers, <b className="text-paper">{naira(total.ngn)}</b> delivered.</p>
      )}

      {d.reps.map((r) => (
        <section key={r.code} className={`mt-5 rounded-2xl border border-line p-5 ${r.active ? "" : "opacity-60"}`}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-display font-bold text-xl">{r.name} <span className="text-haze font-normal text-base">({r.code})</span></h2>
              {!r.active && <p className="text-sm text-bad mt-1">Switched off. Their link no longer tags new orders.</p>}
              {r.note && <p className="text-sm text-haze mt-1">{r.note}</p>}
            </div>
            <div className="text-right">
              <p className="text-sm text-haze">New customers</p>
              <p className="font-display font-extrabold text-2xl">{r.newCustomers}</p>
              <p className="text-xs text-haze">{naira(r.deliveredNgn)} delivered</p>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <code className="text-sm px-3 py-2 rounded-lg bg-sunk break-all">{r.link}</code>
            <button type="button" onClick={() => copy(r.link)} className="h-10 px-4 rounded-xl border border-line font-semibold">Copy link</button>
          </div>
          {r.tgLink && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <code className="text-sm px-3 py-2 rounded-lg bg-sunk break-all">{r.tgLink}</code>
              <button type="button" onClick={() => copy(r.tgLink!)} className="h-10 px-4 rounded-xl border border-line font-semibold">Copy Telegram link</button>
            </div>
          )}

          <dl className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            {[["Visits", r.visits], ["Meter / number checks", r.lookups], ["Clicked pay", r.checkoutClicks], ["Orders", r.orders], ["Delivered", r.delivered], ["Customers", r.customers], ["New customers", r.newCustomers], ["Delivered value", naira(r.deliveredNgn)]].map(([k, v]) => (
              <div key={String(k)} className="rounded-xl bg-sunk p-3"><dt className="text-haze">{k}</dt><dd className="font-display font-bold text-lg">{typeof v === "number" ? v.toLocaleString("en-NG") : v}</dd></div>
            ))}
          </dl>
          <p className="text-xs text-haze mt-2">Visits are anonymous daily counts (no cookies), so treat them as a guide. Orders and money are exact.</p>

          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={() => setOpen(open === r.code ? null : r.code)} className="h-10 px-4 rounded-xl border border-line font-semibold">{open === r.code ? "Hide orders" : `Show latest orders (${r.recent.length})`}</button>
            <button type="button" onClick={() => save({ code: r.code, active: !r.active }, r.active ? "Switched off." : "Switched on.")} className="h-10 px-4 rounded-xl border border-line font-semibold">{r.active ? "Switch off" : "Switch on"}</button>
          </div>
          {open === r.code && (
            <ul className="mt-3 text-sm divide-y divide-line">
              {r.recent.length === 0 && <li className="py-2 text-haze">No orders yet in this period.</li>}
              {r.recent.map((o) => (
                <li key={o.id} className="py-2 flex flex-wrap justify-between gap-2">
                  <span>{o.email} {o.isNew && <span className="text-xs font-semibold text-ok">new customer</span>}</span>
                  <span className="text-haze">{naira(o.amount_ngn)} · {o.status} · {new Date(o.created_at).toLocaleDateString("en-GB")}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}

      <section className="mt-8 rounded-2xl border border-line p-5">
        <h2 className="font-display font-bold text-xl">Add or change a rep</h2>
        <p className="text-haze text-sm mt-1">Use the same code again to change a rep's name or note, or switch their link off.</p>
        <div className="mt-4 grid sm:grid-cols-2 gap-3">
          <div><label htmlFor="rp-code">Code (their link name)</label><input id="rp-code" value={f.code} maxLength={20} onChange={(e) => setF({ ...f, code: e.target.value.toLowerCase().replace(/[^a-z0-9]/g, "") })} placeholder="e.g. chika" /></div>
          <div><label htmlFor="rp-name">Name</label><input id="rp-name" value={f.name} maxLength={60} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Chika (Fiverr)" /></div>
          <div><label htmlFor="rp-note">Note (optional)</label><input id="rp-note" value={f.note} maxLength={200} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="e.g. Instagram and WhatsApp" /></div>
        </div>
        <button type="button" onClick={() => save({ code: f.code, name: f.name, note: f.note }, "Saved.")} className="mt-4 h-11 px-5 rounded-xl bg-cta text-oncta font-display font-bold">Save rep</button>
        {note && <p className="text-sm mt-3" role="status">{note}</p>}
      </section>
    </main>
  );
}
