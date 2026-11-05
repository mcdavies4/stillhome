"use client";

import { useCallback, useEffect, useState } from "react";
import { tagLink } from "@/lib/analytics-shared";

type Row<T> = T[];
type Data = {
  tableReady: boolean; hint?: string; capped?: boolean; generated_at: string; days: 1 | 7 | 30;
  totals: { views: number; visitors: number; pagesPerVisit: number; online: number; lookups: number; checkouts: number; paid: number; conversion: number | null };
  byDay: Row<{ day: string; views: number; visitors: number; orders: number }>;
  pages: Row<{ path: string; views: number; visitors: number }>;
  sources: Row<{ src: string; visitors: number; lookups: number; checkouts: number }>;
  campaigns: Row<{ campaign: string; visitors: number; lookups: number; checkouts: number }>;
  countries: Row<{ country: string; visitors: number }>;
  devices: Row<{ device: string; visitors: number }>;
  browsers: Row<{ browser: string; visitors: number }>;
  events: Row<{ name: string; detail: string | null; count: number }>;
  funnel: Row<{ step: string; n: number; pct: number | null }>;
};

const PAGE_NAMES: Record<string, string> = { "/": "Home", "/find-order": "Find my order", "/legal": "Terms, refunds & privacy", "/bulk": "Bulk airtime", "/exams": "Exam PINs", "/ask": "Ask someone to pay", "/order/:id": "Order page", "/r/:id": "Ask-to-pay link", "/bulk/:id": "Bulk order page", "/exams/:id": "Exam PIN order page", "/feedback/:id": "Feedback page", "/reminders/:id": "Reminder page" };
const EVENT_NAMES: Record<string, string> = { tab: "Picked a service", lookup_ok: "Looked up an account", checkout_click: "Tapped pay", play_click: "Tapped Google Play", share_click: "Tapped share on WhatsApp", support_open: "Opened the support chat", find_order: "Searched for an order", ask_created: "Made an ask-to-pay link" };
const SOURCES = ["whatsapp", "instagram", "facebook", "x", "tiktok", "linkedin", "telegram", "youtube", "email", "sms", "other"];
const REGION = typeof Intl !== "undefined" ? new Intl.DisplayNames(["en"], { type: "region" }) : null;
const country = (c: string) => { try { return REGION?.of(c) ?? c; } catch { return c; } };
const n = (x: number) => x.toLocaleString("en-GB");

function Card({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-2xl border border-line bg-panel p-4">
      <div className="text-sm text-haze">{label}</div>
      <div className="font-display font-extrabold text-3xl mt-1">{value}</div>
      {sub ? <div className="text-xs text-haze mt-1">{sub}</div> : null}
    </div>
  );
}

function Table({ title, head, rows, empty = "Nothing yet." }: { title: string; head: string[]; rows: (string | number)[][]; empty?: string }) {
  return (
    <section className="rounded-2xl border border-line p-4 overflow-x-auto">
      <h2 className="font-display font-bold text-lg">{title}</h2>
      {rows.length === 0 ? <p className="text-haze text-sm mt-2">{empty}</p> : (
        <table className="w-full text-sm mt-2">
          <thead><tr className="text-haze text-left">{head.map((h, i) => <th key={h} className={`font-normal pb-1 ${i ? "text-right pl-3" : ""}`}>{h}</th>)}</tr></thead>
          <tbody>{rows.map((r, i) => <tr key={i} className="border-t border-line">{r.map((c, j) => <td key={j} className={`py-1.5 ${j ? "text-right pl-3 tabular-nums" : "break-words pr-2"}`}>{c}</td>)}</tr>)}</tbody>
        </table>
      )}
    </section>
  );
}

