"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { track } from "@/lib/track";
import { waRecipient } from "@/lib/gift";
import { whatsappShareUrl } from "@/lib/share";
import { supportLink } from "@/lib/support-contact";
import { forgetJoined, joinedKey, myLinkKey, rememberJoined, rememberMyLink } from "@/lib/payforme-collect-local";
import { readPfmSaved, writePfmSaved } from "@/lib/payforme-saved";
import { examIdOk, examService, isExamBiller, splitPins } from "@/lib/exams-shared";
import {
  PFM_TABS, examAsBillers, pfcChoiceText, pfcShareText, pfmIsExam, pfmMoney, pfmNoValidate, pfmTitle,
  type PfcEntryState, type PfcView, type PfmBiller, type PfmCategory,
} from "@/lib/payforme-shared";

// The page behind a giveaway link.
//   Anyone      /c/<id>          sees who it's from and what's on offer, picks theirs and joins.
//   A joiner    (same link, same device) sees their own delivery and token once the giver has paid.
//   The giver   /c/<id>?k=<key>  sees who has joined, removes anyone, closes the list and pays once.

const niceName = (n: string) => n.replace(/\s+VTU$/i, "");
const itemKey = (i: PfmBiller) => `${i.biller_code}:${i.item_code}:${i.short_name ?? i.name}`;
const clean = (v: string, phone: boolean) => (phone ? v.replace(/[^\d+]/g, "").replace(/(?!^)\+/g, "") : v.replace(/[\s\-]/g, ""));
const LABELS: Record<string, { provider: string; plan: string }> = {
  electricity: { provider: "Electricity company", plan: "Meter type" },
  cable: { provider: "TV provider", plan: "Package" },
  airtime: { provider: "Network", plan: "Amount" },
  data: { provider: "Network or provider", plan: "Data plan" },
  exam: { provider: "Exam", plan: "PIN" },
};
const QUICK = [500, 1000, 2000, 5000, 10000];
const btn = "h-11 px-5 inline-flex items-center rounded-xl font-display font-bold";
const h1 = "font-display font-extrabold text-3xl sm:text-4xl leading-tight tracking-tight";

export default function CollectPage({ params }: { params: { id: string } }) {
  const id = params.id;
  const [v, setV] = useState<PfcView | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "missing" | "error">("loading");
  const [ownerKey, setOwnerKey] = useState<string | null>(null);
  const [entryKey, setEntryKey] = useState<string | null>(null);
  const alive = useRef(true);
  const wa = supportLink({});

  const load = useCallback(async (k: string | null, e: string | null) => {
    try {
      const q = new URLSearchParams();
      if (k) q.set("k", k);
      if (e) q.set("e", e);
      const r = await fetch(`/api/payforme/collect/${id}${q.toString() ? `?${q}` : ""}`, { cache: "no-store" });
      if (r.status === 404) { if (alive.current) setState("missing"); return null; }
      if (!r.ok) throw new Error("bad");
      const d = (await r.json()) as PfcView;
      if (alive.current) { setV(d); setState("ok"); }
      return d;
    } catch { if (alive.current) setState((s) => (s === "ok" ? s : "error")); return null; }
  }, [id]);

  // Who is looking: the giver (key in the link, or this device made it), someone who joined from this device, or anyone.
  useEffect(() => {
    alive.current = true;
    const k = new URLSearchParams(window.location.search).get("k") || myLinkKey(id);
    const e = joinedKey(id);
    setOwnerKey(k); setEntryKey(e);
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      const d = await load(k, e);
      if (!alive.current) return;
      if (d?.owner && k && !myLinkKey(id)) rememberMyLink({ id, key: k, at: Date.now(), budget: d.budget, people: d.maxPeople });
      const s = d?.mine?.state;
      const every = !d ? 8000
        : s === "working" ? 4000
        : s === "joined" || s === "waiting_payment" || s === "checking" ? 15000
        : d.owner && (d.status === "open" || d.status === "full") ? 10000
        : 0;
      if (every) timer = setTimeout(tick, every);
    };
    tick();
    return () => { alive.current = false; clearTimeout(timer); };
  }, [id, load]);

  if (state === "loading") return <main id="content" className="max-w-xl mx-auto px-5 pt-14 pb-24"><p className="text-haze" role="status">Loading…</p></main>;
  if (state === "missing" || (state === "error" && !v)) {
    return (
      <main id="content" className="max-w-xl mx-auto px-5 pt-14 pb-24">
        <h1 className={h1}>{state === "missing" ? "We can't find this giveaway" : "We couldn't load this"}</h1>
        <p className="mt-3 text-haze text-lg leading-relaxed">{state === "missing" ? "The link may be incomplete. Ask the person who sent it to send it again." : "Check your connection and refresh the page."}</p>
      </main>
    );
  }
  if (!v) return null;

  return (
    <main id="content" className="max-w-xl mx-auto px-5 pt-12 pb-24">
      {v.owner && ownerKey
        ? <Owner v={v} ownerKey={ownerKey} reload={() => load(ownerKey, entryKey)} />
        : v.mine
          ? <Mine v={v} onReset={() => { forgetJoined(id); setEntryKey(null); load(null, null); }} />
          : <Join v={v} onJoined={(e) => { rememberJoined(id, e); setEntryKey(e); load(null, e); }} />}

      <div className="mt-10 rounded-2xl border border-line p-5">
        <p className="font-display font-bold">Need help?</p>
        <p className="text-haze text-sm leading-relaxed mt-1.5">Email <a className="text-tungsten underline underline-offset-2" href="mailto:nolgichq@gmail.com">nolgichq@gmail.com</a>{wa ? " or message us on WhatsApp" : ""}.</p>
        {wa && <a href={wa} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex h-11 px-5 items-center rounded-xl border border-paper/25 font-semibold hover:bg-sunk">Message us on WhatsApp</a>}
      </div>
    </main>
  );
}

