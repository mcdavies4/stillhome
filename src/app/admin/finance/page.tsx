"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

// /admin/finance — the books. Uses the admin password already stored by /admin in this tab.

type Product = { key: string; label: string; orders: number; bill: number; fees: number; commission: number; processor: number; gross: number };
type Expense = { id: string; spent_on: string; category: string; vendor: string | null; description: string | null; amount_ngn: number | string; vat_ngn: number | string; receipt_ref: string | null };
type Settings = {
  commission: { airtime_pct: number; data_pct: number; tv_pct: number; electricity_pct: number; exam_pct: number; jamb_flat: number };
  processor: { pct: number; cap: number };
  vat: { registered: boolean; rate: number; inclusive: boolean };
  business: { name: string; trading: string; address: string; email: string; tin: string };
};
type Report = {
  period: { from: string; to: string };
  settings: Settings;
  notes: { settingsSaved: boolean; financeTablesMissing: boolean; econColumns: boolean; processorEstimated: number; processorActual: number };
  products: Product[];
  totals: { orders: number; bill: number; collected: number; fees: number; commission: number; income: number; processor: number; gross: number; expenses: number; vatOnIncome: number; vatDeducted: number; net: number; avgGrossPerOrder: number };
  daily: { day: string; orders: number; income: number; gross: number }[];
  expensesByCategory: { category: string; amount: number; vat: number }[];
  expenses: Expense[];
  customers: { unique: number; repeat: number };
  attention: { needsReview: number; refundFailed: number; stuckPaid: number };
  refunds: { count: number; bill: number };
  ledgerCount: number;
};

