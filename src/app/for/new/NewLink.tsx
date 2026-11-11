"use client";

import { useEffect, useMemo, useState } from "react";
import { cleanText } from "@/lib/gift";
import { PFM_TABS, pfmIsExam, pfmMoney, pfmNoValidate, pfmTitle, waShareUrl, type PfmBiller } from "@/lib/payforme-shared";

type Entry = { billerCode: string; itemCode: string; billerName: string; itemName: string; identifier: string; identifierLabel: string; label: string; amount: number | null; name: string | null };

const niceName = (n: string) => n.replace(/\s+VTU$/i, "");
const itemKey = (i: PfmBiller) => `${i.biller_code}:${i.item_code}:${i.short_name ?? i.name}`;
const clean = (v: string, phone: boolean) => (phone ? v.replace(/[^\d+]/g, "").replace(/(?!^)\+/g, "") : v.replace(/[\s\-]/g, ""));
const LABELS: Record<string, { provider: string; plan: string; hint: string }> = {
  electricity: { provider: "Electricity company", plan: "Meter type", hint: "Mum's light" },
  cable: { provider: "TV provider", plan: "Package", hint: "Home DStv" },
  airtime: { provider: "Network", plan: "Amount", hint: "My line" },
  data: { provider: "Network or provider", plan: "Data plan", hint: "My data" },
};
const MAX = 3;
const STORE = "nolgic.billslinks.v1";

