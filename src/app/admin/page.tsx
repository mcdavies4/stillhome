"use client";

// /admin — Nolgic founder dashboard (naira-first).
// Tabs: Overview (money, wallet, attention) · Orders (search/filter) · Health (config).
// Auth: ADMIN_PASSWORD, kept in sessionStorage for the tab session only.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Win = {
  orders: number; delivered_ngn: number; fee_ngn: number; collected_ngn: number;
  est_net_ngn: number; gbp_orders: number; gbp_revenue: number;
};
type Brief = {
  id: string; email: string | null; status: string; biller_name: string; identifier: string;
  amount_ngn: number | string; service_fee_local: number | string | null; payment_provider: string | null;
  created_at: string; error: string | null;
};
type Stats = {
  generated_at: string;
  today: Win; week: Win; month: Win;
  statusCounts: Record<string, number>;
  series: { day: string; orders: number; delivered_ngn: number }[];
  topBillers: { name: string; orders: number; ngn: number }[];
  attention: Brief[];
  recentFailures: Brief[];
  wallets: { currency: string; balance: number | null; low: number; ok: boolean; error: string | null }[];
  health: {
    bills_provider: string; bills: string; vtpass_phone: boolean;
    flutterwave: string; paystack: string; stripe: string; resend: string;
    ngn_pay_provider: string; flw_pay_hash: boolean;
    cron_secret: boolean; admin_secret: boolean; app_url: string | null;
    ngn_pay_enabled: boolean; uk_pay_enabled: boolean; gh_enabled: boolean;
    fee: { pct: number; min: number; max: number };
  };
};
type OrderRow = Brief & {
  identifier_label: string; customer_name: string | null; amount_gbp_pence: number | null;
  currency: string | null; country: string | null; flw_reference: string | null;
  paystack_reference: string | null; source: string | null; has_token: boolean;
};
type CheckResult = {
  advice: string; applied: boolean; reference: string; provider?: string;
  flutterwave: { found: boolean; status: string | null; token_available: boolean; error: string | null };
  paystack: { checked: boolean; status?: string; amountNgn?: number; error?: string };
  error?: string;
};