const CATEGORIES = ["Hosting & infrastructure", "Software & subscriptions", "Payment & bank charges", "Marketing", "Legal & accounting", "Licences & registration", "Staff & contractors", "Equipment", "Other"];
const ngn = (v: number | string) => `₦${Number(v || 0).toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const watToday = () => ymd(new Date(Date.now() + 3600_000));

function presets() {
  const t = watToday(); const [y, m] = [Number(t.slice(0, 4)), Number(t.slice(5, 7))];
  const first = (yy: number, mm: number) => `${yy}-${String(mm).padStart(2, "0")}-01`;
  const lastOf = (yy: number, mm: number) => ymd(new Date(Date.UTC(yy, mm, 0)));
  const q0 = Math.floor((m - 1) / 3) * 3 + 1;
  return {
    "This month": { from: first(y, m), to: t },
    "Last month": m === 1 ? { from: first(y - 1, 12), to: lastOf(y - 1, 12) } : { from: first(y, m - 1), to: lastOf(y, m - 1) },
    "This quarter": { from: first(y, q0), to: t },
    "Year to date": { from: first(y, 1), to: t },
  } as Record<string, { from: string; to: string }>;
}

const card = "rounded-2xl border border-line bg-panel p-4";
const input = "h-11 w-full rounded-xl border border-line bg-sunk px-3 text-sm";
const btn = "h-11 px-4 rounded-xl border border-line text-sm font-medium hover:border-tungsten disabled:opacity-40";

export default function FinancePage() {
  const [pass, setPass] = useState<string | null>(null);
  const [range, setRange] = useState(() => presets()["This month"]);
  const [label, setLabel] = useState("This month");
  const [tab, setTab] = useState<"overview" | "expenses" | "settings">("overview");
  const [r, setR] = useState<Report | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => { try { setPass(sessionStorage.getItem("nolgic-admin")); } catch {} }, []);

  const api = useCallback(async (path: string, init?: RequestInit) => {
    const res = await fetch(path, { ...init, headers: { ...(init?.headers ?? {}), Authorization: `Bearer ${pass}`, ...(init?.body ? { "Content-Type": "application/json" } : {}) } });
    return res;
  }, [pass]);

  const load = useCallback(async () => {
    if (!pass) return;
    setErr(null);
    const res = await api(`/api/admin/finance?from=${range.from}&to=${range.to}`);
    const j = await res.json().catch(() => null);
    if (!res.ok) { setErr(j?.error ?? `Error ${res.status}`); return; }
    setR(j);
  }, [api, pass, range]);
  useEffect(() => { load(); }, [load]);

  async function download(type: string, format: "pdf" | "csv") {
    setBusy(`${type}.${format}`); setMsg(null);
    try {
      const res = await api(`/api/admin/finance/export?type=${type}&format=${format}&from=${range.from}&to=${range.to}`);
      if (!res.ok) { setMsg((await res.json().catch(() => null))?.error ?? `Download failed (${res.status})`); return; }
      const blob = await res.blob();
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `nolgic-${type}-${range.from}_to_${range.to}.${format}`;
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    } finally { setBusy(null); }
  }

  async function sync() {
    setBusy("sync"); setMsg(null);
    try {
      const res = await api("/api/admin/finance/sync", { method: "POST", body: JSON.stringify(range) });
      const j = await res.json().catch(() => null);
      setMsg(res.ok ? `Done. Commission saved on ${j.commissionSet} orders, real Flutterwave fees fetched for ${j.feesFetched}.${j.remaining ? ` ${j.remaining} more to fetch: press Sync again.` : ""}` : j?.error ?? "Sync failed");
      await load();
    } finally { setBusy(null); }
  }

  if (!pass) {
    return <main id="content" className="max-w-3xl mx-auto px-5 pt-10 pb-24"><h1 className="font-display font-bold text-2xl">Finance</h1>
      <p className="mt-4 text-haze">Sign in at <a className="underline underline-offset-4" href="/admin">/admin</a> first, then open this page again in the same tab.</p></main>;
  }

  const t = r?.totals;
  const maxDay = Math.max(1, ...(r?.daily ?? []).map((d) => d.income));
  const P = presets();

  return (
    <main id="content" className="max-w-5xl mx-auto px-5 pt-8 pb-24">
      <div className="flex items-baseline justify-between gap-4 flex-wrap">
        <h1 className="font-display font-bold text-3xl">Finance</h1>
        <a href="/admin" className="text-sm text-haze underline underline-offset-4">Back to admin</a>
      </div>

      <div className="mt-5 flex flex-wrap gap-2 items-center">
        {Object.keys(P).map((k) => (
          <button key={k} type="button" onClick={() => { setRange(P[k]); setLabel(k); }}
            className={`h-10 px-4 rounded-full border text-sm ${label === k ? "border-tungsten text-tungsten" : "border-line text-haze"}`}>{k}</button>
        ))}
        <input type="date" aria-label="From" value={range.from} onChange={(e) => { setRange({ ...range, from: e.target.value }); setLabel("Custom"); }} className="h-10 rounded-xl border border-line bg-sunk px-3 text-sm" />
        <span className="text-haze text-sm">to</span>
        <input type="date" aria-label="To" value={range.to} onChange={(e) => { setRange({ ...range, to: e.target.value }); setLabel("Custom"); }} className="h-10 rounded-xl border border-line bg-sunk px-3 text-sm" />
      </div>

      <div className="mt-5 flex gap-2 border-b border-line">
        {(["overview", "expenses", "settings"] as const).map((k) => (
          <button key={k} type="button" onClick={() => setTab(k)} className={`px-4 h-11 text-sm font-medium border-b-2 -mb-px ${tab === k ? "border-tungsten text-tungsten" : "border-transparent text-haze"}`}>
            {k === "overview" ? "Overview" : k === "expenses" ? "Expenses" : "Rates & VAT"}
          </button>
        ))}
      </div>

      {err && <p className="mt-6 text-bad" role="alert">{err}</p>}
      {msg && <p className="mt-4 text-sm text-ok" role="status">{msg}</p>}

      {r?.notes.financeTablesMissing && (
        <div className={`${card} mt-6 border-bad`}>
          <p className="font-medium">One-time setup needed</p>
          <p className="text-sm text-haze mt-1">Run <code>supabase/migrations/0020_finance.sql</code> in the Supabase SQL editor. Until then, expenses and saved rates can't be stored and the numbers use the starting rates.</p>
        </div>
      )}

      {r && t && tab === "overview" && (<>
        <div className="mt-6 grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            ["Income", ngn(t.income), "Our fees plus Paybeta commission"],
            ["Gross profit", ngn(t.gross), "Income less processing fees"],
            ["Expenses", ngn(t.expenses), "Costs of running Nolgic"],
            ["Net profit", ngn(t.net), t.vatDeducted ? "After expenses and VAT" : "After expenses"],
          ].map(([k, v, s], i) => (
            <div key={k} className={card}>
              <p className="text-xs text-haze">{k}</p>
              <p className={`font-display font-bold text-xl mt-1 ${i === 3 ? (t.net >= 0 ? "text-ok" : "text-bad") : ""}`}>{v}</p>
              <p className="text-xs text-haze mt-1">{s}</p>
            </div>
          ))}
        </div>

        <p className="mt-3 text-sm text-haze">
          {t.orders} delivered orders. Customers paid {ngn(t.collected)}; {ngn(t.bill)} of that passes through to the providers and is not our revenue.
          {" "}{r.customers.unique} customers, {r.customers.repeat} of them bought more than once.
        </p>

        {(r.notes.processorEstimated > 0 || !r.notes.econColumns) && (
          <div className={`${card} mt-4 flex items-center justify-between gap-4 flex-wrap`}>
            <p className="text-sm text-haze max-w-xl">
              {r.notes.processorEstimated} of {t.orders} orders still use an <b>estimated</b> Flutterwave fee, and commission is calculated from your rates. Sync pulls the real Flutterwave fee for each payment and locks in today's commission rates on those orders.
            </p>
            <button type="button" className={btn} onClick={sync} disabled={busy === "sync" || !r.notes.econColumns}>{busy === "sync" ? "Syncing…" : "Sync real fees"}</button>
          </div>
        )}

        {(r.attention.needsReview > 0 || r.attention.refundFailed > 0 || r.attention.stuckPaid > 0) && (
          <div className={`${card} mt-4 border-bad`}>
            <p className="font-medium text-bad">Money to chase</p>
            <p className="text-sm text-haze mt-1">{r.attention.needsReview} held for review · {r.attention.refundFailed} failed refunds · {r.attention.stuckPaid} paid but not delivered for over 10 minutes. Open the Orders tab in <a className="underline underline-offset-4" href="/admin">admin</a>.</p>
          </div>
        )}

        <h2 className="font-display font-bold text-lg mt-8">By product</h2>
        <div className="mt-3 overflow-x-auto rounded-2xl border border-line">
          <table className="w-full text-sm">
            <thead className="bg-sunk text-haze text-left"><tr>{["Product", "Orders", "Our fees", "Commission", "Processor", "Gross profit"].map((h, i) => <th key={h} className={`px-3 py-2 font-medium ${i ? "text-right" : ""}`}>{h}</th>)}</tr></thead>
            <tbody>
              {r.products.filter((p) => p.orders > 0).map((p) => (
                <tr key={p.key} className="border-t border-line"><td className="px-3 py-2">{p.label}</td><td className="px-3 py-2 text-right">{p.orders}</td><td className="px-3 py-2 text-right">{ngn(p.fees)}</td><td className="px-3 py-2 text-right">{ngn(p.commission)}</td><td className="px-3 py-2 text-right">{ngn(p.processor)}</td><td className="px-3 py-2 text-right font-medium">{ngn(p.gross)}</td></tr>
              ))}
              {!t.orders && <tr><td colSpan={6} className="px-3 py-6 text-center text-haze">No delivered orders in this period.</td></tr>}
              {t.orders > 0 && <tr className="border-t border-line bg-sunk font-medium"><td className="px-3 py-2">Total</td><td className="px-3 py-2 text-right">{t.orders}</td><td className="px-3 py-2 text-right">{ngn(t.fees)}</td><td className="px-3 py-2 text-right">{ngn(t.commission)}</td><td className="px-3 py-2 text-right">{ngn(t.processor)}</td><td className="px-3 py-2 text-right">{ngn(t.gross)}</td></tr>}
            </tbody>
          </table>
        </div>

        {r.daily.length > 1 && r.daily.length <= 62 && (<>
          <h2 className="font-display font-bold text-lg mt-8">Income per day</h2>
          <div className="mt-3 flex items-end gap-[3px] h-28" role="img" aria-label="Income per day">
            {r.daily.map((d) => <div key={d.day} title={`${d.day}: ${ngn(d.income)} from ${d.orders} orders`} className="flex-1 bg-tungsten/80 rounded-t" style={{ height: `${Math.max(2, (d.income / maxDay) * 100)}%` }} />)}
          </div>
        </>)}

        <h2 className="font-display font-bold text-lg mt-8">Download</h2>
        <p className="text-sm text-haze mt-1">Branded with the company letterhead. CSV files open in Excel and go straight to your accountant.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {([["pnl", "pdf", "Profit & Loss (PDF)"], ["pnl", "csv", "P&L (CSV)"], ["ledger", "csv", "Every order (CSV)"], ["refunds", "csv", "Refunds (CSV)"], ["expenses", "csv", "Expenses (CSV)"]] as const).map(([ty, f, l]) => (
            <button key={ty + f} type="button" className={`${btn} ${ty === "pnl" && f === "pdf" ? "border-tungsten text-tungsten" : ""}`} disabled={busy === `${ty}.${f}`} onClick={() => download(ty, f)}>{busy === `${ty}.${f}` ? "Preparing…" : l}</button>
          ))}
        </div>
      </>)}

      {r && tab === "expenses" && <ExpensesTab r={r} api={api} reload={load} />}
      {r && tab === "settings" && <SettingsTab r={r} api={api} reload={load} />}
    </main>
  );
}

function ExpensesTab({ r, api, reload }: { r: Report; api: (p: string, i?: RequestInit) => Promise<Response>; reload: () => Promise<void> }) {
  const [f, setF] = useState({ spent_on: watToday(), category: CATEGORIES[0], vendor: "", description: "", amount_ngn: "", vat_ngn: "", receipt_ref: "" });
  const [e, setE] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: string) => setF((x) => ({ ...x, [k]: v }));

  async function add() {
    setBusy(true); setE(null);
    try {
      const res = await api("/api/admin/finance/expenses", { method: "POST", body: JSON.stringify({ ...f, amount_ngn: Number(f.amount_ngn), vat_ngn: Number(f.vat_ngn || 0) }) });
      const j = await res.json().catch(() => null);
      if (!res.ok) { setE(j?.error ?? "Couldn't save"); return; }
      setF({ ...f, vendor: "", description: "", amount_ngn: "", vat_ngn: "", receipt_ref: "" }); await reload();
    } finally { setBusy(false); }
  }
  async function del(id: string) {
    if (!window.confirm("Delete this expense? It stays in the audit log.")) return;
    await api(`/api/admin/finance/expenses?id=${id}`, { method: "DELETE" }); await reload();
  }

  return (
    <div className="mt-6">
      <div className={card}>
        <p className="font-medium">Add an expense</p>
        <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-3">
          <label className="text-xs text-haze">Date paid<input type="date" className={`${input} mt-1`} value={f.spent_on} onChange={(x) => set("spent_on", x.target.value)} /></label>
          <label className="text-xs text-haze">Category<select className={`${input} mt-1`} value={f.category} onChange={(x) => set("category", x.target.value)}>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></label>
          <label className="text-xs text-haze">Paid to<input className={`${input} mt-1`} value={f.vendor} onChange={(x) => set("vendor", x.target.value)} placeholder="Vercel, Supabase…" /></label>
          <label className="text-xs text-haze sm:col-span-3">What for<input className={`${input} mt-1`} value={f.description} onChange={(x) => set("description", x.target.value)} placeholder="Pro plan, October" /></label>
          <label className="text-xs text-haze">Amount paid (₦, VAT included)<input inputMode="decimal" className={`${input} mt-1`} value={f.amount_ngn} onChange={(x) => set("amount_ngn", x.target.value.replace(/[^\d.]/g, ""))} /></label>
          <label className="text-xs text-haze">Of which VAT (₦, if shown)<input inputMode="decimal" className={`${input} mt-1`} value={f.vat_ngn} onChange={(x) => set("vat_ngn", x.target.value.replace(/[^\d.]/g, ""))} /></label>
          <label className="text-xs text-haze">Receipt or invoice no.<input className={`${input} mt-1`} value={f.receipt_ref} onChange={(x) => set("receipt_ref", x.target.value)} /></label>
        </div>
        {e && <p className="text-bad text-sm mt-3" role="alert">{e}</p>}
        <button type="button" className={`${btn} mt-4 border-tungsten text-tungsten`} onClick={add} disabled={busy || !f.amount_ngn}>{busy ? "Saving…" : "Save expense"}</button>
        <p className="text-xs text-haze mt-3">Record what you pay to run the business. Don't record top-ups of your Paybeta wallet: that is funding for customer orders, not an expense.</p>
      </div>

      <h2 className="font-display font-bold text-lg mt-8">This period ({r.expenses.length})</h2>
      <div className="mt-3 overflow-x-auto rounded-2xl border border-line">
        <table className="w-full text-sm">
          <thead className="bg-sunk text-haze text-left"><tr><th className="px-3 py-2 font-medium">Date</th><th className="px-3 py-2 font-medium">Category</th><th className="px-3 py-2 font-medium">Paid to</th><th className="px-3 py-2 font-medium text-right">Amount</th><th className="px-3 py-2 font-medium text-right">VAT</th><th /></tr></thead>
          <tbody>
            {r.expenses.map((x) => (
              <tr key={x.id} className="border-t border-line"><td className="px-3 py-2 whitespace-nowrap">{x.spent_on}</td><td className="px-3 py-2">{x.category}</td><td className="px-3 py-2">{x.vendor ?? ""}{x.description ? <span className="text-haze"> · {x.description}</span> : null}</td><td className="px-3 py-2 text-right">{ngn(x.amount_ngn)}</td><td className="px-3 py-2 text-right text-haze">{ngn(x.vat_ngn)}</td>
                <td className="px-3 py-2 text-right"><button type="button" onClick={() => del(x.id)} className="text-haze hover:text-bad text-xs underline underline-offset-4">Delete</button></td></tr>
            ))}
            {!r.expenses.length && <tr><td colSpan={6} className="px-3 py-6 text-center text-haze">No expenses recorded for this period.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SettingsTab({ r, api, reload }: { r: Report; api: (p: string, i?: RequestInit) => Promise<Response>; reload: () => Promise<void> }) {
  const [s, setS] = useState<Settings>(r.settings);
  const [m, setM] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => setS(r.settings), [r.settings]);
  const num = (path: string[], v: string) => setS((cur) => { const c: any = JSON.parse(JSON.stringify(cur)); let o = c; for (const k of path.slice(0, -1)) o = o[k]; o[path[path.length - 1]] = v === "" ? 0 : Number(v.replace(/[^\d.]/g, "")); return c; });
  const txt = (k: keyof Settings["business"], v: string) => setS((c) => ({ ...c, business: { ...c.business, [k]: v } }));
  const rate = useMemo(() => [
    ["Airtime commission %", ["commission", "airtime_pct"]], ["Data commission %", ["commission", "data_pct"]], ["TV commission %", ["commission", "tv_pct"]],
    ["Electricity commission %", ["commission", "electricity_pct"]], ["Exam PIN commission %", ["commission", "exam_pct"]], ["JAMB flat commission ₦", ["commission", "jamb_flat"]],
    ["Flutterwave fee % (estimate)", ["processor", "pct"]], ["Flutterwave fee cap ₦", ["processor", "cap"]],
  ] as [string, string[]][], []);
  const get = (path: string[]) => path.reduce((o: any, k) => o?.[k], s) as number;

  async function save() {
    setBusy(true); setM(null);
    try {
      const res = await api("/api/admin/finance/settings", { method: "POST", body: JSON.stringify(s) });
      const j = await res.json().catch(() => null);
      setM(res.ok ? "Saved. New reports use these. Orders you already Synced keep the commission rate they were saved with." : j?.error ?? "Couldn't save");
      if (res.ok) await reload();
    } finally { setBusy(false); }
  }

  return (
    <div className="mt-6 grid gap-4">
      <div className={card}>
        <p className="font-medium">Paybeta commission and Flutterwave fees</p>
        <p className="text-sm text-haze mt-1">These start as estimates. Compare them with your Paybeta statement and Flutterwave settlement, then correct them here. Real Flutterwave fees replace the estimate when you press Sync.</p>
        <div className="mt-3 grid grid-cols-1 sm:grid-cols-4 gap-3">
          {rate.map(([l, p]) => <label key={l} className="text-xs text-haze">{l}<input inputMode="decimal" className={`${input} mt-1`} value={String(get(p))} onChange={(e) => num(p, e.target.value)} /></label>)}
        </div>
      </div>
      <div className={card}>
        <p className="font-medium">VAT</p>
        <label className="mt-3 flex items-center gap-3 text-sm"><input type="checkbox" checked={s.vat.registered} onChange={(e) => setS({ ...s, vat: { ...s.vat, registered: e.target.checked } })} /> The company is VAT-registered</label>
        <label className="mt-2 flex items-center gap-3 text-sm"><input type="checkbox" checked={s.vat.inclusive} onChange={(e) => setS({ ...s, vat: { ...s.vat, inclusive: e.target.checked } })} /> Our fees and commission already include VAT</label>
        <label className="mt-3 block text-xs text-haze max-w-[10rem]">VAT rate %<input inputMode="decimal" className={`${input} mt-1`} value={String(s.vat.rate)} onChange={(e) => num(["vat", "rate"], e.target.value)} /></label>
        <p className="text-xs text-haze mt-3">If you are not registered, reports show what VAT would be but don't deduct it from profit. Ask your accountant whether you need to register.</p>
      </div>
      <div className={card}>
        <p className="font-medium">Letterhead on every report</p>
        <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
          {([["Company name", "name"], ["Trading name", "trading"], ["Address", "address"], ["Email", "email"], ["Tax ID (TIN)", "tin"]] as [string, keyof Settings["business"]][]).map(([l, k]) => (
            <label key={k} className="text-xs text-haze">{l}<input className={`${input} mt-1`} value={s.business[k]} onChange={(e) => txt(k, e.target.value)} /></label>
          ))}
        </div>
      </div>
      {m && <p className="text-sm text-ok" role="status">{m}</p>}
      <div><button type="button" className={`${btn} border-tungsten text-tungsten`} onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</button></div>
    </div>
  );
}
