"use client";

import { useEffect, useMemo, useState } from "react";
import BackSoon, { isBackSoon } from "@/components/BackSoon";

const ENABLED = process.env.NEXT_PUBLIC_EXAMS_ENABLED === "1";
const naira = (n: number) => `₦${Math.round(n).toLocaleString("en-NG")}`;

type Item = { code: string; name: string; price: number };
type Group = { service: string; title: string; idLabel: string; idHint: string; items: Item[] };
type Cfg = { enabled: boolean; unavailable?: boolean; fee: { pct: number; min: number; max: number }; groups: Group[] };

const feeFor = (c: Cfg, price: number) => Math.min(c.fee.max, Math.max(c.fee.min, Math.round((price * c.fee.pct) / 100)));

export default function ExamsPage() {
  const [cfg, setCfg] = useState<Cfg | null>(null);
  const [service, setService] = useState("");
  const [code, setCode] = useState("");
  const [id1, setId1] = useState("");
  const [id2, setId2] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!ENABLED) return;
    fetch("/api/exams").then((r) => r.json()).then((d: Cfg) => {
      setCfg(d);
      if (d.groups?.length === 1) setService(d.groups[0].service);
    }).catch(() => setCfg({ enabled: false, unavailable: true, fee: { pct: 0, min: 0, max: 0 }, groups: [] }));
  }, []);

  const group = useMemo(() => cfg?.groups.find((g) => g.service === service) ?? null, [cfg, service]);
  const item = useMemo(() => group?.items.find((i) => i.code === code) ?? null, [group, code]);
  const fee = cfg && item ? feeFor(cfg, item.price) : 0;
  const idClean = id1.replace(/\s+/g, "");
  const idMatch = !!idClean && idClean === id2.replace(/\s+/g, "");

  async function pay() {
    setError("");
    if (!group || !item) { setError("Choose the PIN you want first."); return; }
    if (!idClean) { setError(`Enter the ${group.idLabel.toLowerCase()}.`); return; }
    if (!idMatch) { setError(`The two ${group.idLabel.toLowerCase()} entries don't match.`); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) { setError("Enter your email address. We send the PIN there as well."); return; }
    setBusy(true);
    try {
      const r = await fetch("/api/exams/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ service: group.service, code: item.code, identifier: idClean, email: email.trim() }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.url) { setError(d.error ?? "Something went wrong. Please try again."); setBusy(false); return; }
      window.location.href = d.url;
    } catch {
      setError("Couldn't reach Nolgic. Check your connection and try again.");
      setBusy(false);
    }
  }

  if (!ENABLED || (cfg && !cfg.enabled)) {
    return (
      <main id="content" className="max-w-xl mx-auto px-5 pt-16 pb-24">
        <h1 className="font-display font-bold text-3xl mt-10">{cfg?.unavailable ? "Exam PINs are unavailable right now" : "Exam PINs are opening soon"}</h1>
        <p className="text-haze mt-3 text-lg leading-relaxed">JAMB and WAEC PINs, paid in naira. Check back shortly.</p>
        <a href="/" className="inline-block mt-8 h-12 leading-[3rem] px-6 rounded-xl bg-cta text-oncta font-display font-bold">Back to Nolgic</a>
      </main>
    );
  }

  return (
    <main id="content" className="max-w-xl mx-auto px-5 pt-8 pb-28">
      <h1 className="font-display font-bold text-3xl sm:text-4xl leading-tight tracking-tight mt-8">JAMB and WAEC PINs</h1>
      <p className="text-haze mt-3 text-lg leading-relaxed">
        Pay in naira and get the PIN on screen and by email. If we can&rsquo;t deliver it, you&rsquo;re refunded in full.
      </p>

      {!cfg && <div className="mt-8 h-40 rounded-3xl bg-sunk" aria-busy="true"><span className="sr-only">Loading PINs…</span></div>}
      {cfg && !cfg.groups.length && (
        <p className="mt-8 text-haze" role="status">No PINs are available right now. Please try again in a few minutes.</p>
      )}

      {cfg && cfg.groups.length > 0 && (
        <>
          <section className="mt-8 rounded-3xl border border-line bg-panel p-5 sm:p-6">
            <div role="radiogroup" aria-labelledby="which-pin">
              <h2 id="which-pin" className="font-display font-bold text-lg">Which PIN?</h2>
              <div className="mt-3 grid gap-2">
                {cfg.groups.map((g) => {
                  const on = service === g.service;
                  return (
                    <button key={g.service} type="button" role="radio" aria-checked={on}
                      onClick={() => { setService(g.service); setCode(""); setId1(""); setId2(""); }}
                      className={`flex items-center gap-3 rounded-2xl border px-4 min-h-[3.25rem] text-left focus:outline-none focus:ring-2 focus:ring-cta/60 ${on ? "border-cta bg-cta/10" : "border-line bg-sunk hover:bg-panel"}`}>
                      <span aria-hidden="true" className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${on ? "border-cta" : "border-haze"}`}>
                        {on && <span className="h-2.5 w-2.5 rounded-full bg-cta" />}
                      </span>
                      <span className="font-medium">{g.title}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {group && (
              <div className="mt-5">
                <label htmlFor="exam" className="block font-medium">Type</label>
                <select id="exam" value={code} onChange={(e) => setCode(e.target.value)}
                  className="mt-2 w-full h-12 rounded-xl bg-sunk border border-line px-3 focus:outline-none focus:ring-2 focus:ring-cta/60">
                  <option value="">Choose one</option>
                  {group.items.map((i) => <option key={i.code} value={i.code}>{i.name} — {naira(i.price)}</option>)}
                </select>
              </div>
            )}
          </section>

          {group && item && (
            <section className="mt-6">
              <label htmlFor="id1" className="block font-medium">{group.idLabel}</label>
              <p className="text-sm text-haze mt-0.5 leading-relaxed">{group.idHint}</p>
              <input id="id1" autoComplete="off" autoCapitalize="characters" value={id1} onChange={(e) => setId1(e.target.value)}
                className="mt-2 w-full h-12 rounded-xl bg-sunk border border-line px-4 num focus:outline-none focus:ring-2 focus:ring-cta/60" />
              <label htmlFor="id2" className="block font-medium mt-4">Type it again to confirm</label>
              <input id="id2" autoComplete="off" autoCapitalize="characters" value={id2} onChange={(e) => setId2(e.target.value)}
                className={`mt-2 w-full h-12 rounded-xl bg-sunk border px-4 num focus:outline-none focus:ring-2 focus:ring-cta/60 ${id2 && !idMatch ? "border-bad" : "border-line"}`} />
              {id2 && !idMatch && <p className="text-sm text-bad mt-1" role="status">These don&rsquo;t match yet.</p>}

              <label htmlFor="email" className="block font-medium mt-6">Your email</label>
              <p className="text-sm text-haze mt-0.5">We send the PIN and receipt here.</p>
              <input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)}
                className="mt-2 w-full h-12 rounded-xl bg-sunk border border-line px-4 focus:outline-none focus:ring-2 focus:ring-cta/60" />

              <div className="tear bg-sunk rounded-3xl p-5 mt-6 space-y-2 text-[15px]">
                <div className="flex justify-between gap-4"><span className="text-haze">{item.name}</span><span className="num">{naira(item.price)}</span></div>
                <div className="flex justify-between"><span className="text-haze">Service fee</span><span className="num">{naira(fee)}</span></div>
                <div className="flex justify-between items-baseline pt-2 border-t border-line">
                  <span className="font-semibold">You pay</span><span className="num font-display font-bold text-2xl">{naira(item.price + fee)}</span>
                </div>
              </div>

              {error && isBackSoon(error) && <BackSoon />}
              {error && !isBackSoon(error) && <p className="text-bad mt-4" role="alert">{error}</p>}
              <button type="button" onClick={pay} disabled={busy}
                className="mt-5 w-full h-14 px-8 rounded-2xl bg-cta text-oncta font-display font-bold text-lg disabled:opacity-50">
                {busy ? "Opening secure checkout…" : `Pay ${naira(item.price + fee)}`}
              </button>
              <p className="text-sm text-haze mt-3 leading-relaxed">
                A PIN can be used once and can&rsquo;t be exchanged after it is issued, so check the details above before you pay.
              </p>
            </section>
          )}
          {!item && error && isBackSoon(error) && <BackSoon />}
          {!item && error && !isBackSoon(error) && <p className="text-bad mt-4" role="alert">{error}</p>}
        </>
      )}
    </main>
  );
}