const ngn = (n: number | string | null | undefined) => `₦${Number(n ?? 0).toLocaleString("en-NG")}`;
const gbp = (n: number) => `£${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
const STATUSES = ["", "fulfilled", "paid", "pending_payment", "needs_review", "refund_failed", "failed_refunded", "expired"];

const statusTone = (s: string) =>
  s === "fulfilled" ? "border-ok/50 text-ok"
  : s === "refund_failed" || s === "needs_review" ? "border-bad text-bad"
  : s === "paid" ? "border-tungsten text-tungsten"
  : "border-line text-haze";

function Badge({ s }: { s: string }) {
  return <span className={`px-2 py-0.5 rounded-full text-[11px] font-mono border ${statusTone(s)}`}>{s}</span>;
}
const eyebrow = "font-mono text-xs text-haze uppercase tracking-[0.3em] mb-3";

export default function Admin() {
  const [pass, setPass] = useState("");
  const [authed, setAuthed] = useState<string | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<"overview" | "orders" | "health">("overview");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    try { const s = sessionStorage.getItem("nolgic-admin"); if (s) setAuthed(s); } catch {}
  }, []);

  const logout = useCallback((msg?: string) => {
    try { sessionStorage.removeItem("nolgic-admin"); } catch {}
    setAuthed(null); setStats(null); if (msg) setErr(msg);
  }, []);

  const api = useCallback(async (path: string, init?: RequestInit) => {
    const r = await fetch(path, { ...init, headers: { ...(init?.headers ?? {}), Authorization: `Bearer ${authed}` } });
    if (r.status === 401) { logout("Wrong password"); throw new Error("unauthorized"); }
    if (r.status === 429) { logout("Too many attempts — wait a few minutes"); throw new Error("rate"); }
    return r;
  }, [authed, logout]);

  const load = useCallback(async () => {
    if (!authed) return;
    setLoading(true);
    try {
      const r = await api("/api/admin");
      if (!r.ok) throw new Error("Failed to load");
      setStats(await r.json()); setErr(null);
    } catch (e: any) {
      if (e.message !== "unauthorized" && e.message !== "rate") setErr(e.message ?? "Failed to load");
    } finally { setLoading(false); }
  }, [authed, api]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!authed) return;
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [authed, load]);

  function login() {
    setErr(null);
    try { sessionStorage.setItem("nolgic-admin", pass); } catch {}
    setAuthed(pass); setPass("");
  }

  if (!authed || !stats) {
    return (
      <main className="max-w-sm mx-auto px-5 pt-24">
        <h1 className="font-display font-extrabold text-2xl mb-6">Nolgic Admin</h1>
        <label htmlFor="pw">Password</label>
        <input id="pw" type="password" value={pass} autoComplete="current-password"
          onChange={(e) => setPass(e.target.value)} onKeyDown={(e) => e.key === "Enter" && login()} />
        <button onClick={login}
          className="mt-4 w-full py-3 rounded-xl bg-tungsten text-white dark:text-night font-display font-bold">
          {authed && !stats && !err ? "Loading…" : "Enter"}
        </button>
        {err && <p role="alert" className="text-bad text-sm mt-3">{err}</p>}
      </main>
    );
  }

  const needs = stats.attention.length;
  const tabBtn = (k: typeof tab, label: string, badge?: number) => (
    <button key={k} onClick={() => setTab(k)}
      className={`px-4 py-2 rounded-lg text-sm font-semibold ${tab === k ? "bg-paper text-night" : "text-haze hover:text-paper"}`}>
      {label}{badge ? <span className="ml-2 px-1.5 rounded-full bg-bad text-white text-[11px]">{badge}</span> : null}
    </button>
  );

  return (
    <main className="max-w-4xl mx-auto px-5 pt-8 pb-24">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <h1 className="font-display font-extrabold text-2xl">Nolgic dashboard</h1>
        <div className="flex items-center gap-3 text-xs text-haze font-mono">
          <span>{loading ? "refreshing…" : `updated ${new Date(stats.generated_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`}</span>
          <button onClick={load} className="underline underline-offset-2 hover:text-paper">Refresh</button>
          <button onClick={() => logout()} className="underline underline-offset-2 hover:text-paper">Log out</button>
        </div>
      </div>

      <div className="flex gap-1 mb-8 p-1 rounded-xl bg-panel border border-line w-fit">
        {tabBtn("overview", "Overview", needs)}
        {tabBtn("orders", "Orders")}
        {tabBtn("health", "Health")}
      </div>

      {err && <p role="alert" className="text-bad text-sm mb-4">{err}</p>}

      {tab === "overview" && <Overview stats={stats} api={api} reload={load} />}
      {tab === "orders" && <Orders api={api} reload={load} />}
      {tab === "health" && <Health stats={stats} />}
    </main>
  );
}

type Api = (path: string, init?: RequestInit) => Promise<Response>;

/* ───────────────────────── Overview ───────────────────────── */
function Overview({ stats, api, reload }: { stats: Stats; api: Api; reload: () => void }) {
  const wins: { label: string; w: Win }[] = [
    { label: "TODAY", w: stats.today }, { label: "7 DAYS", w: stats.week }, { label: "30 DAYS", w: stats.month },
  ];
  const max = Math.max(1, ...stats.series.map((d) => d.delivered_ngn));
  const hasGbp = stats.month.gbp_orders > 0;

  return (
    <>
      <section className="grid sm:grid-cols-2 gap-3 mb-6">
        {stats.wallets.map((w) => (
          <div key={w.currency} className={`rounded-2xl border p-4 ${w.error ? "border-bad" : w.ok ? "border-line bg-panel" : "border-bad bg-bad/10"}`}>
            <p className="font-mono text-[10px] tracking-[0.25em] text-tungsten mb-2">FLUTTERWAVE {w.currency} WALLET</p>
            {w.balance === null
              ? <p className="text-bad text-sm">Couldn’t read balance{w.error ? `: ${w.error}` : ""}</p>
              : <p className="font-display font-extrabold text-3xl">{w.currency === "NGN" ? ngn(w.balance) : `${w.balance.toLocaleString()} ${w.currency}`}</p>}
            <p className={`text-sm mt-1 ${w.ok ? "text-haze" : "text-bad font-semibold"}`}>
              {w.ok ? `Alert level ${w.currency === "NGN" ? ngn(w.low) : w.low.toLocaleString()}` : w.balance !== null ? "Below alert level — top up" : ""}
            </p>
          </div>
        ))}
      </section>

      <section className="grid sm:grid-cols-3 gap-3 mb-8">
        {wins.map(({ label, w }) => (
          <div key={label} className="bg-panel border border-line rounded-2xl p-4">
            <p className="font-mono text-[10px] text-tungsten tracking-[0.25em] mb-2">{label}</p>
            <p className="font-display font-extrabold text-2xl">{ngn(w.delivered_ngn)}</p>
            <p className="text-haze text-sm mt-1">{w.orders} delivered</p>
            <p className="text-sm mt-1 font-mono">fees {ngn(w.fee_ngn)}</p>
            <p className={`text-sm font-mono ${w.est_net_ngn >= 0 ? "text-ok" : "text-bad"}`} title="Fee income minus estimated Paystack charges">
              est. net {ngn(w.est_net_ngn)}
            </p>
            {hasGbp && w.gbp_orders > 0 && <p className="text-haze text-xs mt-1">+ {w.gbp_orders} £ orders · {gbp(w.gbp_revenue)}</p>}
          </div>
        ))}
      </section>
      <p className="text-haze text-xs -mt-5 mb-8">“Est. net” = service fees minus an estimate of Paystack’s charges (1.5% + ₦100, capped ₦2,000). It excludes any bills-provider commission.</p>

      <section className="mb-8">
        <p className={eyebrow}>Needs attention {stats.attention.length ? `(${stats.attention.length})` : ""}</p>
        {stats.attention.length === 0 && <p className="text-haze text-sm">Nothing waiting on you 🎉</p>}
        <div className="space-y-2">
          {stats.attention.map((o) => <AttentionCard key={o.id} o={o} api={api} reload={reload} />)}
        </div>
      </section>

      <section className="mb-8">
        <p className={eyebrow}>Delivered, last 14 days</p>
        <div className="bg-panel border border-line rounded-2xl p-4">
          <div className="flex items-end gap-1.5 h-32" role="img" aria-label="Delivered naira per day, last 14 days">
            {stats.series.map((d) => (
              <div key={d.day} className="flex-1 flex flex-col items-center justify-end h-full group" title={`${d.day}: ${d.orders} orders · ${ngn(d.delivered_ngn)}`}>
                <div className="w-full rounded-t bg-tungsten/80 group-hover:bg-tungsten" style={{ height: `${Math.max(2, (d.delivered_ngn / max) * 100)}%` }} />
              </div>
            ))}
          </div>
          <div className="flex justify-between text-[10px] text-haze font-mono mt-2">
            <span>{stats.series[0].day.slice(5)}</span><span>{stats.series[stats.series.length - 1].day.slice(5)}</span>
          </div>
        </div>
      </section>

      <div className="grid md:grid-cols-2 gap-6">
        <section>
          <p className={eyebrow}>Orders by status · 30 days</p>
          <div className="flex flex-wrap gap-2">
            {Object.entries(stats.statusCounts).length === 0 && <p className="text-haze text-sm">No orders yet.</p>}
            {Object.entries(stats.statusCounts).map(([s, n]) => (
              <span key={s} className={`px-3 py-1.5 rounded-full text-xs font-mono border ${statusTone(s)}`}>{s}: {n}</span>
            ))}
          </div>
        </section>
        <section>
          <p className={eyebrow}>Top billers · 30 days</p>
          <div className="bg-panel border border-line rounded-2xl p-4 space-y-2">
            {stats.topBillers.length === 0 && <p className="text-haze text-sm">No delivered orders yet.</p>}
            {stats.topBillers.map((b) => (
              <div key={b.name} className="flex justify-between gap-4 text-sm">
                <span className="truncate">{b.name}</span>
                <span className="font-mono whitespace-nowrap">{b.orders} · {ngn(b.ngn)}</span>
              </div>
            ))}
          </div>
        </section>
      </div>

      {stats.recentFailures.length > 0 && (
        <section className="mt-8">
          <p className={eyebrow}>Auto-refunded · last 7 days</p>
          <div className="space-y-2">
            {stats.recentFailures.map((o) => (
              <div key={o.id} className="bg-panel border border-line rounded-2xl p-3 text-sm">
                <div className="flex justify-between font-mono text-xs text-haze"><span>{when(o.created_at)}</span><span>{o.payment_provider ?? "stripe"}</span></div>
                <p className="mt-1">{o.biller_name} · {ngn(o.amount_ngn)}</p>
                {o.error && <p className="text-haze text-xs mt-1 break-words">{o.error}</p>}
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  );
}

/* ─────────── one order that needs a human: check + (safe) apply ─────────── */
function AttentionCard({ o, api, reload, compact = false }: { o: Brief; api: Api; reload: () => void; compact?: boolean }) {
  const [res, setRes] = useState<CheckResult | null>(null);
  const [busy, setBusy] = useState(false);

  async function check(apply = false) {
    if (apply && !confirm("The bills provider confirms this vend succeeded. Mark the order as delivered?")) return;
    setBusy(true);
    try {
      const r = await api("/api/admin/check", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderId: o.id, apply }) });
      const d = await r.json();
      setRes(d);
      if (d.applied) reload();
    } catch { /* auth errors handled by api() */ } finally { setBusy(false); }
  }

  const canApply = res && !res.applied && res.flutterwave.found && /success|completed/.test(res.flutterwave.status ?? "") && o.status !== "fulfilled";

  return (
    <div className={compact ? "text-sm" : `bg-panel border rounded-2xl p-4 text-sm ${o.status === "refund_failed" ? "border-bad" : "border-line"}`}>
      {!compact && (
        <>
          <div className="flex justify-between gap-3 mb-1 items-center">
            <Badge s={o.status} /><span className="font-mono text-xs text-haze">{when(o.created_at)}</span>
          </div>
          <p>{o.biller_name} — {ngn(Number(o.amount_ngn) + Number(o.service_fee_local ?? 0))} · {o.email ?? "no email"}</p>
          <p className="text-haze text-xs font-mono mt-0.5">{o.identifier} · {o.payment_provider ?? "stripe"} · {o.id.slice(0, 8)}</p>
          {o.error && <p className="text-haze mt-1 break-words text-xs">{o.error}</p>}
        </>
      )}
      <div className={`flex flex-wrap gap-2 ${compact ? "" : "mt-3"}`}>
        <button disabled={busy} onClick={() => check(false)} className="px-3 py-1.5 rounded-lg border border-line text-xs font-semibold hover:border-tungsten">
          {busy ? "Checking…" : "Check with provider"}
        </button>
        {canApply && (
          <button disabled={busy} onClick={() => check(true)} className="px-3 py-1.5 rounded-lg bg-tungsten text-white dark:text-night text-xs font-bold">
            Mark delivered
          </button>
        )}
      </div>
      {res && (
        <div className="mt-3 rounded-xl bg-night border border-line p-3 text-xs space-y-1">
          {res.error && <p className="text-bad">{res.error}</p>}
          <p><span className="text-haze">{res.provider === "vtpass" ? "VTpass" : res.provider === "paybeta" ? "Paybeta" : "Flutterwave"}:</span> {res.flutterwave.found ? `${res.flutterwave.status ?? "unknown"}${res.flutterwave.token_available ? " · token available" : ""}` : `no record${res.flutterwave.error ? ` (${res.flutterwave.error})` : ""}`}</p>
          {res.paystack.checked && <p><span className="text-haze">Paystack:</span> {res.paystack.error ?? `${res.paystack.status} · ${ngn(res.paystack.amountNgn)}`}</p>}
          <p className="font-semibold">{res.applied ? "Marked as delivered ✓" : res.advice}</p>
        </div>
      )}
    </div>
  );
}

/* ───────────────────────── Orders ───────────────────────── */
function Orders({ api, reload }: { api: Api; reload: () => void }) {
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<OrderRow[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchPage = useCallback(async (before: string | null, replace: boolean) => {
    setBusy(true);
    try {
      const p = new URLSearchParams({ limit: "50" });
      if (status) p.set("status", status);
      if (q.trim()) p.set("q", q.trim());
      if (before) p.set("before", before);
      const r = await api(`/api/admin/orders?${p}`);
      const d = await r.json();
      setRows((prev) => (replace ? d.orders : [...prev, ...d.orders]));
      setNext(d.next_before ?? null);
    } catch { /* handled */ } finally { setBusy(false); }
  }, [api, status, q]);

  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => fetchPage(null, true), 300);
    return () => { if (debounce.current) clearTimeout(debounce.current); };
  }, [fetchPage]);

  return (
    <>
      <div className="flex flex-wrap gap-2 mb-4">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search email, meter, phone, biller…" className="!w-full sm:!w-72" aria-label="Search orders" />
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="!w-auto" aria-label="Filter by status">
          {STATUSES.map((s) => <option key={s} value={s}>{s || "All statuses"}</option>)}
        </select>
      </div>

      <div className="bg-panel border border-line rounded-2xl overflow-hidden">
        {rows.length === 0 && !busy && <p className="p-4 text-haze text-sm">No orders match.</p>}
        {rows.map((o) => (
          <div key={o.id} className="border-t first:border-t-0 border-line">
            <button onClick={() => setOpen(open === o.id ? null : o.id)} className="w-full text-left p-3 sm:p-4 hover:bg-night/40" aria-expanded={open === o.id}>
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm truncate">{o.biller_name}</p>
                  <p className="text-haze text-xs font-mono truncate">{when(o.created_at)} · {o.email ?? "—"}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="font-mono text-sm">{o.payment_provider === "paystack" ? ngn(Number(o.amount_ngn) + Number(o.service_fee_local ?? 0)) : gbp((o.amount_gbp_pence ?? 0) / 100)}</p>
                  <Badge s={o.status} />
                </div>
              </div>
            </button>
            {open === o.id && <OrderDetail o={o} api={api} reload={() => { reload(); fetchPage(null, true); }} />}
          </div>
        ))}
      </div>

      <div className="mt-4 text-center">
        {busy && <p className="text-haze text-sm">Loading…</p>}
        {!busy && next && <button onClick={() => fetchPage(next, false)} className="px-4 py-2 rounded-lg border border-line text-sm hover:border-tungsten">Load more</button>}
      </div>
    </>
  );
}

function OrderDetail({ o, api, reload }: { o: OrderRow; api: Api; reload: () => void }) {
  const Row = ({ k, v }: { k: string; v: string | null }) => v ? (
    <div className="flex justify-between gap-4"><span className="text-haze">{k}</span><span className="text-right break-all">{v}</span></div>
  ) : null;
  return (
    <div className="px-4 pb-4 text-xs font-mono space-y-1.5 bg-night/30">
      <Row k="Order" v={o.id} />
      <Row k={o.identifier_label} v={o.identifier} />
      <Row k="Account name" v={o.customer_name} />
      <Row k="Amount" v={ngn(o.amount_ngn)} />
      {Number(o.service_fee_local ?? 0) > 0 && <Row k="Service fee" v={ngn(o.service_fee_local)} />}
      <Row k="Provider" v={o.payment_provider ?? "stripe"} />
      <Row k="Paystack ref" v={o.paystack_reference} />
      <Row k="Bills provider ref" v={o.flw_reference} />
      <Row k="Token issued" v={o.has_token ? "yes" : null} />
      <Row k="Source" v={o.source} />
      {o.error && <p className="text-bad break-words">{o.error}</p>}
      {["paid", "needs_review", "refund_failed", "fulfilled"].includes(o.status) && (
        <div className="pt-2"><AttentionCard o={o} api={api} reload={reload} compact /></div>
      )}
    </div>
  );
}

/* ───────────────────────── Health ───────────────────────── */
function Health({ stats }: { stats: Stats }) {
  const h = stats.health;
  const items: { label: string; ok: boolean; detail: string; fix?: string }[] = useMemo(() => [
    { label: "Cron secret", ok: h.cron_secret, detail: h.cron_secret ? "Set" : "Missing — daily token recovery, FX guard and reconcile email will be refused", fix: "Set CRON_SECRET in Vercel, redeploy" },
    { label: "Admin password", ok: true, detail: "You’re signed in with it" },
    { label: "Partner admin secret", ok: h.admin_secret, detail: h.admin_secret ? "Set" : "Missing — partner admin APIs are locked", fix: "Set ADMIN_SECRET (only needed for /admin/partners)" },
    { label: `Bills provider: ${h.bills_provider === "vtpass" ? "VTpass" : h.bills_provider === "paybeta" ? "Paybeta" : "Flutterwave"}`, ok: h.bills === "live", detail: h.bills === "live" ? "Live" : h.bills === "test" ? (h.bills_provider === "flutterwave" ? "TEST key — vends are not real" : "SANDBOX — vends are not real") : "Keys missing", fix: h.bills_provider === "vtpass" ? "VTPASS_API_KEY, VTPASS_PUBLIC_KEY, VTPASS_SECRET_KEY, VTPASS_ENV=live" : h.bills_provider === "paybeta" ? "PAYBETA_API_KEY, PAYBETA_ENV=live (and the webhook URL in the Paybeta console)" : "FLW_SECRET_KEY" },
    ...(h.bills_provider === "vtpass" ? [{ label: "VTpass default phone", ok: h.vtpass_phone, detail: h.vtpass_phone ? "Set" : "Missing — electricity and TV vends need a phone number", fix: "VTPASS_DEFAULT_PHONE (an 11-digit Nigerian mobile you own)" }] : []),
    ...(h.ngn_pay_provider === "flutterwave"
      ? [{ label: "Naira payments: Flutterwave", ok: h.flutterwave === "live" && h.flw_pay_hash, detail: h.flutterwave === "live" ? (h.flw_pay_hash ? "Live" : "Webhook secret hash missing — the order page still confirms payments, but set it") : h.flutterwave === "test" ? "TEST key — customers can’t pay real money yet" : "Missing — naira checkout returns 503", fix: "FLW_SECRET_KEY, FLW_SECRET_HASH (same value as the Secret Hash in the Flutterwave dashboard)" }]
      : []),
    { label: "Paystack key", ok: h.ngn_pay_provider === "flutterwave" || h.paystack === "live", detail: h.ngn_pay_provider === "flutterwave" ? "Not used for naira right now" : h.paystack === "live" ? "Live" : h.paystack === "test" ? "TEST key — customers can’t pay real money yet" : "Missing — naira checkout returns 503", fix: "PAYSTACK_SECRET_KEY" },
    { label: "Email receipts (Resend)", ok: h.resend === "set", detail: h.resend === "set" ? "Set" : "Missing — no receipts or alerts", fix: "RESEND_API_KEY" },
    { label: "Stripe (£)", ok: h.stripe === "set" || !h.uk_pay_enabled, detail: h.stripe === "set" ? "Key set" : "Not set (fine while UK is switched off)" },
    { label: "App URL", ok: !!h.app_url && h.app_url.startsWith("https://"), detail: h.app_url ?? "Missing", fix: "NEXT_PUBLIC_APP_URL=https://www.nolgic.com" },
  ], [h]);

  return (
    <>
      <p className={eyebrow}>Configuration</p>
      <div className="bg-panel border border-line rounded-2xl divide-y divide-line">
        {items.map((i) => (
          <div key={i.label} className="p-4 flex items-start gap-3 text-sm">
            <span className={`mt-1 w-2.5 h-2.5 rounded-full shrink-0 ${i.ok ? "bg-ok" : "bg-bad"}`} aria-hidden />
            <div className="min-w-0">
              <p className="font-semibold">{i.label}</p>
              <p className="text-haze break-words">{i.detail}</p>
              {!i.ok && i.fix && <p className="text-tungsten text-xs mt-1 font-mono">{i.fix}</p>}
            </div>
          </div>
        ))}
      </div>

      <p className={`${eyebrow} mt-8`}>Launch switches</p>
      <div className="grid sm:grid-cols-3 gap-3">
        {[
          { l: "Pay in ₦ (Nigeria)", on: h.ngn_pay_enabled, v: "NEXT_PUBLIC_NGN_PAY_ENABLED" },
          { l: "Pay in £ (UK)", on: h.uk_pay_enabled, v: "NEXT_PUBLIC_UK_PAY_ENABLED" },
          { l: "Ghana", on: h.gh_enabled, v: "NEXT_PUBLIC_GH_ENABLED" },
        ].map((s) => (
          <div key={s.l} className="bg-panel border border-line rounded-2xl p-4">
            <p className="font-semibold text-sm">{s.l}</p>
            <p className={`text-sm mt-1 ${s.on ? "text-ok" : "text-haze"}`}>{s.on ? "Open" : "Coming soon"}</p>
            <p className="text-haze text-[11px] font-mono mt-2 break-all">{s.v}=1</p>
          </div>
        ))}
      </div>
      <p className="text-haze text-sm mt-4">Service fee: {h.fee.pct}% of the amount, minimum {ngn(h.fee.min)}, maximum {ngn(h.fee.max)}.</p>

      <p className={`${eyebrow} mt-8`}>Dashboards</p>
      <div className="flex flex-wrap gap-2 text-sm">
        {[["Paystack", "https://dashboard.paystack.com"], ["Flutterwave", "https://app.flutterwave.com"], ["VTpass", "https://vtpass.com"], ["Paybeta", "https://console.paybeta.ng"], ["Stripe", "https://dashboard.stripe.com"], ["Vercel", "https://vercel.com/dashboard"], ["Supabase", "https://supabase.com/dashboard"]].map(([n, u]) => (
          <a key={n} href={u} target="_blank" rel="noopener noreferrer" className="px-3 py-1.5 rounded-lg border border-line hover:border-tungsten">{n} ↗</a>
        ))}
      </div>
    </>
  );
}