export default function AdminAnalytics() {
  const [d, setD] = useState<Data | null>(null);
  const [days, setDays] = useState<1 | 7 | 30>(7);
  const [state, setState] = useState<"load" | "noauth" | "error">("load");
  const [msg, setMsg] = useState("");
  const [src, setSrc] = useState("whatsapp");
  const [custom, setCustom] = useState("");
  const [camp, setCamp] = useState("launch");
  const [copied, setCopied] = useState(false);
  const [off, setOff] = useState(false);
  const pass = () => { try { return sessionStorage.getItem("nolgic-admin"); } catch { return null; } };

  const load = useCallback(async () => {
    const p = pass(); if (!p) { setState("noauth"); return; }
    try {
      const r = await fetch(`/api/admin/analytics?days=${days}`, { headers: { Authorization: `Bearer ${p}` }, cache: "no-store" });
      const j = await r.json();
      if (!r.ok) { setMsg(j.error ?? "Failed"); setState("error"); return; }
      setD(j); setState("load");
    } catch { setMsg("Request failed"); setState("error"); }
  }, [days]);

  useEffect(() => { load(); const t = setInterval(() => { if (document.visibilityState === "visible") load(); }, 30000); return () => clearInterval(t); }, [load]);
  useEffect(() => { try { setOff(localStorage.getItem("nolgic-notrack") === "1"); } catch {} }, []);

  function toggleOff() {
    const next = !off; setOff(next);
    try { next ? localStorage.setItem("nolgic-notrack", "1") : localStorage.removeItem("nolgic-notrack"); } catch {}
  }

  const origin = typeof location !== "undefined" ? location.origin : "https://nolgic.com";
  const link = tagLink(origin + "/", src === "other" ? custom || "other" : src, camp);
  async function copy() { try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch {} }

  if (state === "noauth") return <main className="max-w-xl mx-auto px-5 pt-12"><p>Sign in at <a className="underline" href="/admin">/admin</a> first, then come back.</p></main>;
  if (state === "error") return <main className="max-w-xl mx-auto px-5 pt-12"><p className="text-bad">{msg}</p></main>;
  if (!d) return <main className="max-w-xl mx-auto px-5 pt-12"><p className="text-haze">Loading…</p></main>;

  const max = Math.max(1, ...d.byDay.map((x) => x.visitors));
  const top = d.funnel[0]?.n || 0;
  const empty = d.tableReady && d.totals.views === 0;

  return (
    <main className="max-w-5xl mx-auto px-4 sm:px-5 pt-8 pb-24">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display font-extrabold text-3xl">Visitors</h1>
          <p className="text-sm text-haze mt-1">Who comes to Nolgic and what they do. No cookies, nothing that identifies anyone. Days run on Nigerian time.</p>
        </div>
        <div role="group" aria-label="Time range" className="flex gap-2">
          {([[1, "Today"], [7, "7 days"], [30, "30 days"]] as [1 | 7 | 30, string][]).map(([v, l]) => (
            <button key={v} type="button" onClick={() => setDays(v)} aria-pressed={days === v}
              className={`h-10 px-4 rounded-xl border text-sm font-semibold ${days === v ? "bg-cta text-oncta border-cta" : "border-line text-paper hover:bg-sunk"}`}>{l}</button>
          ))}
        </div>
      </div>

      {!d.tableReady ? (
        <div className="mt-6 rounded-2xl border border-line bg-panel p-5"><p className="font-semibold">Visit counting isn&apos;t set up yet.</p><p className="text-haze mt-1">{d.hint}</p></div>
      ) : (
        <>
          {empty ? <p className="mt-6 rounded-2xl border border-line bg-panel p-4 text-haze">No visits counted yet in this period. They show up here within a few seconds of someone opening the site. Your own visits are counted too unless you switch that off at the bottom of this page.</p> : null}
          <div className="mt-6 grid grid-cols-2 md:grid-cols-4 gap-3">
            <Card label="Visitors" value={n(d.totals.visitors)} sub="Different people per day, added up" />
            <Card label="Page views" value={n(d.totals.views)} sub={d.totals.pagesPerVisit ? `${d.totals.pagesPerVisit} pages per visit` : undefined} />
            <Card label="Online now" value={n(d.totals.online)} sub="Active in the last 5 minutes" />
            <Card label="Paid orders" value={n(d.totals.paid)} sub={d.totals.conversion != null ? `${d.totals.conversion}% of visitors` : undefined} />
          </div>

          <section className="mt-6 rounded-2xl border border-line p-4">
            <h2 className="font-display font-bold text-lg">Visitors per day</h2>
            <div className="mt-4 flex items-end gap-1.5 h-40" role="img" aria-label={"Visitors per day: " + d.byDay.map((x) => `${x.day} ${x.visitors}`).join(", ")}>
              {d.byDay.map((x) => (
                <div key={x.day} className="flex-1 min-w-0 flex flex-col items-center justify-end h-full" title={`${x.day}: ${x.visitors} visitors, ${x.views} views, ${x.orders} paid orders`}>
                  <span className="text-[10px] text-haze tabular-nums">{x.visitors || ""}</span>
                  <div className="w-full rounded-t bg-cta" style={{ height: `${Math.max(x.visitors ? 4 : 1, (x.visitors / max) * 100)}%`, opacity: x.visitors ? 1 : 0.25 }} />
                </div>
              ))}
            </div>
            <div className="mt-1 flex gap-1.5">{d.byDay.map((x) => <span key={x.day} className="flex-1 min-w-0 text-center text-[10px] text-haze">{x.day.slice(8)}</span>)}</div>
          </section>

          <section className="mt-6 rounded-2xl border border-line p-4">
            <h2 className="font-display font-bold text-lg">From visit to paid order</h2>
            <p className="text-sm text-haze mt-1">Each step counts different people. &ldquo;Paid orders&rdquo; counts every paid order in the period, including people who came back directly.</p>
            <ul className="mt-3 space-y-3">
              {d.funnel.map((f) => (
                <li key={f.step}>
                  <div className="flex justify-between text-sm"><span>{f.step}</span><span className="tabular-nums">{n(f.n)}{f.pct != null ? <span className="text-haze"> · {f.pct}%</span> : null}</span></div>
                  <div className="mt-1 h-2.5 rounded-full bg-sunk overflow-hidden"><div className="h-full bg-cta" style={{ width: `${top ? Math.min(100, (f.n / top) * 100) : 0}%` }} /></div>
                </li>
              ))}
            </ul>
          </section>

          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <Table title="Where visitors come from" head={["Source", "Visitors", "Looked up", "Tapped pay"]} rows={d.sources.map((s) => [s.src, n(s.visitors), n(s.lookups), n(s.checkouts)])} empty="Nothing yet. Use the link builder below so your posts show up here." />
            <Table title="Campaigns" head={["Campaign", "Visitors", "Looked up", "Tapped pay"]} rows={d.campaigns.map((s) => [s.campaign, n(s.visitors), n(s.lookups), n(s.checkouts)])} empty="Add a campaign name in the link builder to see it here." />
            <Table title="Top pages" head={["Page", "Views", "Visitors"]} rows={d.pages.map((p) => [PAGE_NAMES[p.path] ?? p.path, n(p.views), n(p.visitors)])} />
            <Table title="What people do" head={["Action", "Times"]} rows={d.events.map((e) => [(EVENT_NAMES[e.name] ?? e.name) + (e.detail ? ` (${e.detail})` : ""), n(e.count)])} />
            <Table title="Countries" head={["Country", "Visitors"]} rows={d.countries.map((c) => [country(c.country), n(c.visitors)])} />
            <Table title="Devices and browsers" head={["", "Visitors"]} rows={[...d.devices.map((x) => [x.device, n(x.visitors)] as (string | number)[]), ...d.browsers.map((x) => [x.browser, n(x.visitors)] as (string | number)[])]} />
          </div>
          {d.capped ? <p className="mt-4 text-sm text-haze">Very busy period: only the most recent 150,000 events are included.</p> : null}
        </>
      )}

      <section className="mt-8 rounded-2xl border border-line p-4">
        <h2 className="font-display font-bold text-lg">Link builder</h2>
        <p className="text-sm text-haze mt-1">Use a tagged link when you post, so this page can tell you which post brought people. Without a tag, most social apps show up as &ldquo;direct&rdquo;.</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div><label htmlFor="lb-src">Where are you posting it?</label>
            <select id="lb-src" value={src} onChange={(e) => setSrc(e.target.value)}>{SOURCES.map((s) => <option key={s} value={s}>{s === "x" ? "X (Twitter)" : s[0].toUpperCase() + s.slice(1)}</option>)}</select>
            {src === "other" ? <input aria-label="Source name" className="mt-2" value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="e.g. church-group" maxLength={30} /> : null}
          </div>
          <div><label htmlFor="lb-camp">Campaign name</label><input id="lb-camp" value={camp} onChange={(e) => setCamp(e.target.value)} maxLength={40} placeholder="e.g. launch" /></div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <code className="flex-1 min-w-0 break-all rounded-xl bg-sunk px-3 py-2.5 text-sm">{link}</code>
          <button type="button" onClick={copy} className="h-11 px-5 rounded-xl bg-cta text-oncta font-semibold">{copied ? "Copied" : "Copy link"}</button>
        </div>
      </section>

      <section className="mt-4 rounded-2xl border border-line p-4">
        <h2 className="font-display font-bold text-lg">Your own visits</h2>
        <label className="mt-2 flex items-center gap-3 font-normal"><input type="checkbox" checked={off} onChange={toggleOff} style={{ width: 22, height: 22, flex: "none" }} /> Don&apos;t count visits from this browser</label>
        <p className="text-sm text-haze mt-1">Tick this on your own phone and laptop so testing doesn&apos;t inflate the numbers. The admin pages are never counted.</p>
      </section>
      <p className="mt-6 text-xs text-haze">Updated {new Date(d.generated_at).toLocaleTimeString("en-GB")}. Refreshes every 30 seconds.</p>
    </main>
  );
}
