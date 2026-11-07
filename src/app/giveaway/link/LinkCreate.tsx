"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { track } from "@/lib/track";
import { GIVEAWAY_NOTES, cleanText } from "@/lib/gift";
import { ngnMaxOrder, ngnServiceFee } from "@/lib/ngn-fee";
import { readMyLinks, rememberMyLink, type PfcMine } from "@/lib/payforme-collect-local";
import { PFC_BUDGETS, PFC_CATEGORIES, PFC_CATEGORY_LABEL, PFC_MAX_PEOPLE, PFM_NOTE_MAX, pfcShareText, pfmMoney, type PfmCategory } from "@/lib/payforme-shared";
import { whatsappShareUrl } from "@/lib/share";

const CAT_TITLE: Record<PfmCategory, string> = { electricity: "Electricity", cable: "Cable TV", airtime: "Airtime", data: "Data" };
// A guide only: the server applies the real cap (PFM_MAX_TOTAL_NGN). If you raise that, set NEXT_PUBLIC_PFM_MAX_TOTAL_NGN to match.
const MAX_TOTAL = Number(process.env.NEXT_PUBLIC_PFM_MAX_TOTAL_NGN) > 0 ? Number(process.env.NEXT_PUBLIC_PFM_MAX_TOTAL_NGN) : 100000;

