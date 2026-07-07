"use client";

import { useEffect, useState } from "react";

type Win = { orders: number; revenue_gbp: number; delivered_ngn: number };
type Stats = {
  today: Win; week: Win; month: Win;
  statusCounts: Record<string, number>;
  monthly: { month: string; orders: number; revenue_gbp: number; delivered_ngn: number }[];
  topCustomers: { email: string; orders: number; total_gbp: number }[];
  problems: { id: string; email: string; biller_name: string; amount_ngn: number; status: string; error: string | null; created_at: string }[];
};

const gbp = (n: number) => `£${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const ngn = (n: number) => `₦${Number(n).toLocaleString("en-NG")}`;

export default function Admin() {
  const [pass, setPass] = useState("");
  const [authed, setAuthed] = useState<string | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [acqRate, setAcqRate] = useState("1830"); // your true GBP->NGN acquisition rate

  useEffect(() => {
    const saved = sessionStorage.getItem("nolgic-admin");
    if (saved) { setAuthed(saved); }
  }, []);

  useEffect(() => {
    if (!authed) return;
    fetch("/api/admin", { headers: { Authorization: `Bearer ${authed}` } })
      .then(async (r) => {
        if (r.status === 401) throw new Error("Wrong password");
        if (!r.ok) throw new Error("Failed to load");
        return r.json();
      })
      .then(setStats)
      .catch((e) => { setErr(e.message); setAuthed(null); sessionStorage.removeItem("nolgic-admin"); });
  }, [authed]);

  function login() {
    setErr(null);
    sessionStorage.setItem("nolgic-admin", pass);
    setAuthed(pass);
  }

  if (!authed || !stats) {
    return (
      <main className="max-w-sm mx-auto px-5 pt-24">
        <h1 className="font-display font-extrabold text-2xl mb-6">Nolgic Admin</h1>
        <label>Password</label>
        <input type="password" value={pass} onChange={(e) => setPass(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && login()} />
        <button onClick={login}
          className="mt-4 w-full py-3 rounded-xl bg-tungsten text-white dark:text-night font-display font-bold">
          {authed && !stats && !err ? "Loading…" : "Enter"}
        </button>
        {err && <p className="text-bad text-sm mt-3">{err}</p>}
      </main>
    );
  }

  // Margin estimate: revenue minus naira cost at YOUR acquisition rate, minus Stripe ~1.5% + 20p/order
  const rate = Number(acqRate) || 1830;
  const marginFor = (w: Win) => {
    const nairaCost = w.delivered_ngn / rate;
    const stripeFees = w.revenue_gbp * 0.015 + w.orders * 0.2;
    return w.revenue_gbp - nairaCost - stripeFees;
  };

  const cards: { label: string; w: Win }[] = [
    { label: "TODAY", w: stats.today },
    { label: "7 DAYS", w: stats.week },
    { label: "30 DAYS", w: stats.month },
  ];

  return (
    <main className="max-w-3xl mx-auto px-5 pt-10 pb-24">
      <div className="flex items-center justify-between mb-8">
        <h1 className="font-display font-extrabold text-2xl">Dashboard</h1>
        <div className="flex items-center gap-2">
          <label className="!mb-0 !inline">Acq. rate ₦/£</label>
          <input value={acqRate} onChange={(e) => setAcqRate(e.target.value.replace(/[^\d.]/g, ""))}
            className="!w-24 text-center" inputMode="decimal" />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-8">
        {cards.map(({ label, w }) => (
          <div key={label} className="bg-panel border border-line rounded-2xl p-4">
            <p className="font-mono text-[10px] text-tungsten tracking-[0.25em] mb-2">{label}</p>
            <p className="font-display font-extrabold text-2xl">{gbp(w.revenue_gbp)}</p>
            <p className="text-haze text-sm mt-1">{w.orders} orders · {ngn(w.delivered_ngn)}</p>
            <p className={`text-sm mt-1 font-mono ${marginFor(w) >= 0 ? "text-ok" : "text-bad"}`}>
              margin ≈ {gbp(marginFor(w))}
            </p>
          </div>
        ))}
      </div>

      <section className="mb-8">
        <p className="font-mono text-xs text-haze uppercase tracking-[0.3em] mb-3">Order status</p>
        <div className="flex flex-wrap gap-2">
          {Object.entries(stats.statusCounts).map(([s, n]) => (
            <span key={s} className={`px-3 py-1.5 rounded-full text-xs font-mono border ${
              s === "refund_failed" ? "border-bad text-bad" :
              s === "fulfilled" ? "border-ok/50 text-ok" : "border-line text-haze"}`}>
              {s}: {n}
            </span>
          ))}
        </div>
      </section>

      <section className="mb-8">
        <p className="font-mono text-xs text-haze uppercase tracking-[0.3em] mb-3">Monthly</p>
        <div className="bg-panel border border-line rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-haze font-mono text-xs uppercase">
                <th className="p-3">Month</th><th className="p-3">Orders</th>
                <th className="p-3">Revenue</th><th className="p-3">Margin ≈</th>
              </tr>
            </thead>
            <tbody>
              {stats.monthly.map((m) => (
                <tr key={m.month} className="border-t border-line">
                  <td className="p-3 font-mono">{m.month}</td>
                  <td className="p-3">{m.orders}</td>
                  <td className="p-3">{gbp(m.revenue_gbp)}</td>
                  <td className="p-3 font-mono">{gbp(marginFor({ orders: m.orders, revenue_gbp: m.revenue_gbp, delivered_ngn: m.delivered_ngn }))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mb-8">
        <p className="font-mono text-xs text-haze uppercase tracking-[0.3em] mb-3">Top customers</p>
        <div className="bg-panel border border-line rounded-2xl p-4 space-y-2">
          {stats.topCustomers.length === 0 && <p className="text-haze text-sm">No fulfilled orders yet.</p>}
          {stats.topCustomers.map((c) => (
            <div key={c.email} className="flex justify-between text-sm gap-4">
              <span className="truncate">{c.email}</span>
              <span className="font-mono whitespace-nowrap">{c.orders} · {gbp(c.total_gbp)}</span>
            </div>
          ))}
        </div>
      </section>

      <section>
        <p className="font-mono text-xs text-haze uppercase tracking-[0.3em] mb-3">Failed / needs attention</p>
        <div className="space-y-2">
          {stats.problems.length === 0 && <p className="text-haze text-sm">Nothing 🎉</p>}
          {stats.problems.map((p) => (
            <div key={p.id} className={`bg-panel border rounded-2xl p-4 text-sm ${p.status === "refund_failed" ? "border-bad" : "border-line"}`}>
              <div className="flex justify-between gap-3 font-mono text-xs mb-1">
                <span className={p.status === "refund_failed" ? "text-bad" : "text-haze"}>{p.status}</span>
                <span className="text-haze">{p.created_at.slice(0, 16).replace("T", " ")}</span>
              </div>
              <p>{p.biller_name} — {ngn(p.amount_ngn)} · {p.email}</p>
              {p.error && <p className="text-haze mt-1 break-words">{p.error}</p>}
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
