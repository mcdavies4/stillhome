"use client";

import { track } from "@/lib/track";
import { useEffect, useMemo, useState } from "react";
import { ngnMaxOrder, ngnServiceFee, feeKindOf } from "@/lib/ngn-fee";
import { clearDraft, readDraft, writeDraft } from "@/lib/payforme-draft";
import { PFM_MAX_ITEMS, PFM_NOTE_MAX, PFM_TABS, pfmMoney, pfmNoValidate, pfmTitle, requestShareText, waShareUrl, type PfmBiller } from "@/lib/payforme-shared";

type Entry = { billerCode: string; itemCode: string; billerName: string; itemName: string; identifier: string; identifierLabel: string; amount: number; name: string | null; fee: number };
type Saved = { id: string; key: string; name: string; total: number; at: number };

const LS = "nolgic.pfm.v1";
const niceName = (n: string) => n.replace(/\s+VTU$/i, "");
const itemKey = (i: PfmBiller) => `${i.biller_code}:${i.item_code}:${i.short_name ?? i.name}`;
const clean = (v: string, phone: boolean) => (phone ? v.replace(/[^\d+]/g, "").replace(/(?!^)\+/g, "") : v.replace(/[\s\-]/g, ""));
const LABELS: Record<string, { provider: string; plan: string }> = {
  electricity: { provider: "Electricity company", plan: "Meter type" },
  cable: { provider: "TV provider", plan: "Package" },
  airtime: { provider: "Network", plan: "Amount" },
  data: { provider: "Network or provider", plan: "Data plan" },
};
const QUICK = [500, 1000, 2000, 5000];

const readSaved = (): Saved[] => { try { const v = JSON.parse(localStorage.getItem(LS) || "[]"); return Array.isArray(v) ? v.slice(0, 10) : []; } catch { return []; } };
const writeSaved = (s: Saved[]) => { try { localStorage.setItem(LS, JSON.stringify(s.slice(0, 10))); } catch { /* private window */ } };

