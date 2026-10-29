"use client";

import Logo from "@/components/Logo";
import { useEffect, useMemo, useState } from "react";
import { allCountries, getCountry, type CountryCode } from "@/lib/countries";

type BillerItem = {
  biller_code: string;
  item_code: string;
  name: string;
  biller_name: string;
  short_name: string;
  amount: number;
  is_airtime: boolean;
  label_name: string;
};

// Naira (Nigeria-domestic) checkout stays hidden until Paystack is live:
// set NEXT_PUBLIC_NGN_PAY_ENABLED=1 in Vercel to show it.
const NGN_ENABLED = process.env.NEXT_PUBLIC_NGN_PAY_ENABLED === "1";
// Launch switches (all default OFF — set to "1" in Vercel to open each one):
//   NEXT_PUBLIC_UK_PAY_ENABLED  pay in £ by card (Stripe)
//   NEXT_PUBLIC_GH_ENABLED      Ghana
// While UK is off the site runs as a Nigeria-only, pay-in-naira product and
// shows UK / Ghana as "coming soon".
const UK_ENABLED = process.env.NEXT_PUBLIC_UK_PAY_ENABLED === "1";
const GH_ENABLED = process.env.NEXT_PUBLIC_GH_ENABLED === "1";
const ANY_PAY = NGN_ENABLED || UK_ENABLED;
const DOMESTIC = !UK_ENABLED;
const NGN_FEE = Number(process.env.NEXT_PUBLIC_NG_LOCAL_FEE_NGN ?? "100");

const itemKey = (i: BillerItem) => `${i.biller_code}:${i.item_code}:${i.short_name ?? i.name}`;

// Country-agnostic category matchers (work for NG discos AND GH's ECG etc.)
const TABS = [
  { key: "electricity", label: "Electricity", match: (b: BillerItem) => /ELECTRIC|DISCO|PREPAID METER|EKEDC|IKEDC|EEDC|AEDC|IBEDC|PHED|KEDCO|BEDC|JED|YEDC|ABUJA|ENUGU DISCO|KANO DISCO|KADUNA|ECG|ELECTRICITY COMPANY/i.test(b.biller_name + " " + b.name) },
  { key: "cable", label: "Cable TV", match: (b: BillerItem) => /DSTV|GOTV|STARTIMES|SHOWMAX/i.test(b.biller_name + " " + b.name) },
  { key: "airtime", label: "Airtime", match: (b: BillerItem) => b.is_airtime || /VTU|AIRTIME/i.test(b.biller_name + " " + b.name + " " + (b.short_name ?? "")) },
  { key: "data", label: "Data", match: (b: BillerItem) => /DATA|BROADBAND|SURFLINE|BUNDLE|POSTPAID PAYMENT/i.test(b.biller_name + " " + b.name) && !b.is_airtime },
];

const CHECKS = [
  "Name-check before you pay",
  "Automatic refund if delivery fails",
  "No account, no app",
];