// ───────────────────────── someone who joined from this device ─────────────────────────

const MINE_TEXT: Record<PfcEntryState, { title: (m: string) => string; body: (m: string) => string }> = {
  joined: { title: () => "You're in", body: (m) => `${m} will close the list and pay for everyone. Keep this page: it updates by itself, and yours shows here when it's done. Nothing for you to pay.` },
  waiting_payment: { title: () => "The list is closed", body: (m) => `Waiting for ${m} to pay. Keep this page: yours shows here as soon as it's done.` },
  waiting: { title: () => "Paid, starting now", body: () => "Yours is about to be bought. This page updates by itself." },
  working: { title: () => "Paid, buying yours now", body: () => "This takes a few seconds. This page updates by itself." },
  delivered: { title: () => "It's done", body: (m) => `${m} has paid for yours, and it has been delivered.` },
  refunded: { title: () => "We couldn't deliver yours", body: (m) => `The provider didn't accept it, so the money went back to ${m}. You may want to let them know.` },
  checking: { title: () => "We're checking yours", body: () => "Something needs a second look. It's being sorted; you don't need to do anything." },
  not_paid: { title: () => "This giveaway didn't go ahead", body: (m) => `${m} didn't pay for it in the end, so nothing was bought.` },
  removed: { title: () => "You're not on this list", body: (m) => `${m} took this entry off the list. If you think that's a mistake, ask them.` },
};

function Mine({ v, onReset }: { v: PfcView; onReset: () => void }) {
  const m = v.mine!;
  const t = MINE_TEXT[m.state];
  const [copied, setCopied] = useState(false);
  return (
    <>
      <h1 className={h1} data-testid="mine-title">{t.title(v.makerName)}</h1>
      <p className="mt-3 text-haze text-lg leading-relaxed" role="status">{t.body(v.makerName)}</p>
      <div className="mt-6 rounded-xl border border-line p-4">
        <p className="font-semibold">{pfmTitle(m.billerName, m.itemName)}</p>
        <p className="text-sm text-haze break-all">{m.label}: {m.identifier}</p>
        {m.customerName && <p className="text-sm mt-0.5">For <span className="font-semibold">{m.customerName}</span></p>}
        <p className="num font-semibold mt-1">{pfmMoney(m.amount)}</p>
        {m.state === "delivered" && (m.token ? (
          <div className="mt-3 pt-3 border-t border-line">
            {isExamBiller(m.billerName) ? splitPins(m.token).map((p) => (
              <div key={p.label + p.value} className="mb-1.5"><p className="text-xs text-haze">{p.label}</p><p className="font-mono text-lg tracking-wider break-all" data-testid="token">{p.value}</p></div>
            )) : (<>
            <p className="text-xs text-haze">Your token</p>
            <p className="font-mono text-lg tracking-wider break-all" data-testid="token">{m.token}</p></>)}
            <button type="button" onClick={async () => { try { await navigator.clipboard.writeText(m.token!); } catch {} setCopied(true); setTimeout(() => setCopied(false), 1800); }}
              className="mt-2 h-10 px-4 rounded-lg border border-paper/25 text-sm font-semibold hover:bg-sunk">{copied ? "Copied" : isExamBiller(m.billerName) ? "Copy PIN" : "Copy token"}</button>
          </div>
        ) : m.wantsToken ? <p className="text-sm text-haze mt-3">Your token is on its way. This page updates by itself.</p> : null)}
      </div>
      {m.state === "removed" && v.status === "open" && (
        <button type="button" onClick={onReset} className="mt-4 h-11 px-5 rounded-xl border border-paper/25 font-semibold hover:bg-sunk">Join again</button>
      )}
    </>
  );
}