// Make a standing bills link. Nothing is bought and nobody is charged here.
export default function NewLink() {
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
  const [label, setLabel] = useState("");
  const [checked, setChecked] = useState<{ name: string | null } | null>(null);
  const [busy, setBusy] = useState<"check" | "create" | null>(null);
  const [err, setErr] = useState("");
  const [done, setDone] = useState<{ slug: string; key: string; url: string } | null>(null);
  const [copied, setCopied] = useState("");

  useEffect(() => {
    fetch("/api/billers?country=NG")
      .then(async (r) => ({ ok: r.ok, d: await r.json().catch(() => ({})) }))
      .then(({ ok, d }) => { setAll((d.items ?? []).filter((x: PfmBiller) => !pfmIsExam(x.biller_code))); setLoaded(true); if (!ok || !(d.items ?? []).length) setLoadErr("We couldn't load the list of services. Refresh the page to try again."); })
      .catch(() => { setLoaded(true); setLoadErr("We couldn't load the list of services. Refresh the page to try again."); });
  }, []);

  const tabs = PFM_TABS.filter((x) => x.key !== "exam");
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
  const phone = !!item && pfmNoValidate(item);
  const fixed = !!item && item.amount > 0;

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
    if (!item || !checked || list.length >= MAX) return;
    if (list.some((e) => e.billerCode === item.biller_code && e.itemCode === item.item_code && e.identifier === identifier)) { setErr("That one is already in your list."); return; }
    setList([...list, { billerCode: item.biller_code, itemCode: item.item_code, billerName: item.biller_name, itemName: item.name, identifier, identifierLabel: item.label_name || "Account number", label: cleanText(label, 24) || LABELS[tab]?.hint || "", amount: fixed ? Math.round(item.amount) : null, name: checked.name }]);
    setIdentifier(""); setLabel(""); setChecked(null); setErr("");
    if (plans.length > 1) setItem(null);
  }

  async function create() {
    if (busy || !list.length || name.trim().length < 2) return;
    setBusy("create"); setErr("");
    try {
      const r = await fetch("/api/paylink", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email: email || undefined, note: note || undefined, items: list.map((e) => ({ billerCode: e.billerCode, itemCode: e.itemCode, billerName: e.billerName, itemName: e.itemName, identifier: e.identifier, identifierLabel: e.identifierLabel, label: e.label, amount: e.amount })) }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "Something went wrong. Please try again.");
      try {
        const prev = JSON.parse(localStorage.getItem(STORE) ?? "[]");
        localStorage.setItem(STORE, JSON.stringify([{ slug: d.slug, key: d.key, name: name.trim() }, ...(Array.isArray(prev) ? prev : []).filter((x: any) => x?.slug !== d.slug)].slice(0, 5)));
      } catch { /* private mode: the page link below still works */ }
      setDone(d);
    } catch (e: any) { setErr(e.message); } finally { setBusy(null); }
  }

  async function copy(t: string, k: string) {
    try { await navigator.clipboard.writeText(t); } catch { const ta = document.createElement("textarea"); ta.value = t; document.body.appendChild(ta); ta.select(); try { document.execCommand("copy"); } catch {} document.body.removeChild(ta); }
    setCopied(k); setTimeout(() => setCopied(""), 2000);
  }

  if (done) {
    const text = [`Hi! You can pay my light, TV, airtime or data bills here, any time, in naira:`, done.url, note.trim() ? `\n"${note.trim()}"` : "", `\n— ${name.trim()}`].filter(Boolean).join("\n");
    const mine = `${typeof window !== "undefined" ? window.location.origin : ""}/for/${done.slug}/manage?k=${done.key}`;
    return (
      <main id="content" className="max-w-xl mx-auto px-5 pt-12 pb-24">
        <h1 className="font-display font-extrabold text-3xl sm:text-4xl leading-tight tracking-tight">Your link is ready</h1>
        <p className="mt-3 text-haze text-lg leading-relaxed">Send it to anyone who looks out for you. They choose what to pay and how much. It arrives like any other payment.</p>
        <div className="mt-6 rounded-2xl border border-line p-5" data-testid="share">
          <p className="font-display font-bold break-all">{done.url}</p>
          <pre className="mt-3 whitespace-pre-wrap text-sm text-haze font-sans leading-relaxed">{text}</pre>
          <div className="mt-4 flex flex-wrap gap-2">
            <a href={waShareUrl(text)} target="_blank" rel="noopener noreferrer" className="h-11 px-5 inline-flex items-center rounded-xl bg-[#25D366] text-[#0b2a16] font-display font-bold hover:brightness-105">Send on WhatsApp</a>
            <button type="button" onClick={() => copy(text, "msg")} className="h-11 px-5 rounded-xl border border-paper/25 font-semibold hover:bg-sunk">{copied === "msg" ? "Copied" : "Copy message"}</button>
          </div>
        </div>
        <div className="mt-4 rounded-2xl border border-tungsten/40 bg-cta/10 p-5">
          <p className="font-display font-bold">Keep your private page</p>
          <p className="text-haze text-sm leading-relaxed mt-1.5">This is where you pause or delete your link and see who paid.{email ? " We email your tokens to you as they land." : " You didn't give an email, so save this page: it is how you get back here."} Don&rsquo;t send this one to anyone.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <a href={mine} className="h-11 px-5 inline-flex items-center rounded-xl bg-cta text-oncta font-display font-bold hover:brightness-105" data-testid="mine">Open my page</a>
            <button type="button" onClick={() => copy(mine, "mine")} className="h-11 px-5 rounded-xl border border-paper/25 font-semibold hover:bg-sunk">{copied === "mine" ? "Copied" : "Copy my page link"}</button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main id="content" className="max-w-xl mx-auto px-5 pt-12 pb-24">
      <h1 className="font-display font-extrabold text-3xl sm:text-4xl leading-tight tracking-tight">Make your bills link</h1>
      <p className="mt-3 text-haze text-lg leading-relaxed">Add what people can pay for. They will see only the name you choose and the last four digits.</p>

      <section className="mt-8" aria-labelledby="who">
        <h2 id="who" className="font-display font-bold text-xl">Who is it for?</h2>
        <div className="mt-3">
          <label htmlFor="bl-name">The name people see</label>
          <input id="bl-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ada" maxLength={40} autoComplete="given-name" />
        </div>
        <div className="mt-3">
          <label htmlFor="bl-email">Your email <span className="text-haze font-normal">(optional, we email your tokens here)</span></label>
          <input id="bl-email" type="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@gmail.com" autoComplete="email" />
        </div>
        <div className="mt-3">
          <label htmlFor="bl-note">A short message <span className="text-haze font-normal">(optional)</span></label>
          <input id="bl-note" value={note} onChange={(e) => setNote(cleanText(e.target.value, 100))} placeholder="Thank you for always looking out for me" maxLength={100} />
        </div>
      </section>

      <section className="mt-10" aria-labelledby="what">
        <h2 id="what" className="font-display font-bold text-xl">What can people pay for?</h2>
        {list.length > 0 && (
          <ul className="mt-3 space-y-2" data-testid="list">
            {list.map((e, n) => (
              <li key={n} className="rounded-xl border border-line p-3.5 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold">{e.label || pfmTitle(e.billerName, e.itemName)}</p>
                  <p className="text-sm text-haze">{pfmTitle(e.billerName, e.itemName)}</p>
                  <p className="text-sm text-haze break-all">{e.identifier}{e.name ? ` · ${e.name}` : ""}</p>
                  {e.amount && <p className="text-sm num mt-0.5">{pfmMoney(e.amount)} <span className="text-haze">fixed price</span></p>}
                </div>
                <button type="button" onClick={() => setList(list.filter((_, i) => i !== n))} className="h-10 px-3 rounded-lg border border-paper/25 text-sm font-semibold hover:bg-sunk shrink-0" aria-label={`Remove item ${n + 1}`}>Remove</button>
              </li>
            ))}
          </ul>
        )}

        {list.length < MAX ? (
          <div className="mt-4 rounded-2xl border border-line p-4" role="group" aria-label="Add something">
            <div className="grid grid-cols-4 gap-2">
              {tabs.map((t) => (
                <button key={t.key} type="button" aria-pressed={tab === t.key} onClick={() => pickTab(t.key)}
                  className={`h-11 rounded-xl border text-sm font-semibold ${tab === t.key ? "bg-paper text-night border-paper" : "border-line text-haze hover:border-paper/40"}`}>{t.label}</button>
              ))}
            </div>
            <div className="mt-4">
              <label htmlFor="bl-provider">{LABELS[tab]?.provider}</label>
              <select id="bl-provider" value={provider} onChange={(e) => pickProvider(e.target.value)} disabled={!providers.length}>
                <option value="">{!loaded ? "Loading…" : providers.length ? "Select…" : "Nothing available here yet"}</option>
                {providers.map(([n]) => <option key={n} value={n}>{niceName(n)}</option>)}
              </select>
            </div>
            {provider && plans.length > 1 && (
              <div className="mt-3">
                <label htmlFor="bl-plan">{LABELS[tab]?.plan}</label>
                <select id="bl-plan" value={item ? itemKey(item) : ""} onChange={(e) => pickPlan(e.target.value)}>
                  <option value="">Select…</option>
                  {plans.map((i) => <option key={itemKey(i)} value={itemKey(i)}>{i.name}{i.amount > 0 ? ` — ${pfmMoney(i.amount)}` : ""}</option>)}
                </select>
              </div>
            )}
            {item && (
              <div className="mt-4 pt-4 border-t border-line">
                <label htmlFor="bl-id">{item.label_name || "Account number"}</label>
                <input id="bl-id" value={identifier} onChange={(e) => { setIdentifier(clean(e.target.value, phone)); setChecked(null); }}
                  type={phone ? "tel" : "text"} inputMode={phone ? "tel" : "numeric"} placeholder={phone ? "08031234567" : "04123456789"} maxLength={phone ? 16 : 20} autoComplete="off" autoCorrect="off" spellCheck={false} />
                <div className="mt-3">
                  <label htmlFor="bl-label">What should it be called? <span className="text-haze font-normal">(optional)</span></label>
                  <input id="bl-label" value={label} onChange={(e) => setLabel(cleanText(e.target.value, 24))} maxLength={24} placeholder={LABELS[tab]?.hint} autoComplete="off" />
                </div>
                {fixed && <p className="text-sm text-haze mt-2.5">Price for this plan: <span className="text-paper font-semibold num">{pfmMoney(item.amount)}</span></p>}
                {!fixed && <p className="text-sm text-haze mt-2.5">The person paying chooses the amount.</p>}
                {!checked ? (
                  <button type="button" onClick={check} disabled={busy !== null || !identifier}
                    className="mt-4 w-full h-12 rounded-xl border border-paper/25 font-semibold hover:bg-sunk disabled:opacity-40">
                    {busy === "check" ? "Checking…" : phone ? "Confirm number" : "Check account name"}
                  </button>
                ) : (
                  <div className="mt-4 rounded-xl border border-ok/30 bg-ok/10 p-3.5" role="status">
                    {checked.name ? <p className="text-sm text-haze">This {item.label_name?.toLowerCase() || "account"} belongs to</p> : <p className="text-sm text-haze">Number looks fine</p>}
                    {checked.name && <p className="font-display font-bold text-lg">{checked.name}</p>}
                    <p className="text-xs text-haze mt-1">Only you see this. People who open your link see just the last four digits.</p>
                    <button type="button" onClick={addToList} className="mt-3 h-11 px-5 rounded-xl bg-cta text-oncta font-display font-bold hover:brightness-105">Add it to my link</button>
                  </div>
                )}
              </div>
            )}
            {err && <p className="text-bad text-sm mt-3" role="alert">{err}</p>}
            {loadErr && <p className="text-bad text-sm mt-3" role="alert">{loadErr}</p>}
          </div>
        ) : (
          <p className="mt-4 text-sm text-haze">That is the most one link can cover ({MAX}).</p>
        )}
      </section>

      {list.length > 0 && (
        <section className="mt-10 rounded-2xl border border-line p-5">
          {err && !item && <p className="text-bad text-sm mb-3" role="alert">{err}</p>}
          <button type="button" onClick={create} disabled={busy !== null || name.trim().length < 2}
            className="w-full h-12 rounded-xl bg-cta text-oncta font-display font-bold hover:brightness-105 active:brightness-95 disabled:opacity-50">
            {busy === "create" ? "Making your link…" : "Make my link"}
          </button>
          {name.trim().length < 2 && <p className="text-xs text-haze mt-2">Add the name people will see first.</p>}
          <p className="text-xs text-haze mt-3 leading-relaxed">Nothing is charged to you. You can pause or delete the link any time.</p>
        </section>
      )}
    </main>
  );
}
