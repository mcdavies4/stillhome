"use client";

import { useEffect, useState } from "react";

type Item = { order_id: string; email: string; sent_at: string; item: string; amount: number; reason: string | null; reason_label: string; note: string | null; came_back: boolean };
type Data = { summary: { sent: number; answered: number; came_back: number; opted_out: number; reasons: { reason: string; n: number }[] }; items: Item[] };

// Founder-only. Uses the admin password already stored by /admin in this tab.
export default function AdminFeedback() {
  const [data, setData] = useState<Data | null>(null);
  const [state, setState] = useState<"load" | "noauth" | "error">("load");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    let pass: string | null = null;
    try { pass = sessionStorage.getItem("nolgic-admin"); } catch {}
    if (!pass) { setState("noauth"); return; }
    fetch("/api/admin/followups", { headers: { Authorization: `Bearer ${pass}` } })
      .then(async (r) => { const d = await r.json(); if (!r.ok) { setMsg(`${d.error ?? "Failed"}${d.hint ? ` — ${d.hint}` : ""}`); setState("error"); return; } setData(d); })
      .catch(() => { setMsg("Request failed"); setState("error"); });
  }, []);

  const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const naira = (n: number) => `₦${Math.round(n).toLocaleString("en-NG")}`;

  return (
    <main id="content" className="max-w-5xl mx-auto px-5 pt-10 pb-24">
      <h1 className="font-display font-bold text-2xl">Abandoned orders: what people told us</h1>
      {state === "noauth" && <p className="mt-4 text-haze">Sign in at <a className="underline underline-offset-4" href="/admin">/admin</a> first, then open this page again in the same tab.</p>}
      {state === "error" && <p role="alert" className="mt-4 text-bad">{msg}</p>}
      {state === "load" && <p className="mt-4 text-haze">Loading…</p>}
      {data && (
        <>
          <div className="mt-5 grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[["Emails sent", data.summary.sent], ["Answered", data.summary.answered], ["Came back and paid", data.summary.came_back], ["Opted out", data.summary.opted_out]].map(([k, v]) => (
              <div key={String(k)} className="rounded-2xl border border-line bg-panel p-4"><div className="text-sm text-haze">{k}</div><div className="font-display font-bold text-2xl mt-1">{v}</div></div>
            ))}
          </div>
          <h2 className="font-display font-bold text-lg mt-8">Why they stopped</h2>
          {data.summary.reasons.length === 0 ? <p className="mt-2 text-haze">No answers yet.</p> : (
            <ul className="mt-2 grid gap-1.5">
              {data.summary.reasons.map((r) => (
                <li key={r.reason} className="flex justify-between rounded-xl border border-line px-4 py-2.5"><span>{r.reason}</span><b>{r.n}</b></li>
              ))}
            </ul>
          )}
          <h2 className="font-display font-bold text-lg mt-8">Every follow-up (last 90 days)</h2>
          <div className="mt-2 overflow-x-auto rounded-2xl border border-line">
            <table className="w-full text-sm min-w-[640px]">
              <thead className="bg-sunk text-left"><tr><th className="p-3">Sent</th><th className="p-3">Customer</th><th className="p-3">Order</th><th className="p-3">What they said</th><th className="p-3">Paid later</th></tr></thead>
              <tbody>
                {data.items.map((i) => (
                  <tr key={i.order_id} className="border-t border-line align-top">
                    <td className="p-3 whitespace-nowrap">{when(i.sent_at)}</td>
                    <td className="p-3 break-all">{i.email}</td>
                    <td className="p-3">{i.item} <span className="text-haze">{naira(i.amount)}</span></td>
                    <td className="p-3">{i.reason ? <><b>{i.reason_label}</b>{i.note ? <div className="text-haze mt-1">“{i.note}”</div> : null}</> : <span className="text-haze">No reply yet</span>}</td>
                    <td className="p-3">{i.came_back ? "Yes" : "No"}</td>
                  </tr>
                ))}
                {!data.items.length && <tr><td className="p-4 text-haze" colSpan={5}>No follow-ups sent yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}
    </main>
  );
}
