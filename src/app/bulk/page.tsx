"use client";

import { useMemo, useRef, useState } from "react";
import {
  NETWORKS, BULK_MIN_EACH, BULK_MAX_EACH, BULK_MAX_RECIPIENTS, BULK_MAX_TOTAL, BULK_FIRST_CAP,
  bulkFee, checkRows, localPhone, parseBulkText, type DraftRow,
} from "@/lib/bulk-shared";
import BackSoon, { isBackSoon } from "@/components/BackSoon";

const ENABLED = process.env.NEXT_PUBLIC_BULK_ENABLED === "1";
const naira = (n: number) => `₦${Math.round(n).toLocaleString("en-NG")}`;

export default function BulkPage() {
  const [rows, setRows] = useState<DraftRow[]>([]);
  const [paste, setPaste] = useState("");
  const [defAmount, setDefAmount] = useState("");
  const [email, setEmail] = useState("");
  const [notes, setNotes] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const checked = useMemo(() => checkRows(rows), [rows]);
  const total = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const fee = rows.length ? bulkFee(total) : 0;

  function addFrom(text: string) {
    const { rows: add, skipped } = parseBulkText(text, Math.round(Number(defAmount)) || 0);
    const msgs: string[] = [];
    if (skipped.length) msgs.push(`Skipped ${skipped.length} line${skipped.length > 1 ? "s" : ""} that don't look like a Nigerian mobile number: ${skipped.slice(0, 3).join(" · ")}${skipped.length > 3 ? " …" : ""}`);
    if (rows.length + add.length > BULK_MAX_RECIPIENTS) msgs.push(`Only the first ${BULK_MAX_RECIPIENTS} numbers were kept.`);
    setNotes(msgs);
    if (!add.length) return;
    setRows((cur) => [...cur, ...add].slice(0, BULK_MAX_RECIPIENTS));
    setPaste("");
  }

  function patch(i: number, p: Partial<DraftRow>) {
    setRows((cur) => cur.map((r, j) => (j === i ? { ...r, ...p } : r)));
  }

  async function onFile(f: File | undefined) {
    if (!f) return;
    if (f.size > 200_000) { setError("That file is too big. Use a plain list of numbers."); return; }
    addFrom(await f.text());
    if (fileRef.current) fileRef.current.value = "";
  }

  async function pay() {
    setError("");
    if (!checked.ok) { setError(checked.error); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) { setError("Enter your email address so we can send the receipt."); return; }
    setBusy(true);
    try {
      const r = await fetch("/api/bulk/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), recipients: checked.rows }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.url) { setError(d.error ?? "Something went wrong. Please try again."); setBusy(false); return; }
      window.location.href = d.url;
    } catch {
      setError("Couldn't reach Nolgic. Check your connection and try again.");
      setBusy(false);
    }
  }

  if (!ENABLED) {
    return (
      <main id="content" className="max-w-xl mx-auto px-5 pt-16 pb-24">
        <h1 className="font-display font-bold text-3xl mt-10">Bulk airtime is opening soon</h1>
        <p className="text-haze mt-3 text-lg leading-relaxed">Top up many numbers in one payment. Check back shortly.</p>
        <a href="/" className="inline-block mt-8 h-12 leading-[3rem] px-6 rounded-xl bg-cta text-oncta font-display font-bold">Back to Nolgic</a>
      </main>
    );
  }

  return (
    <main id="content" className="max-w-3xl mx-auto px-5 pt-8 pb-28">
      <h1 className="font-display font-bold text-3xl sm:text-4xl leading-tight tracking-tight mt-8">Bulk airtime</h1>
      <p className="text-haze mt-3 text-lg leading-relaxed max-w-xl">
        Top up many phones with one payment. Any number that fails is refunded automatically, and you see the result for every number.
      </p>

      <section className="mt-8 rounded-3xl border border-line bg-panel p-5 sm:p-6">
        <h2 className="font-display font-bold text-lg">Add numbers</h2>
        <p className="text-haze text-sm mt-1 leading-relaxed">
          One per line, with the amount after the number, like <span className="num text-paper">08031234567 500</span>. Add a network at the end
          (mtn, glo, airtel, 9mobile) if you know it; otherwise we guess from the number and you can change it below.
        </p>
        <label className="sr-only" htmlFor="paste">Numbers</label>
        <textarea
          id="paste" value={paste} onChange={(e) => setPaste(e.target.value)} rows={5}
          placeholder={"08031234567 500\n08051234568 1000 glo\n07011234569 200"}
          className="mt-4 w-full rounded-2xl bg-sunk border border-line p-4 font-mono text-[15px] focus:outline-none focus:ring-2 focus:ring-cta/60"
        />
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor="defamt" className="block text-sm text-haze">Amount for lines without one</label>
            <input
              id="defamt" inputMode="numeric" value={defAmount} onChange={(e) => setDefAmount(e.target.value.replace(/\D/g, ""))}
              placeholder="e.g. 500" className="mt-1 h-11 w-36 rounded-xl bg-sunk border border-line px-3 num focus:outline-none focus:ring-2 focus:ring-cta/60"
            />
          </div>
          <button type="button" onClick={() => addFrom(paste)} disabled={!paste.trim()}
            className="h-11 px-5 rounded-xl bg-cta text-oncta font-display font-bold disabled:opacity-40">Add to list</button>
          <button type="button" onClick={() => fileRef.current?.click()}
            className="h-11 px-5 rounded-xl border border-line text-paper font-medium hover:bg-sunk">Upload a CSV or text file</button>
          <input ref={fileRef} type="file" accept=".csv,.txt,text/csv,text/plain" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
        </div>
        {notes.map((n, i) => <p key={i} className="text-sm text-tungsten mt-3" role="status">{n}</p>)}
      </section>

      {rows.length > 0 && (
        <section className="mt-6 rounded-3xl border border-line bg-panel shadow-card">
          <div className="p-5 sm:p-6 flex items-baseline justify-between gap-4">
            <h2 className="font-display font-bold text-lg">Your list <span className="text-haze font-normal">({rows.length})</span></h2>
            <button type="button" onClick={() => setRows([])} className="text-sm text-haze hover:text-paper underline underline-offset-4">Clear all</button>
          </div>
          <ul className="divide-y divide-line border-t border-line">
            {rows.map((r, i) => {
              const bad = !localPhone(r.phone);
              return (
                <li key={i} className="px-5 sm:px-6 py-3 grid grid-cols-[1fr_auto] sm:grid-cols-[1.3fr_1fr_1fr_auto] gap-x-3 gap-y-2 items-center">
                  <div className="min-w-0">
                    <label className="sr-only" htmlFor={`p${i}`}>Phone number {i + 1}</label>
                    <input id={`p${i}`} value={r.phone} onChange={(e) => patch(i, { phone: e.target.value })} inputMode="tel"
                      className={`w-full h-11 rounded-xl bg-sunk border px-3 num ${bad ? "border-bad" : "border-line"} focus:outline-none focus:ring-2 focus:ring-cta/60`} />
                  </div>
                  <button type="button" aria-label={`Remove number ${i + 1}`} onClick={() => setRows((c) => c.filter((_, j) => j !== i))}
                    className="sm:order-4 h-11 w-11 rounded-xl text-haze hover:text-bad hover:bg-sunk text-xl leading-none">×</button>
                  <div className="relative">
                    <label className="sr-only" htmlFor={`a${i}`}>Amount for number {i + 1}</label>
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-haze" aria-hidden="true">₦</span>
                    <input id={`a${i}`} value={r.amount || ""} inputMode="numeric" onChange={(e) => patch(i, { amount: Number(e.target.value.replace(/\D/g, "")) })}
                      className="w-full h-11 rounded-xl bg-sunk border border-line pl-7 pr-3 num focus:outline-none focus:ring-2 focus:ring-cta/60" />
                  </div>
                  <div>
                    <label className="sr-only" htmlFor={`n${i}`}>Network for number {i + 1}</label>
                    <select id={`n${i}`} value={r.network} onChange={(e) => patch(i, { network: e.target.value as DraftRow["network"] })}
                      className={`w-full h-11 rounded-xl bg-sunk border px-3 ${r.network ? "border-line" : "border-bad"} focus:outline-none focus:ring-2 focus:ring-cta/60`}>
                      <option value="">Choose network</option>
                      {NETWORKS.map((n) => <option key={n.code} value={n.code}>{n.label}</option>)}
                    </select>
                  </div>
                </li>
              );
            })}
          </ul>
          <div className="tear bg-sunk rounded-b-3xl p-5 sm:p-6 space-y-2 text-[15px]">
            <div className="flex justify-between"><span className="text-haze">Airtime ({rows.length} numbers)</span><span className="num">{naira(total)}</span></div>
            <div className="flex justify-between"><span className="text-haze">Service fee</span><span className="num">{naira(fee)}</span></div>
            <div className="flex justify-between items-baseline pt-2 border-t border-line">
              <span className="font-semibold">You pay</span><span className="num font-display font-bold text-2xl">{naira(total + fee)}</span>
            </div>
          </div>
        </section>
      )}

      {rows.length > 0 && (
        <section className="mt-6">
          <label htmlFor="email" className="block font-medium">Your email</label>
          <p className="text-sm text-haze mt-0.5">We send the receipt here, including anything refunded.</p>
          <input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)}
            className="mt-2 w-full h-12 rounded-xl bg-sunk border border-line px-4 focus:outline-none focus:ring-2 focus:ring-cta/60" />
          {error && isBackSoon(error) && <BackSoon className="mt-3" />}
          {error && !isBackSoon(error) && <p className="text-bad mt-3" role="alert">{error}</p>}
          <button type="button" onClick={pay} disabled={busy}
            className="mt-5 w-full sm:w-auto h-14 px-8 rounded-2xl bg-cta text-oncta font-display font-bold text-lg disabled:opacity-50">
            {busy ? "Opening secure checkout…" : `Pay ${naira(total + fee)}`}
          </button>
          <p className="text-sm text-haze mt-3 leading-relaxed">
            Limits: {naira(BULK_MIN_EACH)} to {naira(BULK_MAX_EACH)} per number, up to {BULK_MAX_RECIPIENTS} numbers and {naira(BULK_MAX_TOTAL)} per batch.
            Your first batch can be up to {naira(BULK_FIRST_CAP)}. Check the network for each number, because a number on a different network may fail.
          </p>
        </section>
      )}
      {!rows.length && error && isBackSoon(error) && <BackSoon />}
      {!rows.length && error && !isBackSoon(error) && <p className="text-bad mt-4" role="alert">{error}</p>}
    </main>
  );
}