// ───────────────────────── anyone: pick and join ─────────────────────────

function Join({ v, onJoined }: { v: PfcView; onJoined: (entryKey: string) => void }) {
  const [all, setAll] = useState<PfmBiller[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadErr, setLoadErr] = useState("");
  // What this giveaway offers. Exam PINs only show if their list loaded (exams switched on).
  const tabs = useMemo(() => PFM_TABS.filter((t) => v.categories.includes(t.key) && (t.key !== "exam" || all.some(t.match))), [v.categories, all]);
  const [tab, setTab] = useState<PfmCategory>(v.categories.find((c) => c !== "exam") ?? v.categories[0] ?? "electricity");
  const [provider, setProvider] = useState("");
  const [item, setItem] = useState<PfmBiller | null>(null);
  const [identifier, setIdentifier] = useState("");
  const [amount, setAmount] = useState(String(v.budget));
  const [checked, setChecked] = useState<{ name: string | null } | null>(null);
  const [who, setWho] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [busy, setBusy] = useState<"check" | "join" | null>(null);
  const [err, setErr] = useState("");

  const open = v.status === "open";
  useEffect(() => {
    if (!open) return;
    fetch("/api/billers?country=NG")
      .then(async (r) => ({ ok: r.ok, d: await r.json().catch(() => ({})) }))
      .then(({ ok, d }) => { setAll((a) => [...(d.items ?? []).filter((x: PfmBiller) => !pfmIsExam(x.biller_code)), ...a.filter((x) => pfmIsExam(x.biller_code))]); setLoaded(true); if (!ok || !(d.items ?? []).length) setLoadErr("We couldn't load the list of services. Refresh the page to try again."); })
      .catch(() => { setLoaded(true); setLoadErr("We couldn't load the list of services. Refresh the page to try again."); });
    if (v.categories.includes("exam")) {
      fetch("/api/exams").then((r) => r.json()).then((d) => { if (d?.enabled && Array.isArray(d.groups) && d.groups.length) setAll((a) => [...a.filter((x) => !pfmIsExam(x.biller_code)), ...examAsBillers(d.groups)]); }).catch(() => {});
    }
  }, [open, v.categories]);

  // Only what this giveaway offers, and no fixed-price plan above what the giver allows.
  const providers = useMemo(() => {
    const t = PFM_TABS.find((x) => x.key === tab);
    const m = new Map<string, PfmBiller[]>();
    if (!t) return [];
    for (const i of all.filter(t.match)) {
      if (i.amount > 0 && i.amount > v.budget) continue;
      const a = m.get(i.biller_name); if (a) a.push(i); else m.set(i.biller_name, [i]);
    }
    return Array.from(m.entries()).sort((a, b) => niceName(a[0]).localeCompare(niceName(b[0])));
  }, [all, tab, v.budget]);
  const plans = useMemo(() => {
    const g = providers.find(([n]) => n === provider)?.[1] ?? [];
    return g.every((i) => i.amount > 0) ? [...g].sort((a, b) => a.amount - b.amount) : g;
  }, [providers, provider]);

  const exam = !!item && pfmIsExam(item.biller_code);
  const jamb = exam && /^jamb/i.test(item!.biller_code);
  const phone = !exam && pfmNoValidate(item);
  const fixed = !!item && item.amount > 0;
  const bill = fixed ? item!.amount : Number(amount || 0);
  const out = bill > v.budget || (bill > 0 && bill < 100);

  function pickTab(k: PfmCategory) { setTab(k); setProvider(""); setItem(null); setChecked(null); setErr(""); }
  function pickProvider(n: string) { setProvider(n); setChecked(null); setErr(""); const g = providers.find(([x]) => x === n)?.[1] ?? []; setItem(g.length === 1 ? g[0] : null); }
  function pickPlan(k: string) { setItem(plans.find((i) => itemKey(i) === k) ?? null); setChecked(null); setErr(""); }

  async function check() {
    if (!item || !identifier) return;
    if (exam) { if (examIdOk(item.biller_code, identifier)) { setChecked({ name: null }); setErr(""); } else setErr(examService(item.biller_code).idError); return; }
    if (phone) { setChecked({ name: null }); setErr(""); return; }
    setBusy("check"); setErr(""); setChecked(null);
    try {
      const r = await fetch("/api/validate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ itemCode: item.item_code, billerCode: item.biller_code, identifier }) });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error || "Could not check this number");
      setChecked({ name: d.name });
    } catch (e: any) { setErr(e.message); } finally { setBusy(null); }
  }

  async function join() {
    if (!item || !checked || out || bill <= 0 || who.trim().length < 2 || busy) return;
    if (whatsapp && !waRecipient(whatsapp)) { setErr("That WhatsApp number doesn't look like a Nigerian mobile number."); return; }
    setBusy("join"); setErr("");
    try {
      const r = await fetch(`/api/payforme/collect/${v.id}/join`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ who: who.trim(), whatsapp: whatsapp || undefined, billerCode: item.biller_code, itemCode: item.item_code, billerName: item.biller_name, itemName: item.name, identifier, identifierLabel: item.label_name || "Account number", amount: bill }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.entryKey) throw new Error(d.error || "Something went wrong. Please try again.");
      track("giveaway_join");
      onJoined(d.entryKey);
    } catch (e: any) { setErr(e.message); setBusy(null); }
  }

  if (!open) {
    const closed: Record<string, [string, string]> = {
      full: ["This giveaway is full", `${v.makerName}'s giveaway has all the people it can take.`],
      closed: ["Entries are closed", `${v.makerName} has closed the list.`],
      cancelled: ["This giveaway was cancelled", `${v.makerName} cancelled it. Nothing was charged to anyone.`],
      expired: ["This giveaway has ended", "The link is no longer taking people."],
    };
    const [t, b] = closed[v.status] ?? closed.closed;
    return <><h1 className={h1}>{t}</h1><p className="mt-3 text-haze text-lg leading-relaxed">{b}</p></>;
  }

  return (
    <>
      <h1 className={h1} data-testid="join-title">{v.makerName} is giving you up to {pfmMoney(v.budget)} of {pfcChoiceText(v.categories)}</h1>
      {v.note && <p className="mt-3 text-lg leading-relaxed border-l-2 border-tungsten pl-4">&ldquo;{v.note}&rdquo;</p>}
      <p className="mt-3 text-haze leading-relaxed">Choose what you want and enter your number. Nothing for you to pay. {v.makerName} pays for everyone once the list is ready.</p>
      <p className="mt-1 text-sm text-haze">{v.count} of {v.maxPeople} places taken.</p>

      <div className="mt-6 rounded-2xl border border-line p-4" role="group" aria-label="Choose yours">
        {tabs.length > 1 && (
          <div className={`grid gap-2 ${tabs.length >= 5 ? "grid-cols-3 sm:grid-cols-5" : tabs.length === 4 ? "grid-cols-4" : tabs.length === 3 ? "grid-cols-3" : "grid-cols-2"}`}>
            {tabs.map((t) => (
              <button key={t.key} type="button" aria-pressed={tab === t.key} onClick={() => pickTab(t.key)}
                className={`h-11 rounded-xl border text-sm font-semibold ${tab === t.key ? "bg-paper text-night border-paper" : "border-line text-haze hover:border-paper/40"}`}>{t.label}</button>
            ))}
          </div>
        )}
        <div className={tabs.length > 1 ? "mt-4" : ""}>
          <label htmlFor="pfc-provider">{LABELS[tab].provider}</label>
          <select id="pfc-provider" value={provider} onChange={(e) => pickProvider(e.target.value)} disabled={!providers.length}>
            <option value="">{!loaded ? "Loading…" : providers.length ? "Select…" : `Nothing here fits within ${pfmMoney(v.budget)}`}</option>
            {providers.map(([n]) => <option key={n} value={n}>{niceName(n)}</option>)}
          </select>
        </div>
        {provider && plans.length > 1 && (
          <div className="mt-3">
            <label htmlFor="pfc-plan">{LABELS[tab].plan}</label>
            <select id="pfc-plan" value={item ? itemKey(item) : ""} onChange={(e) => pickPlan(e.target.value)}>
              <option value="">Select…</option>
              {plans.map((i) => <option key={itemKey(i)} value={itemKey(i)}>{i.name}{i.amount > 0 ? ` — ${pfmMoney(i.amount)}` : ""}</option>)}
            </select>
          </div>
        )}
        {item && (
          <div className="mt-4 pt-4 border-t border-line">
            <label htmlFor="pfc-id">{phone ? "Your phone number" : exam ? `The candidate's ${/^jamb/i.test(item.biller_code) ? "JAMB profile code" : "phone number"}` : `Your ${(item.label_name || "account number").toLowerCase()}`}</label>
            <input id="pfc-id" value={identifier} onChange={(e) => { setIdentifier(clean(e.target.value, phone)); setChecked(null); }}
              type={phone ? "tel" : "text"} inputMode={phone ? "tel" : jamb ? "text" : "numeric"} placeholder={phone ? "08031234567" : jamb ? "Profile code" : exam ? "08031234567" : "04123456789"} maxLength={phone ? 16 : 20} autoComplete="off" autoCorrect="off" spellCheck={false} />
            {exam && <p className="text-xs text-haze mt-1.5 leading-relaxed">{examService(item.biller_code).idHint}</p>}
            {!fixed && (
              <div className="mt-3">
                <label htmlFor="pfc-amt">Amount (₦), up to {pfmMoney(v.budget)}</label>
                <input id="pfc-amt" className="num" value={amount} onChange={(e) => { setAmount(e.target.value.replace(/[^\d]/g, "")); setChecked(null); }} inputMode="numeric" maxLength={7} autoComplete="off" />
                <div className="flex gap-2 flex-wrap mt-2">
                  {Array.from(new Set([...QUICK.filter((a) => a < v.budget), v.budget])).map((a) => <button key={a} type="button" onClick={() => { setAmount(String(a)); setChecked(null); }} className={`px-3 h-9 rounded-full border text-sm num ${Number(amount) === a ? "border-tungsten bg-cta/15 font-semibold" : "border-line text-haze hover:text-paper"}`}>{pfmMoney(a)}</button>)}
                </div>
              </div>
            )}
            {fixed && <p className="text-sm text-haze mt-2.5">Price for this plan: <span className="text-paper font-semibold num">{pfmMoney(item.amount)}</span></p>}
            {out && <p className="text-sm text-bad mt-2.5" role="status">Between ₦100 and {pfmMoney(v.budget)}.</p>}
            {!checked ? (
              <button type="button" onClick={check} disabled={busy !== null || !identifier || bill <= 0 || out}
                className="mt-4 w-full h-12 rounded-xl border border-paper/25 font-semibold hover:bg-sunk disabled:opacity-40">
                {busy === "check" ? "Checking…" : exam ? (/^jamb/i.test(item.biller_code) ? "Confirm JAMB profile code" : "Confirm phone number") : phone ? "Confirm number" : "Check account name"}
              </button>
            ) : (
              <div className="mt-4 rounded-xl border border-ok/30 bg-ok/10 p-3.5" role="status">
                {checked.name ? <p className="text-sm text-haze">This {item.label_name?.toLowerCase() || "account"} belongs to</p> : <p className="text-sm text-haze">{exam ? "Check it once more: a PIN bought for the wrong one can't be moved." : "Number looks fine"}</p>}
                {checked.name && <p className="font-display font-bold text-lg">{checked.name}</p>}
                <div className="mt-3">
                  <label htmlFor="pfc-who">Your name</label>
                  <input id="pfc-who" value={who} onChange={(e) => setWho(e.target.value.slice(0, 30))} maxLength={30} placeholder="So they know it's you" autoComplete="given-name" />
                </div>
                {!phone && (
                  <div className="mt-3">
                    <label htmlFor="pfc-wa">Your WhatsApp number <span className="text-haze font-normal">(optional)</span></label>
                    <input id="pfc-wa" type="tel" inputMode="tel" value={whatsapp} onChange={(e) => setWhatsapp(clean(e.target.value, true))} maxLength={16} placeholder="08031234567" autoComplete="tel" />
                    <p className="text-xs text-haze mt-1.5">So {v.makerName} can message you your {exam ? "PIN" : "token"}. It also shows on this page.</p>
                  </div>
                )}
                <button type="button" onClick={join} disabled={busy !== null || who.trim().length < 2}
                  className="mt-4 w-full h-12 rounded-xl bg-cta text-oncta font-display font-bold hover:brightness-105 disabled:opacity-50">
                  {busy === "join" ? "Joining…" : "Join the giveaway"}
                </button>
              </div>
            )}
          </div>
        )}
        {err && <p className="text-bad text-sm mt-3" role="alert">{err}</p>}
        {loadErr && <p className="text-bad text-sm mt-3" role="alert">{loadErr}</p>}
      </div>
      <p className="text-xs text-haze mt-3 leading-relaxed">Check your number carefully: once delivered, a token or top-up can&rsquo;t be moved. Your number is only shown to {v.makerName}.</p>
    </>
  );
}