export default function AskClient() {
  const [all, setAll] = useState<PfmBiller[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadErr, setLoadErr] = useState("");

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [list, setList] = useState<Entry[]>([]);

  const [tab, setTab] = useState("electricity");
  const [provider, setProvider] = useState("");
  const [item, setItem] = useState<PfmBiller | null>(null);
  const [identifier, setIdentifier] = useState("");
  const [amount, setAmount] = useState("");
  const [checked, setChecked] = useState<{ name: string | null } | null>(null);
  const [busy, setBusy] = useState<"check" | "create" | null>(null);
  const [err, setErr] = useState("");
  const [done, setDone] = useState<{ id: string; key: string; total: number; count: number } | null>(null);
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState<Saved[]>([]);
  const [ready, setReady] = useState(false);          // the saved draft has been read (don't overwrite it before that)
  const [restored, setRestored] = useState(false);     // show "your list is still here" once

  useEffect(() => {
    setSaved(readSaved());
    // Pick up the list where they left it. The fee is worked out again, so it is always today's fee.
    const d = readDraft();
    if (d) {
      setName(d.name); setEmail(d.email); setNote(d.note);
      setList(d.list.map((e) => ({ ...e, fee: ngnServiceFee(e.amount, feeKindOf({ biller_code: e.billerCode, item_code: e.itemCode, biller_name: e.billerName, name: e.itemName } as any)) })));
      if (d.list.length) setRestored(true);
    }
    setReady(true);
    fetch("/api/billers?country=NG")
      .then(async (r) => ({ ok: r.ok, d: await r.json().catch(() => ({})) }))
      .then(({ ok, d }) => { setAll(d.items ?? []); setLoaded(true); if (!ok || !(d.items ?? []).length) setLoadErr("We couldn't load the list of services. Refresh the page to try again."); })
      .catch(() => { setLoaded(true); setLoadErr("We couldn't load the list of services. Refresh the page to try again."); });
  }, []);

  // Keep the draft up to date as they type, add and remove. Nothing left = nothing saved.
  useEffect(() => {
    if (!ready || done) return;
    writeDraft({ name, email, note, list: list.map(({ fee: _fee, ...e }) => e) });
  }, [ready, done, name, email, note, list]);

  const providers = useMemo(() => {
    const t = PFM_TABS.find((x) => x.key === tab)!;
    const m = new Map<string, PfmBiller[]>();
    for (const i of all.filter(t.match)) { const a = m.get(i.biller_name); if (a) a.push(i); else m.set(i.biller_name, [i]); }
    return Array.from(m.entries()).sort((a, b) => niceName(a[0]).localeCompare(niceName(b[0])));
  }, [all, tab]);
  const plans = useMemo(() => {
    const g = providers.find(([n]) => n === provider)?.[1] ?? [];
    return g.every((i) => i.amount > 0) ? [...g].sort((a, b) => a.amount - b.amount) : g;
  }, [providers, provider]);

  const phone = pfmNoValidate(item);
  const fixed = !!item && item.amount > 0;
  const billAmount = fixed ? item!.amount : Number(amount || 0);
  const max = ngnMaxOrder(500000);
  const out = billAmount > max || (billAmount > 0 && billAmount < 100);
  const listAmount = list.reduce((s, e) => s + e.amount, 0);
  const listFee = list.reduce((s, e) => s + e.fee, 0);

  function pickTab(k: string) { setTab(k); setProvider(""); setItem(null); setChecked(null); setErr(""); }
  function pickProvider(n: string) { setProvider(n); setChecked(null); setErr(""); const g = providers.find(([x]) => x === n)?.[1] ?? []; setItem(g.length === 1 ? g[0] : null); }
  function pickPlan(k: string) { setItem(plans.find((i) => itemKey(i) === k) ?? null); setChecked(null); setErr(""); }

  async function check() {
    if (!item || !identifier) return;
    if (phone) { setChecked({ name: null }); setErr(""); return; }
    setBusy("check"); setErr(""); setChecked(null);
    try {
      const r = await fetch("/api/validate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ itemCode: item.item_code, billerCode: item.biller_code, identifier }) });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error || "Could not check this number");
      setChecked({ name: d.name });
    } catch (e: any) { setErr(e.message); } finally { setBusy(null); }
  }

  function addToList() {
    if (!item || !checked || out || billAmount <= 0 || list.length >= PFM_MAX_ITEMS) return;
    const fee = ngnServiceFee(billAmount, feeKindOf(item));
    setList([...list, { billerCode: item.biller_code, itemCode: item.item_code, billerName: item.biller_name, itemName: item.name, identifier, identifierLabel: item.label_name || "Account number", amount: billAmount, name: checked.name, fee }]);
    setIdentifier(""); setAmount(""); setChecked(null); setErr("");
    if (plans.length > 1) setItem(null);
  }

  async function create() {
    if (busy || !list.length || name.trim().length < 2) return;
    setBusy("create"); setErr("");
    try {
      const r = await fetch("/api/payforme", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ receiverName: name, receiverEmail: email || undefined, note: note || undefined, items: list.map((e) => ({ billerCode: e.billerCode, itemCode: e.itemCode, billerName: e.billerName, itemName: e.itemName, identifier: e.identifier, identifierLabel: e.identifierLabel, amount: e.amount })) }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "Something went wrong. Please try again.");
      setDone(d); clearDraft(); track("ask_created");
      const next = [{ id: d.id, key: d.key, name: name.trim(), total: d.total, at: Date.now() }, ...readSaved().filter((s) => s.id !== d.id)];
      writeSaved(next); setSaved(next);
    } catch (e: any) { setErr(e.message); } finally { setBusy(null); }
  }

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const link = done ? `${origin}/r/${done.id}` : "";
  const mine = done ? `${origin}/r/${done.id}?k=${done.key}` : "";
  const text = done ? requestShareText({ receiverName: name.trim(), total: done.total, count: done.count, link, note: note.trim() || null }) : "";

  async function copy(t: string) {
    try { await navigator.clipboard.writeText(t); } catch { const ta = document.createElement("textarea"); ta.value = t; document.body.appendChild(ta); ta.select(); try { document.execCommand("copy"); } catch {} document.body.removeChild(ta); }
    setCopied(true); setTimeout(() => setCopied(false), 2000);
  }

  if (done) {
    return (
      <main id="content" className="max-w-xl mx-auto px-5 pt-12 pb-24">
        <h1 className="font-display font-extrabold text-3xl sm:text-4xl leading-tight tracking-tight">Your link is ready</h1>
        <p className="mt-3 text-haze text-lg leading-relaxed">Send it to the person who will pay. They see exactly what it is, and pay by card from anywhere. Nothing is charged until they do.</p>
        <div className="mt-6 rounded-2xl border border-line p-5" data-testid="share">
          <p className="font-display font-bold">{pfmMoney(done.total)} for {done.count} {done.count === 1 ? "thing" : "things"}</p>
          <pre className="mt-3 whitespace-pre-wrap text-sm text-haze font-sans leading-relaxed">{text}</pre>
          <div className="mt-4 flex flex-wrap gap-2">
            <a href={waShareUrl(text)} target="_blank" rel="noopener noreferrer" className="h-11 px-5 inline-flex items-center rounded-xl bg-[#25D366] text-[#0b2a16] font-display font-bold hover:brightness-105">Send on WhatsApp</a>
            <button type="button" onClick={() => copy(text)} className="h-11 px-5 rounded-xl border border-paper/25 font-semibold hover:bg-sunk">{copied ? "Copied" : "Copy message"}</button>
          </div>
        </div>
        <div className="mt-4 rounded-2xl border border-tungsten/40 bg-cta/10 p-5">
          <p className="font-display font-bold">Keep your own page</p>
          <p className="text-haze text-sm leading-relaxed mt-1.5">This is where your tokens will appear once they pay.{email ? " We will also email them to you." : " You did not give an email, so save this page: it is the only place to see them."} Do not send this one to anyone.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <a href={mine} className="h-11 px-5 inline-flex items-center rounded-xl bg-cta text-oncta font-display font-bold hover:brightness-105" data-testid="mine">Open my page</a>
            <button type="button" onClick={() => copy(mine)} className="h-11 px-5 rounded-xl border border-paper/25 font-semibold hover:bg-sunk">Copy my page link</button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main id="content" className="max-w-xl mx-auto px-5 pt-12 pb-24">
      <h1 className="font-display font-extrabold text-3xl sm:text-4xl leading-tight tracking-tight">Ask someone to pay</h1>
      <p className="mt-3 text-haze text-lg leading-relaxed">Make a list of what you need. Send one link. A friend or relative pays by card from anywhere, and your tokens and top-ups arrive in seconds.</p>

      {saved.length > 0 && (
        <div className="mt-6 rounded-2xl border border-line p-4">
          <p className="font-semibold text-sm">Your earlier requests</p>
          <ul className="mt-2 space-y-1.5">
            {saved.slice(0, 4).map((s) => (
              <li key={s.id}><a className="text-tungsten underline underline-offset-2" href={`/r/${s.id}?k=${s.key}`}>{new Date(s.at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })} · {pfmMoney(s.total)}</a></li>
            ))}
          </ul>
        </div>
      )}

      <section className="mt-8" aria-labelledby="who">
        <h2 id="who" className="font-display font-bold text-xl">Who is asking?</h2>
        <div className="mt-3">
          <label htmlFor="pfm-name">Your name</label>
          <input id="pfm-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Mummy Ada" maxLength={60} autoComplete="name" />
        </div>
        <div className="mt-3">
          <label htmlFor="pfm-email">Your email <span className="text-haze font-normal">(optional)</span></label>
          <input id="pfm-email" type="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="So we can email you the tokens" autoComplete="email" />
        </div>
        <div className="mt-3">
          <label htmlFor="pfm-note">A short message <span className="text-haze font-normal">(optional)</span></label>
          <input id="pfm-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Light is almost out, thank you!" maxLength={PFM_NOTE_MAX} />
        </div>
      </section>

      <section className="mt-10" aria-labelledby="what">
        <h2 id="what" className="font-display font-bold text-xl">What do you need?</h2>
        {list.length > 0 && (
          <div className="mt-2 flex items-center justify-between gap-3">
            <p className="text-sm text-haze" data-testid="saved-note">{restored ? "Welcome back. Your list is still here." : "Your list is saved on this device."}</p>
            <button type="button" onClick={() => { setList([]); setRestored(false); }} className="shrink-0 text-sm font-semibold text-tungsten underline underline-offset-2">Clear list</button>
          </div>
        )}
        {list.length > 0 && (
          <ul className="mt-3 space-y-2" data-testid="list">
            {list.map((e, n) => (
              <li key={n} className="rounded-xl border border-line p-3.5 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold">{pfmTitle(e.billerName, e.itemName)}</p>
                  <p className="text-sm text-haze break-all">{e.identifier}{e.name ? ` · ${e.name}` : ""}</p>
                  <p className="text-sm num mt-0.5">{pfmMoney(e.amount)} <span className="text-haze">+ {pfmMoney(e.fee)} fee</span></p>
                </div>
                <button type="button" onClick={() => setList(list.filter((_, i) => i !== n))} className="h-10 px-3 rounded-lg border border-paper/25 text-sm font-semibold hover:bg-sunk shrink-0" aria-label={`Remove item ${n + 1}`}>Remove</button>
              </li>
            ))}
          </ul>
        )}

        {list.length < PFM_MAX_ITEMS ? (
          <div className="mt-4 rounded-2xl border border-line p-4" role="group" aria-label="Add something to the list">
            <div className="grid grid-cols-4 gap-2">
              {PFM_TABS.map((t) => (
                <button key={t.key} type="button" aria-pressed={tab === t.key} onClick={() => pickTab(t.key)}
                  className={`h-11 rounded-xl border text-sm font-semibold ${tab === t.key ? "bg-paper text-night border-paper" : "border-line text-haze hover:border-paper/40"}`}>{t.label}</button>
              ))}
            </div>
            <div className="mt-4">
              <label htmlFor="pfm-provider">{LABELS[tab].provider}</label>
              <select id="pfm-provider" value={provider} onChange={(e) => pickProvider(e.target.value)} disabled={!providers.length}>
                <option value="">{!loaded ? "Loading…" : providers.length ? "Select…" : "Nothing available here yet"}</option>
                {providers.map(([n]) => <option key={n} value={n}>{niceName(n)}</option>)}
              </select>
            </div>
            {provider && plans.length > 1 && (
              <div className="mt-3">
                <label htmlFor="pfm-plan">{LABELS[tab].plan}</label>
                <select id="pfm-plan" value={item ? itemKey(item) : ""} onChange={(e) => pickPlan(e.target.value)}>
                  <option value="">Select…</option>
                  {plans.map((i) => <option key={itemKey(i)} value={itemKey(i)}>{i.name}{i.amount > 0 ? ` — ${pfmMoney(i.amount)}` : ""}</option>)}
                </select>
              </div>
            )}
            {item && (
              <div className="mt-4 pt-4 border-t border-line">
                <label htmlFor="pfm-id">{item.label_name || "Account number"}</label>
                <input id="pfm-id" value={identifier} onChange={(e) => { setIdentifier(clean(e.target.value, phone)); setChecked(null); }}
                  type={phone ? "tel" : "text"} inputMode={phone ? "tel" : "numeric"} placeholder={phone ? "08031234567" : "04123456789"} maxLength={phone ? 16 : 20} autoComplete="off" autoCorrect="off" spellCheck={false} />
                {!fixed && (
                  <div className="mt-3">
                    <label htmlFor="pfm-amt">Amount (₦)</label>
                    <input id="pfm-amt" className="num" value={amount} onChange={(e) => { setAmount(e.target.value.replace(/[^\d]/g, "")); }} inputMode="numeric" placeholder="5000" maxLength={7} autoComplete="off" />
                    <div className="flex gap-2 flex-wrap mt-2">
                      {QUICK.map((a) => <button key={a} type="button" onClick={() => setAmount(String(a))} className={`px-3 h-9 rounded-full border text-sm num ${Number(amount) === a ? "border-tungsten bg-cta/15 font-semibold" : "border-line text-haze hover:text-paper"}`}>{pfmMoney(a)}</button>)}
                    </div>
                  </div>
                )}
                {fixed && <p className="text-sm text-haze mt-2.5">Price for this plan: <span className="text-paper font-semibold num">{pfmMoney(item.amount)}</span></p>}
                {out && <p className="text-sm text-bad mt-2.5" role="status">Each item must be between ₦100 and {pfmMoney(max)}.</p>}
                {!checked ? (
                  <button type="button" onClick={check} disabled={busy !== null || !identifier || billAmount <= 0 || out}
                    className="mt-4 w-full h-12 rounded-xl border border-paper/25 font-semibold hover:bg-sunk disabled:opacity-40">
                    {busy === "check" ? "Checking…" : phone ? "Confirm number" : "Check account name"}
                  </button>
                ) : (
                  <div className="mt-4 rounded-xl border border-ok/30 bg-ok/10 p-3.5" role="status">
                    {checked.name ? <p className="text-sm text-haze">This {item.label_name?.toLowerCase() || "account"} belongs to</p> : <p className="text-sm text-haze">Number looks fine</p>}
                    {checked.name && <p className="font-display font-bold text-lg">{checked.name}</p>}
                    <button type="button" onClick={addToList} className="mt-3 h-11 px-5 rounded-xl bg-cta text-oncta font-display font-bold hover:brightness-105">{checked.name ? "Yes, add it to my list" : "Add it to my list"}</button>
                  </div>
                )}
              </div>
            )}
            {err && <p className="text-bad text-sm mt-3" role="alert">{err}</p>}
            {loadErr && <p className="text-bad text-sm mt-3" role="alert">{loadErr}</p>}
          </div>
        ) : (
          <p className="mt-4 text-sm text-haze">That is the most you can ask for in one go ({PFM_MAX_ITEMS}). Send this one, then make another.</p>
        )}
      </section>

      {list.length > 0 && (
        <section className="mt-10 rounded-2xl border border-line p-5" aria-labelledby="sum">
          <h2 id="sum" className="font-display font-bold text-xl">What they will pay</h2>
          <dl className="mt-3 text-sm space-y-1.5">
            <div className="flex justify-between"><dt className="text-haze">Bills</dt><dd className="num">{pfmMoney(listAmount)}</dd></div>
            <div className="flex justify-between"><dt className="text-haze">Service fees</dt><dd className="num">{pfmMoney(listFee)}</dd></div>
            <div className="flex justify-between font-semibold text-base pt-1.5 border-t border-line"><dt>Total</dt><dd className="num" data-testid="total">{pfmMoney(listAmount + listFee)}</dd></div>
          </dl>
          {err && list.length > 0 && !item && <p className="text-bad text-sm mt-3" role="alert">{err}</p>}
          <button type="button" onClick={create} disabled={busy !== null || name.trim().length < 2}
            className="mt-4 w-full h-12 rounded-xl bg-cta text-oncta font-display font-bold hover:brightness-105 active:brightness-95 disabled:opacity-50">
            {busy === "create" ? "Making your link…" : "Make my link"}
          </button>
          {name.trim().length < 2 && <p className="text-xs text-haze mt-2">Add your name above first.</p>}
        </section>
      )}
    </main>
  );
}
