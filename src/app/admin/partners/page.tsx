"use client";

// /admin/partners — Nolgic-branded partner ops console.
// Palette: Night #0B1026 (bg), Panel #141A38 (cards), Tungsten #FFB627 (brand),
// Ember #FF7A1A (secondary), Paper #F5F2E9 (text), Haze #9AA3C7 (muted).
// Auth: prompts for ADMIN_SECRET once, held in memory for the session and
// sent as x-admin-secret on every request. Nothing persisted in the browser.

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

// Brand tokens (inline so this drops in without touching tailwind.config)
const C = {
  night: "#0B1026",
  panel: "#141A38",
  panel2: "#1C2450",
  tungsten: "#FFB627",
  ember: "#FF7A1A",
  paper: "#F5F2E9",
  haze: "#9AA3C7",
  line: "#2A3260",
  danger: "#FF6B6B",
};

export default function PartnersAdmin() {
  const [secret, setSecret] = useState("");
  const [unlocked, setUnlocked] = useState(false);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [selected, setSelected] = useState<Partner | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [freshKey, setFreshKey] = useState<string | null>(null);

  const [npName, setNpName] = useState("");
  const [npSlug, setNpSlug] = useState("");
  const [npEmail, setNpEmail] = useState("");
  const [topupGbp, setTopupGbp] = useState("");
  const [topupNote, setTopupNote] = useState("");

  const call = useCallback(
    async (path: string, init?: RequestInit) => {
      const res = await fetch(path, {
        ...init,
        headers: { "Content-Type": "application/json", "x-admin-secret": secret, ...(init?.headers ?? {}) },
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
    setBusy(true); setNotice(null);
    try { await loadPartners(); setUnlocked(true); }
    catch { setNotice("Wrong secret."); }
    finally { setBusy(false); }
  }

  async function createPartner() {
    if (!npName || !npSlug || !npEmail) return;
    setBusy(true); setNotice(null);
    try {
      await call("/api/admin/partners", { method: "POST", body: JSON.stringify({ name: npName, slug: npSlug, contact_email: npEmail }) });
      setNpName(""); setNpSlug(""); setNpEmail("");
      await loadPartners();
      setNotice("Partner created.");
    } catch (e: any) { setNotice(e.message); }
    finally { setBusy(false); }
  }

  async function topup(sign: 1 | -1) {
    if (!selected) return;
    const pence = Math.round(parseFloat(topupGbp) * 100) * sign;
    if (!Number.isFinite(pence) || pence === 0) return;
    setBusy(true); setNotice(null);
    try {
      await call("/api/admin/partners/topup", { method: "POST", body: JSON.stringify({ partner_id: selected.id, amount_pence: pence, note: topupNote || null }) });
      setTopupGbp(""); setTopupNote("");
      await loadPartners();
      await loadDetail({ ...selected });
      setNotice(sign > 0 ? "Wallet credited." : "Wallet adjusted down.");
    } catch (e: any) { setNotice(e.message); }
    finally { setBusy(false); }
  }

  async function createKey(environment: "test" | "live") {
    if (!selected) return;
    setBusy(true); setNotice(null);
    try {
      const json = await call("/api/admin/partners/keys", { method: "POST", body: JSON.stringify({ partner_id: selected.id, environment }) });
      setFreshKey(json.key);
      await loadDetail({ ...selected });
    } catch (e: any) { setNotice(e.message); }
    finally { setBusy(false); }
  }

  async function revokeKey(keyId: string) {
    if (!selected) return;
    if (!confirm("Revoke this key? Any integration using it stops working immediately.")) return;
    setBusy(true);
    try {
      await call("/api/admin/partners/keys", { method: "DELETE", body: JSON.stringify({ key_id: keyId }) });
      await loadDetail({ ...selected });
    } catch (e: any) { setNotice(e.message); }
    finally { setBusy(false); }
  }

  useEffect(() => {
    if (selected) {
      const fresh = partners.find((p) => p.id === selected.id);
      if (fresh) setSelected(fresh);
    }
  }, [partners]); // eslint-disable-line react-hooks/exhaustive-deps

  const inputStyle = {
    background: C.night,
    border: `1px solid ${C.line}`,
    color: C.paper,
  } as const;

  if (!unlocked) {
    return (
      <main style={{ background: C.night, color: C.paper }} className="min-h-screen flex items-center justify-center p-6">
        <div className="w-full max-w-sm space-y-4">
          <h1 className="text-xl font-semibold" style={{ color: C.tungsten }}>Nolgic · Partner Admin</h1>
          <input
            type="password"
            className="w-full rounded-lg px-3 py-2 outline-none focus:ring-2"
            style={inputStyle}
            placeholder="Admin secret"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && unlock()}
          />
          <button
            onClick={unlock}
            disabled={busy || !secret}
            className="w-full rounded-lg px-3 py-2 font-semibold disabled:opacity-50"
            style={{ background: C.tungsten, color: C.night }}
          >
            {busy ? "Checking..." : "Unlock"}
          </button>
          {notice && <p className="text-sm" style={{ color: C.danger }}>{notice}</p>}
        </div>
      </main>
    );
  }

  return (
    <main style={{ background: C.night, color: C.paper }} className="min-h-screen p-4 md:p-8">
      <div className="max-w-6xl mx-auto space-y-6">
        <header className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">
            <span style={{ color: C.tungsten }}>Nolgic</span> Partners
          </h1>
          {notice && <span className="text-sm" style={{ color: C.tungsten }}>{notice}</span>}
        </header>

        {freshKey && (
          <div className="rounded-xl p-4 space-y-2" style={{ border: `1px solid ${C.ember}`, background: "rgba(255,122,26,0.10)" }}>
            <p className="font-semibold" style={{ color: C.ember }}>New API key — shown once. Copy it now.</p>
            <code className="block break-all text-sm rounded p-2" style={{ background: C.night, color: C.paper }}>{freshKey}</code>
            <div className="flex gap-2">
              <button onClick={() => navigator.clipboard.writeText(freshKey)} className="rounded px-3 py-1 text-sm font-medium" style={{ background: C.ember, color: C.night }}>Copy</button>
              <button onClick={() => setFreshKey(null)} className="rounded px-3 py-1 text-sm" style={{ background: C.panel2, color: C.paper }}>Done</button>
            </div>
          </div>
        )}

        <div className="grid md:grid-cols-3 gap-6">
          {/* partner list + create */}
          <section className="space-y-3">
            {partners.map((p) => {
              const active = selected?.id === p.id;
              return (
                <button
                  key={p.id}
                  onClick={() => loadDetail(p)}
                  className="w-full text-left rounded-xl p-3 transition"
                  style={{
                    border: `1px solid ${active ? C.tungsten : C.line}`,
                    background: active ? "rgba(255,182,39,0.08)" : C.panel,
                  }}
                >
                  <div className="flex justify-between items-baseline">
                    <span className="font-medium">{p.name}</span>
                    <span className="font-mono text-sm" style={{ color: C.tungsten }}>{gbp(p.balance_pence)}</span>
                  </div>
                  <div className="text-xs mt-1" style={{ color: C.haze }}>
                    {p.slug} · today {gbp(p.spent_today_pence)} / {gbp(p.daily_cap_pence)}
                    {p.status !== "active" && <span style={{ color: C.danger }}> · {p.status}</span>}
                  </div>
                </button>
              );
            })}

            <div className="rounded-xl p-3 space-y-2" style={{ border: `1px solid ${C.line}`, background: C.panel }}>
              <p className="text-sm font-medium" style={{ color: C.haze }}>New partner</p>
              <input className="w-full rounded px-2 py-1.5 text-sm outline-none" style={inputStyle} placeholder="Name" value={npName} onChange={(e) => setNpName(e.target.value)} />
              <input className="w-full rounded px-2 py-1.5 text-sm outline-none" style={inputStyle} placeholder="slug (e.g. acme-remit)" value={npSlug} onChange={(e) => setNpSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))} />
              <input className="w-full rounded px-2 py-1.5 text-sm outline-none" style={inputStyle} placeholder="Contact email" value={npEmail} onChange={(e) => setNpEmail(e.target.value)} />
              <button onClick={createPartner} disabled={busy} className="w-full rounded px-2 py-1.5 text-sm font-medium disabled:opacity-50" style={{ background: C.panel2, color: C.paper }}>Create</button>
            </div>
          </section>

          {/* detail */}
          <section className="md:col-span-2 space-y-4">
            {!selected && <p style={{ color: C.haze }}>Select a partner.</p>}

            {selected && (
              <>
                <div className="rounded-xl p-4 space-y-3" style={{ border: `1px solid ${C.line}`, background: C.panel }}>
                  <div className="flex justify-between items-baseline">
                    <h2 className="text-lg font-medium">{selected.name}</h2>
                    <span className="font-mono" style={{ color: C.tungsten }}>{gbp(selected.balance_pence)}</span>
                  </div>
                  <div className="flex flex-wrap gap-2 items-center">
                    <input className="w-28 rounded px-2 py-1.5 text-sm outline-none" style={inputStyle} placeholder="£ amount" value={topupGbp} onChange={(e) => setTopupGbp(e.target.value)} />
                    <input className="flex-1 min-w-40 rounded px-2 py-1.5 text-sm outline-none" style={inputStyle} placeholder="Note (e.g. bank ref)" value={topupNote} onChange={(e) => setTopupNote(e.target.value)} />
                    <button onClick={() => topup(1)} disabled={busy} className="rounded px-3 py-1.5 text-sm font-semibold disabled:opacity-50" style={{ background: C.tungsten, color: C.night }}>Credit</button>
                    <button onClick={() => topup(-1)} disabled={busy} className="rounded px-3 py-1.5 text-sm font-medium disabled:opacity-50" style={{ background: "transparent", color: C.danger, border: `1px solid ${C.danger}` }}>Adjust down</button>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => createKey("test")} disabled={busy} className="rounded px-3 py-1.5 text-sm font-medium" style={{ background: C.panel2, color: C.paper }}>+ Test key</button>
                    <button onClick={() => createKey("live")} disabled={busy} className="rounded px-3 py-1.5 text-sm font-medium" style={{ background: C.ember, color: C.night }}>+ Live key</button>
                  </div>
                </div>

                {!detail && <p className="text-sm" style={{ color: C.haze }}>Loading…</p>}

                {detail && (
                  <>
                    <div className="rounded-xl p-4" style={{ border: `1px solid ${C.line}`, background: C.panel }}>
                      <h3 className="text-sm font-medium mb-2" style={{ color: C.haze }}>API keys</h3>
                      {detail.keys.length === 0 && <p className="text-sm" style={{ color: C.haze }}>None yet.</p>}
                      <ul className="space-y-1">
                        {detail.keys.map((k) => (
                          <li key={k.id} className="flex justify-between items-center text-sm">
                            <span style={k.revoked_at ? { textDecoration: "line-through", color: C.haze } : undefined}>
                              <code>{k.key_prefix}…</code>
                              <span className="ml-2 text-xs font-medium" style={{ color: k.environment === "live" ? C.ember : C.tungsten }}>{k.environment}</span>
                              <span className="ml-2 text-xs" style={{ color: C.haze }}>{k.label}</span>
                            </span>
                            {!k.revoked_at && (
                              <button onClick={() => revokeKey(k.id)} className="text-xs" style={{ color: C.danger }}>revoke</button>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>

                    <div className="rounded-xl p-4 overflow-x-auto" style={{ border: `1px solid ${C.line}`, background: C.panel }}>
                      <h3 className="text-sm font-medium mb-2" style={{ color: C.haze }}>Recent API orders</h3>
                      {detail.orders.length === 0 && <p className="text-sm" style={{ color: C.haze }}>None yet.</p>}
                      <table className="w-full text-xs">
                        <tbody>
                          {detail.orders.map((o) => (
                            <tr key={o.id} style={{ borderTop: `1px solid ${C.line}` }}>
                              <td className="py-1.5 pr-2 whitespace-nowrap" style={{ color: C.haze }}>{new Date(o.created_at).toLocaleString("en-GB")}</td>
                              <td className="py-1.5 pr-2">{o.biller_name}</td>
                              <td className="py-1.5 pr-2 font-mono">{o.identifier}</td>
                              <td className="py-1.5 pr-2 whitespace-nowrap">₦{Number(o.amount_ngn).toLocaleString()} / {gbp(o.amount_gbp_pence)}</td>
                              <td className="py-1.5 font-medium" style={{ color: o.status === "fulfilled" ? C.tungsten : o.status === "paid" ? C.ember : C.danger }}>{o.status}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <div className="rounded-xl p-4 overflow-x-auto" style={{ border: `1px solid ${C.line}`, background: C.panel }}>
                      <h3 className="text-sm font-medium mb-2" style={{ color: C.haze }}>Ledger</h3>
                      {detail.ledger.length === 0 && <p className="text-sm" style={{ color: C.haze }}>Empty.</p>}
                      <table className="w-full text-xs">
                        <tbody>
                          {detail.ledger.map((l) => (
                            <tr key={l.id} style={{ borderTop: `1px solid ${C.line}` }}>
                              <td className="py-1.5 pr-2 whitespace-nowrap" style={{ color: C.haze }}>{new Date(l.created_at).toLocaleString("en-GB")}</td>
                              <td className="py-1.5 pr-2">{l.entry_type}</td>
                              <td className="py-1.5 pr-2 font-mono" style={{ color: l.amount_pence >= 0 ? C.tungsten : C.danger }}>{gbp(l.amount_pence)}</td>
                              <td className="py-1.5 pr-2 font-mono" style={{ color: C.haze }}>{gbp(l.balance_after_pence)}</td>
                              <td className="py-1.5" style={{ color: C.haze }}>{l.note}</td>
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