const CATEGORIES = [
  {
    title: "Electricity",
    text: "Prepaid meter tokens, issued in seconds. The token is shown to you and sent to their phone.",
    names: GH_ENABLED ? "IKEDC · EKEDC · AEDC · IBEDC · PHED · ECG (Ghana) and more" : "IKEDC · EKEDC · AEDC · IBEDC · PHED and more",
    icon: <path d="M13 2L5 13.5h6L10 22l9-12h-6.2L13 2z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />,
  },
  {
    title: "Cable TV",
    text: "Renew the decoder from your phone. Confirm the account holder's name, then pay.",
    names: "DStv · GOtv · StarTimes",
    icon: (<><rect x="3" y="5" width="18" height="12" rx="2" fill="none" stroke="currentColor" strokeWidth="2" /><path d="M8 21h8M12 17v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></>),
  },
  {
    title: "Airtime",
    text: "Credit lands on the phone instantly. Enter the number and the amount.",
    names: "MTN · Glo · Airtel · 9mobile",
    icon: (<><rect x="7" y="2.5" width="10" height="19" rx="2.5" fill="none" stroke="currentColor" strokeWidth="2" /><path d="M11 18.5h2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></>),
  },
  {
    title: "Data",
    text: "Data bundles and home broadband for the people you keep connected.",
    names: GH_ENABLED ? "Mobile bundles · Surfline and Vodafone broadband (Ghana)" : "Mobile bundles and home broadband",
    icon: (<><path d="M3 9.5a14 14 0 0118 0M6 13a9.5 9.5 0 0112 0M9.3 16.4a5 5 0 015.4 0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /><circle cx="12" cy="19.5" r="1.4" fill="currentColor" /></>),
  },
];

const FAQS_DIASPORA = [
  { q: "Which countries does Nolgic support?", a: "Nigeria and Ghana today — electricity, TV subscriptions, airtime and data in both. We're building Nolgic as one tool for paying bills across Africa, and more countries are on the way. Pick the country at the top of the payment form." },
  { q: "How do I pay a NEPA / electricity bill in Nigeria from the UK?", a: "Pick the DisCo (EKEDC, IKEDC, EEDC and others), enter the meter number, and we show you the registered account name. Pay in pounds by card and the prepaid token is issued in seconds — we show it on screen, email it to you, and can send it to your family's phone." },
  { q: "Can I pay for DSTV or GOTV from abroad?", a: "Yes. Choose the package, enter the smartcard/IUC number, confirm the account holder's name we look up, and pay by card. The decoder is credited within seconds — no one in Nigeria needs to queue or do anything." },
  { q: "How do I buy MTN, Airtel or Glo airtime from the UK?", a: "Select the network, enter the phone number and amount, and pay in pounds. The airtime lands on the phone instantly. Data bundles work the same way." },
  ...(NGN_ENABLED ? [
    { q: "Can I pay from inside Nigeria, in naira?", a: "Yes. Choose \"Nigeria — pay in ₦\" at the top of the payment form and pay by card, bank transfer or USSD. The token or top-up is delivered in seconds, with the same name-check and automatic refund if delivery fails." },
  ] : []),
  { q: "Is Nolgic a money transfer service?", a: "No — you're buying a prepaid product (a token, subscription or top-up) at a price shown upfront. We deliver the product directly; we never move money to a person." },
  { q: "What happens if delivery fails?", a: "You're refunded automatically and in full. You can never pay for something that wasn't delivered." },
  { q: "What does it cost?", a: "The price shown at checkout is everything — the product price plus a small service fee. No hidden exchange-rate surprises after the fact." },
];

const FAQS_DOMESTIC = [
  { q: "Which countries does Nolgic support?", a: "Nigeria today, paid in naira. Payments from the UK in pounds, and Ghana, are coming soon." },
  { q: "How do I buy electricity (NEPA) with Nolgic?", a: "Pick your DisCo (EKEDC, IKEDC, EEDC and others), enter the meter number, and we show you the registered account name. Pay by card, bank transfer or USSD and the prepaid token is issued in seconds — we show it on screen, email it to you, and can send it to another phone." },
  { q: "Can I pay for DSTV or GOTV?", a: "Yes. Choose the package, enter the smartcard/IUC number, confirm the account holder's name we look up, and pay. The decoder is credited within seconds." },
  { q: "How do I buy MTN, Airtel or Glo airtime and data?", a: "Select the network, enter the phone number and the amount, and pay. The airtime or data lands on the phone instantly." },
  { q: "Is Nolgic a money transfer service?", a: "No — you're buying a prepaid product (a token, subscription or top-up) at a price shown upfront. We deliver the product directly; we never move money to a person." },
  { q: "What happens if delivery fails?", a: "You're refunded automatically and in full. You can never pay for something that wasn't delivered." },
  { q: "What does it cost?", a: `The price shown at checkout is everything — the amount you're buying plus a small service fee of ₦${NGN_FEE.toLocaleString()}.` },
];

const FAQS = DOMESTIC ? FAQS_DOMESTIC : FAQS_DIASPORA;

const STEPS = [
  { n: "1", title: "Pick the bill", text: "Electricity token, DSTV, GOTV, airtime or data — for any meter, decoder or phone number." },
  { n: "2", title: "See who you're paying", text: "We look the number up with the provider and show you the registered name. You confirm it's your people before any money moves." },
  { n: "3", title: "Pay. Done.", text: DOMESTIC
      ? "Pay by card, bank transfer or USSD. Delivery lands in seconds, and the receipt goes to their phone — token included."
      : NGN_ENABLED
        ? "Card checkout in pounds, or pay in naira from inside Nigeria. Delivery lands in seconds, and the receipt goes to their phone — token included."
        : "Card checkout in pounds. Delivery lands in seconds, and the receipt goes to their phone — token included." },
];

const eyebrow = "font-mono text-xs uppercase tracking-[0.25em] text-tungsten";
const h2 = "font-display font-extrabold text-3xl md:text-4xl leading-[1.08]";

export default function Home() {
  const [country, setCountry] = useState<CountryCode>("NG");
  const [payIn, setPayIn] = useState<"gbp" | "ngn">(UK_ENABLED ? "gbp" : "ngn");
  const [items, setItems] = useState<BillerItem[]>([]);
  const [tab, setTab] = useState("electricity");
  const [item, setItem] = useState<BillerItem | null>(null);
  const [identifier, setIdentifier] = useState("");
  const [amountLocal, setAmountLocal] = useState("");
  const [email, setEmail] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [validated, setValidated] = useState<{ name: string | null } | null>(null);
  const [busy, setBusy] = useState<"validate" | "pay" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cfg = getCountry(country);
  const inNgn = NGN_ENABLED && payIn === "ngn" && country === "NG";
  const fmtLocal = (n: number) => `${cfg.currencySymbol}${Number(n).toLocaleString()}`;

  // Reload billers whenever the country changes; reset the in-progress order.
  useEffect(() => {
    setItems([]); setItem(null); setValidated(null); setIdentifier(""); setAmountLocal("");
    fetch(`/api/billers?country=${country}`)
      .then((r) => r.json())
      .then((d) => setItems(d.items ?? []))
      .catch(() => setError("Could not load billers. Refresh to retry."));
  }, [country]);

  const tabItems = useMemo(() => {
    const t = TABS.find((t) => t.key === tab)!;
    return items.filter(t.match);
  }, [items, tab]);

  const fixedAmount = item && item.amount > 0;
  // FLW returns some countries' fixed prices in minor units (GH: pesewas).
  const fixedLocal = item && item.amount > 0 ? item.amount / cfg.fixedAmountDivisor : 0;
  const billAmount = fixedAmount ? fixedLocal : Number(amountLocal || 0);
  const ngnTotal = billAmount + NGN_FEE;
  const isNoValidate = (i: BillerItem | null) =>
    !!i && (i.is_airtime || /VTU|AIRTIME|DATA|BROADBAND|SURFLINE|POSTPAID PAYMENT/i.test(i.biller_name + " " + i.name));

  async function validate() {
    if (!item || !identifier) return;
    if (isNoValidate(item)) { setValidated({ name: null }); setError(null); return; }
    setBusy("validate"); setError(null); setValidated(null);
    try {
      const r = await fetch("/api/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemCode: item.item_code, billerCode: item.biller_code, identifier }),
      });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error);
      setValidated({ name: d.name });
    } catch (e: any) { setError(e.message); } finally { setBusy(null); }
  }

  async function pay() {
    if (!item || !validated) return;
    setBusy("pay"); setError(null);
    try {
      const r = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          country,
          payIn: inNgn ? "ngn" : "gbp",
          email,
          billerCode: item.biller_code,
          itemCode: item.item_code,
          billerName: item.biller_name,
          identifier,
          identifierLabel: item.label_name || "Account number",
          amountLocal: fixedAmount ? fixedLocal : Number(amountLocal),
          recipientWhatsapp: whatsapp || null,
        }),
      });
      const d = await r.json();
      if (d.error) throw new Error(d.error);
      window.location.href = d.url;
    } catch (e: any) { setError(e.message); setBusy(null); }
  }

  const heroSub = DOMESTIC
    ? "Pay for electricity, DStv, GOtv, airtime and data from your phone, in naira. You see who you\u2019re paying before any money moves."
    : null;
  const payLine = NGN_ENABLED
    ? "Pay in pounds from the UK, or in naira from inside Nigeria. You see who you\u2019re paying before any money moves."
    : "Pay in pounds, straight from your card. You see who you\u2019re paying before any money moves.";

  const stepBox = "mt-5 pt-5 border-t border-line";
  const pill = (on: boolean) =>
    `px-3.5 py-2 rounded-full text-sm border-2 font-semibold ${on ? "bg-tungsten text-white dark:text-night border-paper" : "border-line text-haze hover:border-tungsten/60"}`;

  return (
    <main>
      {/* ───────── HERO + PAY FORM ───────── */}
      <section className="max-w-5xl mx-auto px-5 pt-10 pb-20 grid lg:grid-cols-[1.05fr_0.95fr] gap-12 items-start">
        <div className="lg:pt-6">
          <p className={eyebrow}>{DOMESTIC ? "Nigeria · UK and Ghana payments coming soon" : "Nigeria · Ghana · More of Africa, soon"}</p>
          <h1 className="font-display font-extrabold text-5xl md:text-6xl leading-[1.02] tracking-tight mt-5">
            {DOMESTIC ? "Light, TV, airtime and data," : "The bills back home,"}{" "}
            <span className="text-tungsten">paid in seconds.</span>
          </h1>
          <p className="text-haze mt-6 text-lg leading-relaxed max-w-xl">
            {heroSub ?? <>Electricity, TV, airtime and data for Nigeria and Ghana. {payLine}</>}
          </p>
          <div className="flex gap-3 mt-8 flex-wrap">
            <a href="#pay" className="px-6 py-3.5 rounded-xl bg-tungsten text-white dark:text-night font-display font-bold text-lg shadow-glow hover:brightness-110">Pay a bill now</a>
            <a href="#how" className="px-6 py-3.5 rounded-xl border-2 border-paper font-display font-bold text-lg hover:bg-panel">How it works</a>
          </div>
          <ul className="mt-9 flex flex-wrap gap-x-6 gap-y-3 text-sm">
            {CHECKS.map((c) => (
              <li key={c} className="flex items-center gap-2">
                <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" className="text-ok">
                  <path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                {c}
              </li>
            ))}
          </ul>

          <div aria-hidden="true" className="mt-12 hidden lg:block max-w-sm rounded-2xl bg-paper text-night px-5 py-4 ml-8">
            <p className="font-mono text-[11px] uppercase tracking-[0.2em] opacity-80">Delivered to their phone</p>
            <p className="font-mono text-lg tracking-widest mt-1.5">4521 8830 9917 2264 0053</p>
          </div>
        </div>

        {/* The real payment form */}
        <div id="pay" className="scroll-mt-24 w-full">
          <div className="bg-panel border-2 border-paper rounded-3xl p-5 sm:p-6 shadow-glow">
            <h2 className="sr-only">Pay a bill</h2>

            {!ANY_PAY && (
              <div className="py-6 text-center">
                <p className="font-mono text-xs text-tungsten uppercase tracking-[0.25em]">Opening soon</p>
                <p className="font-display font-extrabold text-2xl mt-3">Payments open very shortly.</p>
                <p className="text-haze text-sm mt-3 leading-relaxed">We&rsquo;re finishing the last checks. Message <a href="mailto:nolgichq@gmail.com?subject=Tell%20me%20when%20Nolgic%20opens" className="text-tungsten underline underline-offset-2">nolgichq@gmail.com</a> and we&rsquo;ll tell you the day it opens.</p>
              </div>
            )}
{ANY_PAY && (<>

            {ANY_PAY && (
              <div className="mb-5">
                <p className="font-mono text-xs text-haze uppercase tracking-widest mb-3">Where are you paying from?</p>
                <div className="grid grid-cols-2 gap-1.5 rounded-xl bg-night p-1.5 border border-line">
                  {([
                    { k: "gbp", label: "UK or abroad · £", on: UK_ENABLED },
                    { k: "ngn", label: "Nigeria · ₦", on: NGN_ENABLED },
                  ] as const).map((o) => (
                    <button
                      key={o.k}
                      type="button"
                      disabled={!o.on}
                      aria-disabled={!o.on}
                      onClick={() => { if (!o.on) return; setPayIn(o.k); if (o.k === "ngn") { setCountry("NG"); setTab("electricity"); } }}
                      className={`rounded-lg px-2 py-2.5 text-sm font-semibold leading-tight ${
                        !o.on ? "text-haze/60 cursor-not-allowed" : payIn === o.k ? "bg-paper text-night" : "text-haze hover:text-paper"
                      }`}
                    >
                      {o.label}
                      {!o.on && <span className="block font-mono text-[10px] uppercase tracking-widest mt-0.5">Coming soon</span>}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {!inNgn && (
              <div className="mb-5">
                <p className="font-mono text-xs text-haze uppercase tracking-widest mb-3">Country</p>
                <div className="flex gap-2 flex-wrap">
                  {allCountries().map((c) => {
                    const on = c.code === "GH" ? GH_ENABLED : true;
                    return (
                      <button
                        key={c.code}
                        type="button"
                        disabled={!on}
                        aria-disabled={!on}
                        onClick={() => { if (!on) return; setCountry(c.code); setTab("electricity"); }}
                        className={`${on ? pill(country === c.code) : "px-3.5 py-2 rounded-full text-sm border-2 border-line text-haze/60 cursor-not-allowed"} flex items-center gap-2`}
                      >
                        <span className="font-mono text-xs opacity-80">{c.code}</span> {c.name}
                        {!on && <span className="font-mono text-[10px] uppercase tracking-widest">Coming soon</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div className={NGN_ENABLED || !inNgn ? "pt-5 border-t border-line" : ""}>
              <p className="font-mono text-xs text-haze uppercase tracking-widest mb-3">1 · What are you paying?</p>
              <div className="flex gap-2 flex-wrap mb-4">
                {TABS.map((t) => (
                  <button key={t.key} onClick={() => { setTab(t.key); setItem(null); setValidated(null); }} className={pill(tab === t.key)}>
                    {t.label}
                  </button>
                ))}
              </div>
              <label>Provider / plan</label>
              <select value={item ? itemKey(item) : ""} onChange={(e) => { const found = tabItems.find((i) => itemKey(i) === e.target.value) ?? null; setItem(found); setValidated(null); }}>
                <option value="">{tabItems.length ? "Select…" : "No options for this category yet"}</option>
                {tabItems.map((i) => (
                  <option key={itemKey(i)} value={itemKey(i)}>{i.name}{i.amount > 0 ? ` — ${fmtLocal(i.amount / cfg.fixedAmountDivisor)}` : ""}</option>
                ))}
              </select>
            </div>

            {item && (
              <div className={stepBox}>
                <p className="font-mono text-xs text-haze uppercase tracking-widest mb-3">2 · Who is it for?</p>
                <label>{item.label_name || "Account number"}</label>
                <input value={identifier} onChange={(e) => { setIdentifier(e.target.value); setValidated(null); }}
                  placeholder={isNoValidate(item) ? cfg.identifierExamples.phone : cfg.identifierExamples.electricity}
                  inputMode={isNoValidate(item) ? "tel" : "text"} />
                {!fixedAmount && (
                  <div className="mt-3">
                    <label>Amount ({cfg.currencySymbol})</label>
                    <input value={amountLocal} onChange={(e) => setAmountLocal(e.target.value.replace(/[^\d]/g, ""))} placeholder="10000" inputMode="numeric" />
                  </div>
                )}
                <button onClick={validate} disabled={busy !== null || !identifier}
                  className="mt-4 w-full py-3 rounded-xl border-2 border-tungsten text-tungsten font-semibold hover:bg-tungsten/10 disabled:opacity-40">
                  {busy === "validate" ? "Checking…" : isNoValidate(item) ? "Confirm number" : "Check account name"}
                </button>
                {validated && (
                  <div className="mt-4 border-2 border-ok/40 bg-ok/10 rounded-xl p-4">
                    <p className="font-mono text-xs text-ok uppercase tracking-widest mb-1">{validated.name ? "Account found" : "Number confirmed"}</p>
                    <p className="font-display text-xl font-semibold">{validated.name ?? identifier}</p>
                    <p className="text-haze text-sm mt-1">Confirm this is who you meant — bill payments can&rsquo;t be reversed once delivered.</p>
                  </div>
                )}
              </div>
            )}

            {validated && (
              <div className={stepBox}>
                <p className="font-mono text-xs text-haze uppercase tracking-widest mb-3">3 · Pay in {inNgn ? "naira" : "pounds"}</p>
                <label>Your email (for your receipt)</label>
                <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" inputMode="email" />
                <div className="mt-3">
                  <label>Their mobile number (optional — we send them the receipt and token)</label>
                  <input value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} placeholder={country === "GH" ? "+233..." : "+234..."} inputMode="tel" />
                </div>
                {inNgn && billAmount > 0 && (
                  <div className="mt-4 rounded-xl border border-line p-4 text-sm">
                    <div className="flex justify-between text-haze"><span>{item?.name}</span><span>{fmtLocal(billAmount)}</span></div>
                    <div className="flex justify-between text-haze mt-1"><span>Service fee</span><span>{fmtLocal(NGN_FEE)}</span></div>
                    <div className="flex justify-between font-semibold mt-2 pt-2 border-t border-line"><span>Total</span><span>{fmtLocal(ngnTotal)}</span></div>
                  </div>
                )}
                <button onClick={pay} disabled={busy !== null || !email || (!fixedAmount && !amountLocal)}
                  className="mt-5 w-full py-3.5 rounded-xl bg-tungsten text-white dark:text-night font-display font-bold text-lg shadow-glow hover:brightness-110 disabled:opacity-40">
                  {busy === "pay" ? "Opening secure checkout…" : inNgn && billAmount > 0 ? `Pay ${fmtLocal(ngnTotal)}` : "Continue to payment"}
                </button>
                <p className="text-haze text-xs mt-3 text-center">
                  {inNgn
                    ? "Pay by card, bank transfer or USSD — secured by Paystack. If delivery fails, you\u2019re refunded automatically."
                    : "Card payment handled by Stripe. If delivery fails, you\u2019re refunded automatically — you can never lose money."}
                </p>
              </div>
            )}
</>)}
          </div>

          {error && <div role="alert" className="mt-4 border border-bad/40 bg-bad/10 rounded-xl p-4 text-bad text-sm">{error}</div>}
        </div>
      </section>

      {/* ───────── WHAT YOU CAN PAY ───────── */}
      <section className="bg-panel border-y border-line">
        <div className="max-w-5xl mx-auto px-5 py-20">
          <p className={eyebrow}>What you can pay</p>
          <h2 className={`${h2} mt-3 mb-10 max-w-2xl`}>Four things that keep a household running.</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {CATEGORIES.map((c) => (
              <div key={c.title} className="bg-night border-2 border-paper/90 rounded-2xl p-5">
                <div className="w-11 h-11 rounded-xl bg-tungsten text-white dark:text-night flex items-center justify-center">
                  <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">{c.icon}</svg>
                </div>
                <h3 className="font-display font-extrabold text-xl mt-4 mb-1.5">{c.title}</h3>
                <p className="text-haze text-sm leading-relaxed">{c.text}</p>
                <p className="text-haze/80 text-xs mt-3">{c.names}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ───────── HOW IT WORKS ───────── */}
      <section id="how" className="max-w-5xl mx-auto px-5 py-20 scroll-mt-20">
        <p className={eyebrow}>How it works</p>
        <h2 className={`${h2} mt-3 mb-10 max-w-2xl`}>One minute from your phone to their <span className="text-tungsten">light</span>.</h2>
        <div className="grid md:grid-cols-3 gap-8">
          {STEPS.map((s) => (
            <div key={s.n} className="border-t-4 border-paper pt-5">
              <p className="font-display font-extrabold text-6xl leading-none text-tungsten">{s.n}</p>
              <p className="font-display font-extrabold text-xl mt-3 mb-2">{s.title}</p>
              <p className="text-haze leading-relaxed">{s.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ───────── COUNTRIES ───────── */}
      <section className="bg-paper text-night">
        <div className="max-w-5xl mx-auto px-5 py-20">
          <p className="font-mono text-xs uppercase tracking-[0.25em] opacity-70">Where it works</p>
          <h2 className={`${h2} mt-3 mb-10 max-w-2xl`}>{DOMESTIC ? "One tool for paying bills across Africa. Starting in Nigeria." : "One tool for paying bills across Africa. Starting with two countries."}</h2>
          <div className="grid md:grid-cols-3 gap-4">
            <div className="rounded-2xl border-2 border-night p-6">
              <div className="flex items-center gap-3">
                <span className="w-11 h-11 rounded-xl bg-tungsten text-white dark:text-night font-extrabold flex items-center justify-center text-sm">NG</span>
                <h3 className="font-display font-extrabold text-2xl">Nigeria</h3>
              </div>
              <p className="mt-4 text-[15px] leading-relaxed opacity-85">Electricity from every major DisCo, DStv, GOtv and StarTimes, plus airtime and data on every network.</p>
              <p className="mt-3 text-sm font-bold">
                {NGN_ENABLED && UK_ENABLED ? "Pay in £ from abroad, or in ₦ from inside Nigeria"
                  : NGN_ENABLED ? "Pay in ₦ by card, bank transfer or USSD"
                  : UK_ENABLED ? "Pay in £ from abroad"
                  : "Opening soon"}
              </p>
            </div>
            {GH_ENABLED ? (
              <div className="rounded-2xl border-2 border-night p-6">
                <div className="flex items-center gap-3">
                  <span className="w-11 h-11 rounded-xl bg-tungsten text-white dark:text-night font-extrabold flex items-center justify-center text-sm">GH</span>
                  <h3 className="font-display font-extrabold text-2xl">Ghana</h3>
                </div>
                <p className="mt-4 text-[15px] leading-relaxed opacity-85">ECG electricity, DStv and GOtv, MTN, Vodafone and Tigo airtime, plus Surfline and Vodafone broadband.</p>
                <p className="mt-3 text-sm font-bold">Pay in £ from abroad</p>
              </div>
            ) : (
              <div className="rounded-2xl border-2 border-dashed border-night/50 p-6">
                <div className="flex items-center gap-3">
                  <span className="w-11 h-11 rounded-xl border-2 border-dashed border-night/50 font-extrabold flex items-center justify-center text-sm">GH</span>
                  <h3 className="font-display font-extrabold text-2xl">Ghana</h3>
                </div>
                <p className="mt-4 text-[15px] leading-relaxed opacity-85">Electricity, TV, airtime and data are built and on the way.</p>
                <p className="mt-3 text-sm font-bold">Coming soon</p>
              </div>
            )}
            {UK_ENABLED ? (
              <div className="rounded-2xl border-2 border-dashed border-night/50 p-6">
                <div className="flex items-center gap-3">
                  <span className="w-11 h-11 rounded-xl border-2 border-dashed border-night/50 font-extrabold flex items-center justify-center text-xl">+</span>
                  <h3 className="font-display font-extrabold text-2xl">More soon</h3>
                </div>
                <p className="mt-4 text-[15px] leading-relaxed opacity-85">Every new country is the same promise: see the name, pay, get delivery — or get your money back.</p>
              </div>
            ) : (
              <div className="rounded-2xl border-2 border-dashed border-night/50 p-6">
                <div className="flex items-center gap-3">
                  <span className="w-11 h-11 rounded-xl border-2 border-dashed border-night/50 font-extrabold flex items-center justify-center text-sm">UK</span>
                  <h3 className="font-display font-extrabold text-2xl">Pay from the UK</h3>
                </div>
                <p className="mt-4 text-[15px] leading-relaxed opacity-85">Pay in pounds by card for family back home.</p>
                <p className="mt-3 text-sm font-bold">Coming soon</p>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ───────── STORY / COMING SOON ───────── */}
      {DOMESTIC ? (
        <section className="max-w-2xl mx-auto px-5 pt-20 pb-6">
          <p className={eyebrow}>Coming soon</p>
          <h2 className={`${h2} mt-3 mb-6`}>Paying from the UK or Ghana?</h2>
          <p className="text-haze text-lg leading-relaxed">Payments in pounds for family in Nigeria, and bills in Ghana, are on the way. Tell us you&rsquo;re waiting and we&rsquo;ll let you know the day they open: <a href="mailto:nolgichq@gmail.com?subject=Tell%20me%20when%20UK%20payments%20open" className="text-tungsten underline underline-offset-2">nolgichq@gmail.com</a>.</p>
        </section>
      ) : (
      <section className="max-w-2xl mx-auto px-5 pt-20 pb-6">
        <p className={eyebrow}>Why Nolgic exists</p>
        <h2 className={`${h2} mt-3 mb-6`}>Every Sunday call ends the same way.</h2>
        <div className="text-haze text-lg leading-relaxed space-y-4">
          <p>&ldquo;NEPA has taken the light.&rdquo; &ldquo;The DSTV has expired.&rdquo; &ldquo;Send me credit.&rdquo; If you&rsquo;re abroad, you know the list — and the old routine: send money through an app, lose a chunk to fees and rates, then wait and hope somebody queues at the right kiosk.</p>
          <p>Nolgic skips the middle. You&rsquo;re not sending money — you&rsquo;re buying the actual thing: the token, the subscription, the top-up, delivered straight to the meter, decoder or phone in seconds. The price you see is everything you pay.</p>
          <p className="text-paper font-semibold">Designed in London — because we make the same Sunday calls.</p>
        </div>
      </section>
      )}

      {/* ───────── FAQ ───────── */}
      <section id="faq" className="max-w-2xl mx-auto px-5 pt-14 pb-20 scroll-mt-20">
        <h2 className="font-display font-extrabold text-3xl mb-6">Questions, answered.</h2>
        <div className="space-y-3">
          {FAQS.map((f) => (
            <details key={f.q} className="bg-panel border-2 border-line rounded-2xl p-5 group">
              <summary className="font-display font-semibold cursor-pointer list-none flex justify-between items-center gap-4">
                {f.q}
                <span className="text-tungsten group-open:rotate-45 transition-transform text-xl leading-none">+</span>
              </summary>
              <p className="text-haze text-sm leading-relaxed mt-3">{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify([
        { "@context": "https://schema.org", "@type": "Organization", name: "Nolgic", url: process.env.NEXT_PUBLIC_APP_URL ?? "https://nolgic.com", logo: `${process.env.NEXT_PUBLIC_APP_URL ?? "https://nolgic.com"}/logo.svg`, email: "nolgichq@gmail.com" },
        { "@context": "https://schema.org", "@type": "WebSite", name: "Nolgic", url: process.env.NEXT_PUBLIC_APP_URL ?? "https://nolgic.com" },
        { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: FAQS.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })) },
      ]) }} />

      <footer className="max-w-5xl mx-auto px-5 pt-6 pb-16 border-t border-line text-haze text-xs leading-relaxed">
        <div className="mb-4 mt-6 opacity-90"><Logo size="sm" /></div>
        <p>Nolgic sells prepaid digital products (tokens, subscriptions, top-ups) — it is not a money transfer service. <a href="/legal" className="text-tungsten underline underline-offset-2">Terms, refunds &amp; privacy</a></p>
        <p className="mt-2">Designed in London · © {new Date().getFullYear()} Nolgic</p>
      </footer>
    </main>
  );
}