export default function LinkCreate() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [cats, setCats] = useState<PfmCategory[]>([...PFC_CATEGORIES]);
  const [budget, setBudget] = useState("2000");
  const [people, setPeople] = useState("10");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState<{ id: string; key: string } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [mine, setMine] = useState<PfcMine[]>([]);

  useEffect(() => { setMine(readMyLinks()); }, []);

  const b = Number(budget || 0);
  const n = Number(people || 0);
  const maxEach = ngnMaxOrder(500000);
  const worst = b > 0 ? Math.max(ngnServiceFee(b, "electricity"), ngnServiceFee(b, "tv"), ngnServiceFee(b, "airtime_data")) : 0;
  const most = b > 0 && n > 0 ? n * (b + worst) : 0;
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
  const valid = name.trim().length >= 2 && emailOk && cats.length > 0 && b >= 100 && b <= maxEach && n >= 1 && n <= PFC_MAX_PEOPLE;

  function toggle(c: PfmCategory) { setCats(cats.includes(c) ? cats.filter((x) => x !== c) : [...cats, c]); }

  async function create() {
    if (busy || !valid) return;
    setBusy(true); setErr("");
    try {
      const r = await fetch("/api/payforme/collect", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ makerName: name.trim(), makerEmail: email.trim(), note: note.trim() || undefined, budget: b, categories: cats, maxPeople: n }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.id) throw new Error(d.error || "Something went wrong. Please try again.");
      rememberMyLink({ id: d.id, key: d.key, at: Date.now(), budget: b, people: n });
      track("giveaway_link");
      setDone({ id: d.id, key: d.key });
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }

  async function copy(t: string, tag: string) {
    try { await navigator.clipboard.writeText(t); } catch { /* ignore */ }
    setCopied(tag); setTimeout(() => setCopied(null), 1800);
  }

  if (done) {
    const origin = window.location.origin;
    const link = `${origin}/c/${done.id}`;
    const own = `${origin}/c/${done.id}?k=${done.key}`;
    const text = pfcShareText({ makerName: name.trim(), budget: b, categories: cats, link, note: note.trim() || null });
    return (
      <main id="content" className="max-w-xl mx-auto px-5 pt-12 pb-24">
        <h1 className="font-display font-extrabold text-3xl sm:text-4xl leading-tight tracking-tight">Your giveaway link is ready</h1>
        <p className="mt-3 text-haze text-lg leading-relaxed">Send it to the people you&rsquo;re giving to, or post it in your group. Each person picks what they want and enters their own number. Nothing is charged until you close the list and pay.</p>
        <div className="mt-6 rounded-2xl border border-line p-5" data-testid="share">
          <pre className="whitespace-pre-wrap text-sm text-haze font-sans leading-relaxed">{text}</pre>
          <div className="mt-4 flex flex-wrap gap-2">
            <a href={whatsappShareUrl(text)} target="_blank" rel="noopener noreferrer" className="h-11 px-5 inline-flex items-center rounded-xl bg-[#25D366] text-[#0b2a16] font-display font-bold hover:brightness-105">Send on WhatsApp</a>
            <button type="button" onClick={() => copy(text, "msg")} className="h-11 px-5 rounded-xl border border-paper/25 font-semibold hover:bg-sunk">{copied === "msg" ? "Copied" : "Copy message"}</button>
          </div>
        </div>
        <div className="mt-4 rounded-2xl border border-tungsten/40 bg-cta/10 p-5">
          <p className="font-display font-bold">Your private page</p>
          <p className="text-haze text-sm leading-relaxed mt-1.5">See who has joined, remove anyone you don&rsquo;t know, then pay once for everyone. We&rsquo;ve also emailed it to you. Don&rsquo;t send this one to anyone.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <a href={own} className="h-11 px-5 inline-flex items-center rounded-xl bg-cta text-oncta font-display font-bold hover:brightness-105" data-testid="own">Open my giveaway</a>
            <button type="button" onClick={() => copy(own, "own")} className="h-11 px-5 rounded-xl border border-paper/25 font-semibold hover:bg-sunk">{copied === "own" ? "Copied" : "Copy my private link"}</button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main id="content" className="max-w-xl mx-auto px-5 pt-12 pb-24">
      <h1 className="font-display font-extrabold text-3xl sm:text-4xl leading-tight tracking-tight">Let them choose</h1>
      <p className="mt-3 text-haze text-lg leading-relaxed">Share one link. Each person picks their own light, airtime, data or TV and enters their own number. You check the list, then pay once for everyone.</p>
      <p className="mt-2 text-sm text-haze">Already have everyone&rsquo;s numbers? <Link href="/giveaway" className="text-tungsten underline underline-offset-2">Add them yourself instead</Link>.</p>

      {mine.length > 0 && (
        <div className="mt-6 rounded-2xl border border-line p-4">
          <p className="font-semibold text-sm">Your giveaway links</p>
          <ul className="mt-2 space-y-1.5">
            {mine.slice(0, 4).map((m) => (
              <li key={m.id}><a className="text-tungsten underline underline-offset-2" href={`/c/${m.id}?k=${m.key}`}>{new Date(m.at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })} · up to {pfmMoney(m.budget)} each · {m.people} {m.people === 1 ? "person" : "people"}</a></li>
            ))}
          </ul>
        </div>
      )}

      <section className="mt-8" aria-labelledby="from">
        <h2 id="from" className="font-display font-bold text-xl">Who is it from?</h2>
        <div className="mt-3">
          <label htmlFor="pfc-name">Your name</label>
          <input id="pfc-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Emeka" maxLength={60} autoComplete="name" />
        </div>
        <div className="mt-3">
          <label htmlFor="pfc-email">Your email</label>
          <input id="pfc-email" type="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Your private link, receipt and tokens go here" autoComplete="email" />
        </div>
        <div className="mt-3">
          <label htmlFor="pfc-note">Message for everyone <span className="text-haze font-normal">(optional)</span></label>
          <div className="flex flex-wrap gap-1.5 mb-2">
            {GIVEAWAY_NOTES.map((o) => <button key={o.key} type="button" onClick={() => setNote(o.note)} className="h-8 px-3 rounded-full border border-line text-[13px] font-semibold hover:border-paper/40 hover:bg-sunk">{o.label}</button>)}
          </div>
          <input id="pfc-note" value={note} onChange={(e) => setNote(cleanText(e.target.value, PFM_NOTE_MAX))} placeholder="Congratulations, you won! 🎉" maxLength={PFM_NOTE_MAX} />
        </div>
      </section>

      <section className="mt-10" aria-labelledby="what">
        <h2 id="what" className="font-display font-bold text-xl">What can they choose?</h2>
        <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2" role="group" aria-label="What people can choose">
          {PFC_CATEGORIES.map((c) => (
            <button key={c} type="button" aria-pressed={cats.includes(c)} onClick={() => toggle(c)}
              className={`h-11 rounded-xl border text-sm font-semibold ${cats.includes(c) ? "bg-paper text-night border-paper" : "border-line text-haze hover:border-paper/40"}`}>{CAT_TITLE[c]}</button>
          ))}
        </div>
        {!cats.length && <p className="text-sm text-bad mt-2" role="status">Pick at least one.</p>}

        <div className="mt-5">
          <label htmlFor="pfc-budget">Up to how much each? (₦)</label>
          <input id="pfc-budget" className="num" value={budget} onChange={(e) => setBudget(e.target.value.replace(/[^\d]/g, ""))} inputMode="numeric" maxLength={7} />
          <div className="flex gap-2 flex-wrap mt-2">
            {PFC_BUDGETS.filter((a) => a <= maxEach).map((a) => <button key={a} type="button" onClick={() => setBudget(String(a))} className={`px-3 h-9 rounded-full border text-sm num ${b === a ? "border-tungsten bg-cta/15 font-semibold" : "border-line text-haze hover:text-paper"}`}>{pfmMoney(a)}</button>)}
          </div>
          <p className="text-xs text-haze mt-2">Each person picks anything up to this. A TV or data plan that costs more won&rsquo;t show for them.</p>
          {(b > 0 && (b < 100 || b > maxEach)) && <p className="text-sm text-bad mt-2" role="status">Between ₦100 and {pfmMoney(maxEach)} each.</p>}
        </div>

        <div className="mt-5">
          <label htmlFor="pfc-people">How many people? (up to {PFC_MAX_PEOPLE})</label>
          <input id="pfc-people" className="num" value={people} onChange={(e) => setPeople(e.target.value.replace(/[^\d]/g, "").slice(0, 2))} inputMode="numeric" maxLength={2} />
          {(n > PFC_MAX_PEOPLE || (people !== "" && n < 1)) && <p className="text-sm text-bad mt-2" role="status">Between 1 and {PFC_MAX_PEOPLE} people.</p>}
          <p className="text-xs text-haze mt-2">The link stops taking people once it&rsquo;s full.</p>
        </div>
      </section>

      <section className="mt-10 rounded-2xl border border-line p-5" aria-labelledby="sum">
        <h2 id="sum" className="font-display font-bold text-xl">What you&rsquo;ll pay</h2>
        <p className="mt-2 text-sm text-haze leading-relaxed">Only what people actually choose, plus our normal service fee on each. You see the exact total before you pay.</p>
        {most > 0 && <p className="mt-2 text-sm">At most about <span className="font-semibold num">{pfmMoney(most)}</span> if all {n} take the full {pfmMoney(b)}.</p>}
        {most > MAX_TOTAL && <p className="text-sm text-bad mt-2" role="status">That&rsquo;s over {pfmMoney(MAX_TOTAL)} for one payment. Lower the amount or the number of people.</p>}
        {err && <p className="text-bad text-sm mt-3" role="alert">{err}</p>}
        <button type="button" onClick={create} disabled={busy || !valid}
          className="mt-4 w-full h-12 rounded-xl bg-cta text-oncta font-display font-bold hover:brightness-105 active:brightness-95 disabled:opacity-50">
          {busy ? "Making your link…" : "Make my giveaway link"}
        </button>
        {(name.trim().length < 2 || !emailOk) && <p className="text-xs text-haze mt-2">Add your name and email above first.</p>}
      </section>
    </main>
  );
}
