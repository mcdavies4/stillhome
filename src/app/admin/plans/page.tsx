"use client";

import { useEffect, useState } from "react";

type Attention = { id: string; email: string; biller_name: string; identifier: string; amount_ngn: number; status: string; failures: number; next_run_on: string | null; updated_at: string; lastEvent: string | null };
type Event = { plan_id: string | null; order_id: string | null; outcome: string; note: string | null; created_at: string };
type Data = { byStatus: Record<string, number>; needsAttention: Attention[]; recentEvents: Event[] };

const LABEL: Record<string, string> = { needs_action: "Action needed", paused: "Paused (failed charges)", on_hold: "Paused by customer", declined: "Declined", pending: "Pending first payment" };
const naira = (n: number) => `₦${Math.round(n).toLocaleString("en-NG")}`;
const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Lagos" });

// Founder-only. Uses the admin password already stored by /admin in this tab.
export default function AdminPlans() {
  const [data, setData] = useState<Data | null>(null);
  const [state, setState] = useState<"load" | "noauth" | "error">("load");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    let pass: string | null = null;
    try { pass = sessionStorage.getItem("nolgic-admin"); } catch {}
    if (!pass) { setState("noauth"); return; }
    fetch("/api/admin/recurring", { headers: { Authorization: `Bearer ${pass}` }, cache: "no-store" })
      .then(async (r) => { const d = await r.json(); if (!r.ok) { setMsg(d.error ?? "Failed"); setState("error"); return; } setData(d); })
      .catch(() => { setMsg("Request failed"); setState("error"); });
  }, []);

  const counts = data ? Object.entries(data.byStatus).sort((a, b) => b[1] - a[1]) : [];

  return (
    <main id="content" className="max-w-5xl mx-auto px-5 pt-10 pb-24">
      <h1 className="font-display font-bold text-2xl">Monthly plans</h1>
      {state === "noauth" && <p className="mt-4 text-haze">Sign in at <a className="underline underline-offset-4" href="/admin">/admin</a> first, then open this page again in the same tab.</p>}
      {state === "error" && <p role="alert" className="mt-4 text-bad">{msg}</p>}
      {state === "load" && <p className="mt-4 text-haze">Loading…</p>}
      {data && (
        <>
          <div className="mt-5 grid grid-cols-2 sm:grid-cols-4 gap-3">
            {counts.length === 0 && <p className="text-haze col-span-full">No plans yet.</p>}
            {counts.map(([k, v]) => (
              <div key={k} className="rounded-2xl border border-line bg-panel p-4">
                <div className="text-sm text-haze">{LABEL[k] ?? k}</div>
                <div className="font-display font-bold text-2xl mt-1">{v}</div>
              </div>
            ))}
          </div>

          <h2 className="font-display font-bold text-lg mt-8">Needs attention</h2>
          <div className="mt-2 overflow-x-auto rounded-2xl border border-line">
            <table className="w-full text-sm min-w-[720px]">
              <thead className="bg-sunk text-left"><tr><th className="p-3">Customer</th><th className="p-3">Bill</th><th className="p-3">Status</th><th className="p-3">Failures</th><th className="p-3">Next charge</th><th className="p-3">Latest event</th></tr></thead>
              <tbody>
                {data.needsAttention.map((p) => (
                  <tr key={p.id} className="border-t border-line align-top">
                    <td className="p-3 break-all">{p.email}</td>
                    <td className="p-3">{p.biller_name} <div className="text-haze">{p.identifier} · {naira(p.amount_ngn)}</div></td>
                    <td className="p-3 whitespace-nowrap">{LABEL[p.status] ?? p.status}</td>
                    <td className="p-3">{p.failures}</td>
                    <td className="p-3 whitespace-nowrap">{p.next_run_on ?? "—"}</td>
                    <td className="p-3">{p.lastEvent ?? <span className="text-haze">None</span>}</td>
                  </tr>
                ))}
                {!data.needsAttention.length && <tr><td className="p-4 text-haze" colSpan={6}>Nothing needs you right now.</td></tr>}
              </tbody>
            </table>
          </div>

          <h2 className="font-display font-bold text-lg mt-8">Recent events</h2>
          <ul className="mt-2 grid gap-1.5">
            {data.recentEvents.slice(0, 50).map((e, i) => (
              <li key={i} className="flex flex-wrap justify-between gap-2 rounded-xl border border-line px-4 py-2.5 text-sm">
                <span><b>{e.outcome}</b>{e.note ? <span className="text-haze"> · {e.note}</span> : null}</span>
                <span className="text-haze whitespace-nowrap">{when(e.created_at)}</span>
              </li>
            ))}
            {!data.recentEvents.length && <li className="text-haze">No events yet.</li>}
          </ul>
        </>
      )}
    </main>
  );
}
