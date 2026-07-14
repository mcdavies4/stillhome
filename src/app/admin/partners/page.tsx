"use client";

// /admin/partners — solo-founder partner ops console.
// Auth: prompts for the ADMIN_SECRET once, keeps it in memory for the
// session (state only, nothing persisted), and sends it as x-admin-secret
// on every request. Wrong secret -> stays on the unlock screen.

import { useCallback, useEffect, useState } from "react";

type Partner = {
  id: string;
  name: string;
  slug: string;
  status: string;
  contact_email: string;
  fee_bps: number;
  fx_margin_bps: number;
  daily_cap_pence: number;
  balance_pence: number;
  spent_today_pence: number;
  webhook_url: string | null;
};

type Detail = {
  ledger: Array<{ id: string; entry_type: string; amount_pence: number; balance_after_pence: number; note: string | null; created_at: string }>;
  keys: Array<{ id: string; environment: string; key_prefix: string; label: string; last_used_at: string | null; revoked_at: string | null }>;
  orders: Array<{ id: string; partner_ref: string | null; status: string; biller_name: string; identifier: string; amount_ngn: number; amount_gbp_pence: number; error: string | null; created_at: string }>;
};

const gbp = (pence: number) => `£${(pence / 100).toFixed(2)}`;

export default function PartnersAdmin() {
  const [secret, setSecret] = useState("");
  const [unlocked, setUnlocked] = useState(false);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [selected, setSelected] = useState<Partner | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [freshKey, setFreshKey] = useState<string | null>(null);

  // new-partner form
  const [npName, setNpName] = useState("");
  const [npSlug, setNpSlug] = useState("");
  const [npEmail, setNpEmail] = useState("");
  // top-up form
  const [topupGbp, setTopupGbp] = useState("");
  const [topupNote, setTopupNote] = useState("");

  const call = useCallback(
    async (path: string, init?: RequestInit) => {
      const res = await fetch(path, {
        ...init,
        headers: {
          "Content-Type": "application/json",
          "x-admin-secret": secret,
          ...(init?.headers ?? {}),
        },
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error?.message ?? `HTTP ${res.status}`);
      return json;
    },
    [secret]
  );

  const loadPartners = useCallback(async () => {
    const json = await call("/api/admin/partners");
    setPartners(json.partners);
  }, [call]);

  const loadDetail = useCallback(
    async (p: Partner) => {
      setSelected(p);
      setDetail(null);
      const json = await call(`/api/admin/partners/ledger?partner_id=${p.id}`);
      setDetail(json);
    },
    [call]
  );

  async function unlock() {
    setBusy(true);
    setNotice(null);
    try {
      await loadPartners();
      setUnlocked(true);
    } catch {
      setNotice("Wrong secret.");
    } finally {
      setBusy(false);
    }
  }

  async function createPartner() {
    if (!npName || !npSlug || !npEmail) return;
    setBusy(true);
    setNotice(null);
    try {
      await call("/api/admin/partners", {
        method: "POST",
        body: JSON.stringify({ name: npName, slug: npSlug, contact_email: npEmail }),
      });
      setNpName(""); setNpSlug(""); setNpEmail("");
      await loadPartners();
      setNotice("Partner created.");
    } catch (e: any) {
      setNotice(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function topup(sign: 1 | -1) {
    if (!selected) return;
    const pence = Math.round(parseFloat(topupGbp) * 100) * sign;
    if (!Number.isFinite(pence) || pence === 0) return;
    setBusy(true);
    setNotice(null);
    try {
      await call("/api/admin/partners/topup", {
        method: "POST",
        body: JSON.stringify({ partner_id: selected.id, amount_pence: pence, note: topupNote || null }),
      });
      setTopupGbp(""); setTopupNote("");
      await loadPartners();
      await loadDetail({ ...selected });
      setNotice(sign > 0 ? "Wallet credited." : "Wallet adjusted down.");
    } catch (e: any) {
      setNotice(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function createKey(environment: "test" | "live") {
    if (!selected) return;
    setBusy(true);
    setNotice(null);
    try {
      const json = await call("/api/admin/partners/keys", {
        method: "POST",
        body: JSON.stringify({ partner_id: selected.id, environment }),
      });
      setFreshKey(json.key);
      await loadDetail({ ...selected });
    } catch (e: any) {
      setNotice(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function revokeKey(keyId: string) {
    if (!selected) return;
    if (!confirm("Revoke this key? Any integration using it stops working immediately.")) return;
    setBusy(true);
    try {
      await call("/api/admin/partners/keys", { method: "DELETE", body: JSON.stringify({ key_id: keyId }) });
      await loadDetail({ ...selected });
    } catch (e: any) {
      setNotice(e.message);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (selected) {
      const fresh = partners.find((p) => p.id === selected.id);
      if (fresh) setSelected(fresh);
    }
  }, [partners]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!unlocked) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-neutral-950 text-neutral-100 p-6">
        <div className="w-full max-w-sm space-y-4">
          <h1 className="text-xl font-semibold">Partner Admin</h1>
          <input
            type="password"
            className="w-full rounded-lg bg-neutral-900 border border-neutral-700 px-3 py-2"
            placeholder="Admin secret"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && unlock()}
          />
          <button
            onClick={unlock}
            disabled={busy || !secret}
            className="w-full rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 px-3 py-2 font-medium"
          >
            {busy ? "Checking..." : "Unlock"}
          </button>
          {notice && <p className="text-red-400 text-sm">{notice}</p>}
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100 p-4 md:p-8">
      <div className="max-w-6xl mx-auto space-y-6">
        <header className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">Partners</h1>
          {notice && <span className="text-sm text-emerald-400">{notice}</span>}
        </header>

        {/* one-time key reveal */}
        {freshKey && (
          <div className="rounded-xl border border-amber-500 bg-amber-950/40 p-4 space-y-2">
            <p className="font-medium text-amber-300">New API key — shown once. Copy it now.</p>
            <code className="block break-all text-sm bg-neutral-900 rounded p-2">{freshKey}</code>
            <div className="flex gap-2">
              <button
                onClick={() => navigator.clipboard.writeText(freshKey)}
                className="rounded bg-amber-600 hover:bg-amber-500 px-3 py-1 text-sm"
              >
                Copy
              </button>
              <button onClick={() => setFreshKey(null)} className="rounded bg-neutral-800 px-3 py-1 text-sm">
                Done
              </button>
            </div>
          </div>
        )}

        <div className="grid md:grid-cols-3 gap-6">
          {/* partner list + create */}
          <section className="space-y-3">
            {partners.map((p) => (
              <button
                key={p.id}
                onClick={() => loadDetail(p)}
                className={`w-full text-left rounded-xl border p-3 transition ${
                  selected?.id === p.id
                    ? "border-emerald-500 bg-emerald-950/30"
                    : "border-neutral-800 bg-neutral-900 hover:border-neutral-600"
                }`}
              >
                <div className="flex justify-between items-baseline">
                  <span className="font-medium">{p.name}</span>
                  <span className="text-emerald-400 font-mono text-sm">{gbp(p.balance_pence)}</span>
                </div>
                <div className="text-xs text-neutral-400 mt-1">
                  {p.slug} · today {gbp(p.spent_today_pence)} / {gbp(p.daily_cap_pence)}
                  {p.status !== "active" && <span className="text-red-400"> · {p.status}</span>}
                </div>
              </button>
            ))}

            <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-3 space-y-2">
              <p className="text-sm font-medium text-neutral-300">New partner</p>
              <input className="w-full rounded bg-neutral-950 border border-neutral-700 px-2 py-1.5 text-sm" placeholder="Name" value={npName} onChange={(e) => setNpName(e.target.value)} />
              <input className="w-full rounded bg-neutral-950 border border-neutral-700 px-2 py-1.5 text-sm" placeholder="slug (e.g. acme-remit)" value={npSlug} onChange={(e) => setNpSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))} />
              <input className="w-full rounded bg-neutral-950 border border-neutral-700 px-2 py-1.5 text-sm" placeholder="Contact email" value={npEmail} onChange={(e) => setNpEmail(e.target.value)} />
              <button onClick={createPartner} disabled={busy} className="w-full rounded bg-neutral-700 hover:bg-neutral-600 disabled:opacity-50 px-2 py-1.5 text-sm">
                Create
              </button>
            </div>
          </section>

          {/* detail */}
          <section className="md:col-span-2 space-y-4">
            {!selected && <p className="text-neutral-500">Select a partner.</p>}

            {selected && (
              <>
                <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4 space-y-3">
                  <div className="flex justify-between items-baseline">
                    <h2 className="text-lg font-medium">{selected.name}</h2>
                    <span className="font-mono text-emerald-400">{gbp(selected.balance_pence)}</span>
                  </div>
                  <div className="flex flex-wrap gap-2 items-center">
                    <input className="w-28 rounded bg-neutral-950 border border-neutral-700 px-2 py-1.5 text-sm" placeholder="£ amount" value={topupGbp} onChange={(e) => setTopupGbp(e.target.value)} />
                    <input className="flex-1 min-w-40 rounded bg-neutral-950 border border-neutral-700 px-2 py-1.5 text-sm" placeholder="Note (e.g. bank ref)" value={topupNote} onChange={(e) => setTopupNote(e.target.value)} />
                    <button onClick={() => topup(1)} disabled={busy} className="rounded bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 px-3 py-1.5 text-sm">Credit</button>
                    <button onClick={() => topup(-1)} disabled={busy} className="rounded bg-red-700 hover:bg-red-600 disabled:opacity-50 px-3 py-1.5 text-sm">Adjust down</button>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => createKey("test")} disabled={busy} className="rounded bg-neutral-700 hover:bg-neutral-600 px-3 py-1.5 text-sm">+ Test key</button>
                    <button onClick={() => createKey("live")} disabled={busy} className="rounded bg-neutral-700 hover:bg-neutral-600 px-3 py-1.5 text-sm">+ Live key</button>
                  </div>
                </div>

                {!detail && <p className="text-neutral-500 text-sm">Loading…</p>}

                {detail && (
                  <>
                    <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
                      <h3 className="text-sm font-medium text-neutral-300 mb-2">API keys</h3>
                      {detail.keys.length === 0 && <p className="text-sm text-neutral-500">None yet.</p>}
                      <ul className="space-y-1">
                        {detail.keys.map((k) => (
                          <li key={k.id} className="flex justify-between items-center text-sm">
                            <span className={k.revoked_at ? "line-through text-neutral-600" : ""}>
                              <code>{k.key_prefix}…</code>
                              <span className={`ml-2 text-xs ${k.environment === "live" ? "text-emerald-400" : "text-sky-400"}`}>{k.environment}</span>
                              <span className="ml-2 text-xs text-neutral-500">{k.label}</span>
                            </span>
                            {!k.revoked_at && (
                              <button onClick={() => revokeKey(k.id)} className="text-xs text-red-400 hover:text-red-300">revoke</button>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>

                    <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4 overflow-x-auto">
                      <h3 className="text-sm font-medium text-neutral-300 mb-2">Recent API orders</h3>
                      {detail.orders.length === 0 && <p className="text-sm text-neutral-500">None yet.</p>}
                      <table className="w-full text-xs">
                        <tbody>
                          {detail.orders.map((o) => (
                            <tr key={o.id} className="border-t border-neutral-800">
                              <td className="py-1.5 pr-2 text-neutral-400 whitespace-nowrap">{new Date(o.created_at).toLocaleString("en-GB")}</td>
                              <td className="py-1.5 pr-2">{o.biller_name}</td>
                              <td className="py-1.5 pr-2 font-mono">{o.identifier}</td>
                              <td className="py-1.5 pr-2 whitespace-nowrap">₦{Number(o.amount_ngn).toLocaleString()} / {gbp(o.amount_gbp_pence)}</td>
                              <td className={`py-1.5 ${o.status === "fulfilled" ? "text-emerald-400" : o.status === "paid" ? "text-amber-400" : "text-red-400"}`}>{o.status}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4 overflow-x-auto">
                      <h3 className="text-sm font-medium text-neutral-300 mb-2">Ledger</h3>
                      {detail.ledger.length === 0 && <p className="text-sm text-neutral-500">Empty.</p>}
                      <table className="w-full text-xs">
                        <tbody>
                          {detail.ledger.map((l) => (
                            <tr key={l.id} className="border-t border-neutral-800">
                              <td className="py-1.5 pr-2 text-neutral-400 whitespace-nowrap">{new Date(l.created_at).toLocaleString("en-GB")}</td>
                              <td className="py-1.5 pr-2">{l.entry_type}</td>
                              <td className={`py-1.5 pr-2 font-mono ${l.amount_pence >= 0 ? "text-emerald-400" : "text-red-400"}`}>{gbp(l.amount_pence)}</td>
                              <td className="py-1.5 pr-2 font-mono text-neutral-400">{gbp(l.balance_after_pence)}</td>
                              <td className="py-1.5 text-neutral-500">{l.note}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