// ───────────────────────── the giver ─────────────────────────

function Owner({ v, ownerKey, reload }: { v: PfcView; ownerKey: string; reload: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const entries = v.entries ?? [];
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const link = `${origin}/c/${v.id}`;
  const text = pfcShareText({ makerName: v.makerName, budget: v.budget, categories: v.categories, link, note: v.note });
  const total = (v.amount ?? 0) + (v.fee ?? 0);
  const listOpen = v.status === "open" || v.status === "full";

  async function act(action: "remove" | "cancel" | "close", entryId?: string) {
    setBusy(entryId ?? action); setErr("");
    try {
      const r = await fetch(`/api/payforme/collect/${v.id}/manage`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: ownerKey, action, entryId }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "Something went wrong. Please try again.");
      return d;
    } catch (e: any) { setErr(e.message); return null; } finally { setBusy(null); }
  }

  // Close (or re-open the result of an earlier close), keep the giveaway on this device, then go and pay.
  async function closeAndPay(pay: boolean) {
    if (pay && !confirm(`Close the list and pay ${pfmMoney(total)} for ${entries.length} ${entries.length === 1 ? "person" : "people"}? Nobody else can join after this.`)) return;
    const d = await act("close");
    if (!d?.requestId) { reload(); return; }
    track("giveaway_close");
    const saved = { id: d.requestId, key: d.requestKey, name: d.makerName, total: d.total, at: Date.now(), give: true, note: d.note ?? "", email: d.makerEmail, names: d.names ?? [], phones: d.phones ?? [] };
    writePfmSaved([saved, ...readPfmSaved().filter((x) => x.id !== d.requestId)]);
    if (!pay) { window.location.href = `/r/${d.requestId}?k=${d.requestKey}`; return; }
    setBusy("pay");
    try {
      const r = await fetch(`/api/payforme/${d.requestId}/pay`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: d.makerEmail, name: d.makerName }) });
      const p = await r.json().catch(() => ({}));
      if (r.ok && p.url) { window.location.href = p.url; return; }
      setErr(`${p.error || "We couldn't start the payment."} The list is saved. Open the payment page to try again.`);
    } catch { setErr("Can't reach Nolgic. Check your connection, then open the payment page."); }
    setBusy(null); reload();
  }

  async function copy(t: string, tag: string) {
    try { await navigator.clipboard.writeText(t); } catch { /* ignore */ }
    setCopied(tag); setTimeout(() => setCopied(null), 1800);
  }

  return (
    <>
      <h1 className={h1} data-testid="owner-title">Your giveaway: {v.count} of {v.maxPeople} joined</h1>
      <p className="mt-3 text-haze leading-relaxed">
        {listOpen ? `Up to ${pfmMoney(v.budget)} of ${pfcChoiceText(v.categories)} each. Remove anyone you don't recognise, then close the list and pay once. Nothing is charged until you do.`
          : v.status === "closed" ? "The list is closed. Pay, or see each delivery, on the giveaway page."
          : v.status === "cancelled" ? "You cancelled this giveaway. Nothing was charged."
          : "This link has expired. Nothing was charged. Make a new one if you still want to give."}
      </p>

      {listOpen && (
        <div className="mt-6 rounded-2xl border border-line p-5">
          <p className="font-display font-bold">Share your link</p>
          <p className="text-sm text-haze break-all mt-1">{link}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <a href={whatsappShareUrl(text)} target="_blank" rel="noopener noreferrer" className={`${btn} bg-[#25D366] text-[#0b2a16] hover:brightness-105`}>Send on WhatsApp</a>
            <button type="button" onClick={() => copy(link, "link")} className="h-11 px-5 rounded-xl border border-paper/25 font-semibold hover:bg-sunk">{copied === "link" ? "Copied" : "Copy link"}</button>
          </div>
        </div>
      )}

      {v.status === "closed" && v.requestId && (
        <button type="button" onClick={() => closeAndPay(false)} disabled={busy !== null} className={`mt-6 ${btn} bg-cta text-oncta hover:brightness-105`} data-testid="open-request">
          {busy ? "Opening…" : "Open the giveaway page"}
        </button>
      )}

      {entries.length > 0 ? (
        <ul className="mt-7 space-y-2.5" data-testid="entries">
          {entries.map((e, n) => (
            <li key={e.id} className="rounded-xl border border-line p-4 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-semibold">{n + 1}. {e.who}</p>
                <p className="text-sm">{pfmTitle(e.billerName, e.itemName)}</p>
                <p className="text-sm text-haze break-all">{e.label}: {e.identifier}{e.customerName ? ` · ${e.customerName}` : ""}</p>
                <p className="text-sm num mt-0.5">{pfmMoney(e.amount)} <span className="text-haze">+ {pfmMoney(e.fee)} fee</span></p>
              </div>
              {listOpen && (
                <button type="button" onClick={async () => { if (confirm(`Remove ${e.who}?`)) { await act("remove", e.id); reload(); } }} disabled={busy !== null}
                  className="h-10 px-3 rounded-lg border border-paper/25 text-sm font-semibold hover:bg-sunk shrink-0 disabled:opacity-50" aria-label={`Remove ${e.who}`}>{busy === e.id ? "…" : "Remove"}</button>
              )}
            </li>
          ))}
        </ul>
      ) : listOpen ? <p className="mt-7 text-haze" role="status">Nobody has joined yet. This page updates by itself.</p> : null}

      {listOpen && entries.length > 0 && (
        <section className="mt-6 rounded-2xl border border-line p-5" aria-labelledby="sum">
          <h2 id="sum" className="font-display font-bold text-xl">What you&rsquo;ll pay</h2>
          <dl className="mt-3 text-sm space-y-1.5">
            <div className="flex justify-between"><dt className="text-haze">Bills</dt><dd className="num">{pfmMoney(v.amount ?? 0)}</dd></div>
            <div className="flex justify-between"><dt className="text-haze">Service fees</dt><dd className="num">{pfmMoney(v.fee ?? 0)}</dd></div>
            <div className="flex justify-between font-semibold text-base pt-1.5 border-t border-line"><dt>Total</dt><dd className="num" data-testid="total">{pfmMoney(total)}</dd></div>
          </dl>
          <button type="button" onClick={() => closeAndPay(true)} disabled={busy !== null}
            className="mt-4 w-full h-12 rounded-xl bg-cta text-oncta font-display font-bold hover:brightness-105 active:brightness-95 disabled:opacity-50" data-testid="close-pay">
            {busy === "close" ? "Checking everyone…" : busy === "pay" ? "Taking you to the payment page…" : `Close the list and pay ${pfmMoney(total)}`}
          </button>
          <p className="text-xs text-haze mt-3 leading-relaxed">Each choice is checked with the provider again before you pay. Anything we can&rsquo;t deliver is refunded to you automatically.</p>
        </section>
      )}

      {err && <p className="text-bad text-sm mt-4" role="alert">{err}</p>}

      {listOpen && (
        <button type="button" onClick={async () => { if (confirm("Cancel this giveaway? The link stops working. Nothing has been charged.")) { await act("cancel"); reload(); } }} disabled={busy !== null}
          className="mt-6 h-11 px-5 rounded-xl border border-paper/25 font-semibold hover:bg-sunk disabled:opacity-50">Cancel this giveaway</button>
      )}
      <p className="mt-6 text-sm text-haze">Keep this page private: whoever has it can manage your giveaway. It&rsquo;s also in your email ({v.makerEmail}).</p>
    </>
  );
}
