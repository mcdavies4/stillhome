"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { readSaved, tail, writeSaved, type Saved } from "@/lib/saved";
import { track } from "@/lib/track";
import { ACCT_EMAIL_KEY } from "@/lib/account-client";
import { recentMonths } from "@/lib/statement-months";
import type { Topup } from "@/lib/topups";

type Order = { id: string; name: string; tail: string; amountNgn: number; status: string; statusText: string; at: string };
type Me = { email: string; orders: Order[]; saved: Saved[]; topups?: Topup[] };

const naira = (n: number) => `₦${Math.round(n).toLocaleString("en-NG")}`;
const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
const post = (url: string, body: unknown) => fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

// Your Nolgic account: sign in with a code we email you. Order history, and saved meters that follow you to any device.
export default function Account() {
  const [step, setStep] = useState<"loading" | "email" | "code" | "in" | "off">("loading");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [hp, setHp] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [me, setMe] = useState<Me | null>(null);
  const months = recentMonths(Date.now(), 12);
  const [month, setMonth] = useState(months[0].key);
  const [dl, setDl] = useState<"" | "pdf" | "csv">("");
  const [dlError, setDlError] = useState("");

  // Signed in: copy this device's saved list up, then keep the server's list (now the full one) on this device too.
  const load = useCallback(async (syncLocal: boolean) => {
    const r = await fetch("/api/account/me", { cache: "no-store" });
    if (r.status === 401) { setStep("email"); return; }
    if (!r.ok) { setError("We couldn't load your account. Refresh to try again."); setStep("email"); return; }
    let d: Me = await r.json();
    if (syncLocal) {
      const local = readSaved();
      if (local.length) {
        const a = await post("/api/account/saved", { action: "add", items: local }).then((x) => (x.ok ? x.json() : null)).catch(() => null);
        if (a?.saved) d = { ...d, saved: a.saved };
      }
    }
    writeSaved(d.saved);
    try { localStorage.setItem(ACCT_EMAIL_KEY, d.email); } catch { /* ignore */ }
    setMe(d); setStep("in");
  }, []);

  useEffect(() => { load(true).catch(() => setStep("email")); }, [load]);

  async function sendCode(e?: React.FormEvent) {
    e?.preventDefault(); if (busy) return;
    setBusy(true); setError("");
    try {
      const r = await post("/api/account/request", { email, website: hp });
      const d = await r.json().catch(() => ({}));
      if (r.status === 503) { setStep("off"); return; }
      if (!r.ok) { setError(d.error ?? "Something went wrong. Please try again."); return; }
      track("account_code_sent"); setCode(""); setStep("code");
    } catch { setError("Can't reach Nolgic. Check your connection and try again."); } finally { setBusy(false); }
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault(); if (busy) return;
    setBusy(true); setError("");
    try {
      const r = await post("/api/account/verify", { email, code });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setError(d.error ?? "That code isn't right."); return; }
      track("account_signin"); await load(true);
    } catch { setError("Can't reach Nolgic. Check your connection and try again."); } finally { setBusy(false); }
  }

  async function signOut() {
    await post("/api/account/logout", {}).catch(() => null);
    try { localStorage.removeItem(ACCT_EMAIL_KEY); } catch { /* ignore */ }
    setMe(null); setEmail(""); setCode(""); setStep("email");
  }

  async function removeOne(s: Saved) {
    if (!me) return;
    setMe({ ...me, saved: me.saved.filter((x) => x.id !== s.id) });
    writeSaved(readSaved().filter((x) => x.id !== s.id));
    await post("/api/account/saved", { action: "remove", id: s.id }).catch(() => null);
  }

  const soon = (t: Topup) => (t.daysLeft <= 0 ? "Probably running low now" : t.daysLeft === 1 ? "Likely to run low tomorrow" : `Likely to run low in about ${t.daysLeft} days`);
  function payTopup(t: Topup) {
    const s = me?.saved.find((x) => x.id === t.savedId);
    if (s) payOne(s);
  }

  function payOne(s: Saved) {
    track("account_pay", s.tab);
    post("/api/account/saved", { action: "touch", id: s.id }).catch(() => null);
    window.location.href = `/?pay=${encodeURIComponent(s.id)}#pay`;
  }

  // Downloads go through the page so an ended session or a server error shows a message instead of saving an error file.
  async function download(format: "pdf" | "csv") {
    if (dl) return;
    setDl(format); setDlError(""); track("account_statement", format);
    try {
      const r = await fetch(`/api/account/statement?month=${encodeURIComponent(month)}&format=${format}`, { cache: "no-store" });
      if (r.status === 401) { setMe(null); setStep("email"); setError("Your session has ended. Sign in again to download."); return; }
      if (!r.ok) { const d = await r.json().catch(() => ({})); setDlError(d.error ?? "We couldn't build that statement. Try again."); return; }
      const url = URL.createObjectURL(await r.blob());
      const a = document.createElement("a"); a.href = url; a.download = `nolgic-statement-${month}.${format}`; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    } catch { setDlError("Can't reach Nolgic. Check your connection and try again."); } finally { setDl(""); }
  }

  const btn = "h-12 px-6 rounded-xl bg-cta text-oncta font-display font-bold hover:brightness-105 active:brightness-95 disabled:opacity-50";

  return (
    <main id="content" className="max-w-xl mx-auto px-5 pt-12 pb-24">
      <h1 className="font-display font-extrabold text-3xl sm:text-4xl leading-tight tracking-tight">Your account</h1>

      {step === "loading" && <p className="mt-6 text-haze" role="status">Loading…</p>}

      {step === "off" && (
        <p className="mt-6 text-haze text-lg leading-relaxed" role="status">Accounts aren&rsquo;t open yet. You can still pay without one, and <Link href="/find-order" className="underline">find an order</Link> by email.</p>
      )}

      {step === "email" && (
        <form onSubmit={sendCode} className="mt-4">
          <p className="text-haze text-lg leading-relaxed">See your orders and keep your meters, smartcards and numbers on every device. No password. We email you a code.</p>
          <label htmlFor="acct-email" className="mt-6">Your email</label>
          <input id="acct-email" type="email" inputMode="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
          <input type="text" tabIndex={-1} autoComplete="off" aria-hidden="true" value={hp} onChange={(e) => setHp(e.target.value)} style={{ position: "absolute", left: "-9999px", width: 1, height: 1, opacity: 0 }} name="website" />
          {error && <p className="text-bad text-sm mt-2" role="alert">{error}</p>}
          <button type="submit" disabled={busy || !email} className={`mt-4 ${btn}`}>{busy ? "Sending…" : "Email me a code"}</button>
          <p className="text-haze text-sm mt-4 leading-relaxed">Use the email you pay with, so your past orders show up. Paying never needs an account.</p>
        </form>
      )}

      {step === "code" && (
        <form onSubmit={verify} className="mt-4">
          <p className="text-haze text-lg leading-relaxed">We sent a 6-digit code to <span className="text-paper font-medium break-all">{email}</span>. It can take a minute, and it may land in spam.</p>
          <label htmlFor="acct-code" className="mt-6">Code</label>
          <input id="acct-code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]*" maxLength={6} required value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} placeholder="123456" className="tracking-[0.4em] text-xl" />
          {error && <p className="text-bad text-sm mt-2" role="alert">{error}</p>}
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="submit" disabled={busy || code.length !== 6} className={btn}>{busy ? "Checking…" : "Sign in"}</button>
            <button type="button" onClick={() => { setError(""); setStep("email"); }} className="h-12 px-5 rounded-xl border border-paper/25 font-semibold hover:bg-sunk">Use another email</button>
            <button type="button" onClick={() => sendCode()} disabled={busy} className="h-12 px-5 rounded-xl border border-paper/25 font-semibold hover:bg-sunk disabled:opacity-50">Send again</button>
          </div>
        </form>
      )}

      {step === "in" && me && (
        <>
          <p className="mt-2 text-haze">Signed in as <span className="text-paper font-medium break-all">{me.email}</span> · <button type="button" onClick={signOut} className="underline">Sign out</button></p>

          {!!me.topups?.length && (
            <section className="mt-9" aria-labelledby="acct-low">
              <h2 id="acct-low" className="font-display font-bold text-xl">Running low soon</h2>
              <ul className="mt-3 divide-y divide-line border-y border-line">
                {me.topups.map((t) => (
                  <li key={t.orderId} className="py-3 flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold leading-tight truncate">{t.name} {t.tail}</p>
                      <p className="text-sm text-haze leading-tight mt-0.5">{soon(t)}. {t.basis === "own history" ? `You usually top up about every ${t.gapDays} days.` : `Most people top up about every ${t.gapDays} days.`}</p>
                    </div>
                    {t.savedId ? (
                      <button type="button" onClick={() => payTopup(t)} className="h-11 px-5 rounded-xl bg-cta text-oncta font-display font-bold hover:brightness-105 active:brightness-95">{t.kind === "tv" ? "Renew" : "Top up"}</button>
                    ) : (
                      <Link href={`/order/${t.orderId}`} className="h-11 px-4 rounded-xl border border-paper/25 font-semibold hover:bg-sunk inline-flex items-center">Last receipt</Link>
                    )}
                  </li>
                ))}
              </ul>
              <p className="text-haze text-xs mt-2 leading-relaxed">An estimate from how often you have paid before. Save the meter from its receipt to get a one-tap button here.</p>
            </section>
          )}

          <section className="mt-9" aria-labelledby="acct-saved">
            <h2 id="acct-saved" className="font-display font-bold text-xl">Saved meters, cards and numbers</h2>
            {me.saved.length === 0 ? (
              <p className="text-haze mt-2 leading-relaxed">Nothing saved yet. After a bill is delivered, tap <strong>Save</strong> on the receipt page and it will show up here on every device.</p>
            ) : (
              <ul className="mt-3 divide-y divide-line border-y border-line">
                {me.saved.map((s) => (
                  <li key={s.id} className="py-3 flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold leading-tight truncate">{s.nickname}</p>
                      <p className="text-sm text-haze leading-tight mt-0.5 truncate">{s.billerName ? s.billerName.replace(/\s*(PREPAID|POSTPAID)$/i, "") : s.label} {tail(s.identifier)}</p>
                    </div>
                    <button type="button" onClick={() => payOne(s)} className="h-11 px-5 rounded-xl bg-cta text-oncta font-display font-bold hover:brightness-105 active:brightness-95">Pay</button>
                    <button type="button" onClick={() => removeOne(s)} aria-label={`Remove ${s.nickname}`} className="w-10 h-11 flex items-center justify-center text-haze hover:text-bad">
                      <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" /></svg>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-haze text-xs mt-2 leading-relaxed">We keep only the number and provider. We check the account name again every time, before you pay.</p>
          </section>

          <section className="mt-10" aria-labelledby="acct-statement">
            <h2 id="acct-statement" className="font-display font-bold text-xl">Statements</h2>
            <p className="text-haze mt-2 leading-relaxed">Every bill you paid in a month, for your records or your accountant. Open the CSV in Excel or Google Sheets.</p>
            <div className="mt-3 flex flex-wrap items-end gap-3">
              <div>
                <label htmlFor="stmt-month">Month</label>
                <select id="stmt-month" value={month} onChange={(e) => setMonth(e.target.value)}>
                  {months.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
                </select>
              </div>
              <button type="button" onClick={() => download("pdf")} disabled={!!dl} className="h-12 px-5 rounded-xl bg-cta text-oncta font-display font-bold hover:brightness-105 active:brightness-95 disabled:opacity-50">{dl === "pdf" ? "Preparing…" : "Download PDF"}</button>
              <button type="button" onClick={() => download("csv")} disabled={!!dl} className="h-12 px-5 rounded-xl border border-paper/25 font-semibold hover:bg-sunk disabled:opacity-50">{dl === "csv" ? "Preparing…" : "Download CSV"}</button>
            </div>
            {dlError && <p className="text-bad text-sm mt-2" role="alert">{dlError}</p>}
            <p className="text-haze text-xs mt-2 leading-relaxed">Months are Nigerian time. Meter tokens and PINs are never included.</p>
          </section>

          <section className="mt-10" aria-labelledby="acct-orders">
            <h2 id="acct-orders" className="font-display font-bold text-xl">Your orders</h2>
            {me.orders.length === 0 ? (
              <p className="text-haze mt-2 leading-relaxed">No orders on this email in the last year. If you paid with another email, <Link href="/find-order" className="underline">find an order</Link> by that one.</p>
            ) : (
              <ul className="mt-3 divide-y divide-line border-y border-line">
                {me.orders.map((o) => (
                  <li key={o.id}>
                    <Link href={`/order/${o.id}`} className="py-3 flex items-center gap-3 hover:bg-sunk -mx-2 px-2 rounded-lg">
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold leading-tight truncate">{o.name} <span className="num">{naira(o.amountNgn)}</span></p>
                        <p className="text-sm text-haze leading-tight mt-0.5 truncate">{day(o.at)}{o.tail ? ` · ${o.tail}` : ""} · {o.statusText}</p>
                      </div>
                      <span className="text-sm font-semibold">Receipt</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </main>
  );
}
