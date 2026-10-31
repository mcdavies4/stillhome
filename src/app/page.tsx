"use client";

import Logo from "@/components/Logo";
import { useEffect, useMemo, useState } from "react";
import { allCountries, getCountry, type CountryCode } from "@/lib/countries";
import { ngnFeeSettings, ngnServiceFee } from "@/lib/ngn-fee";

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

// Naira (Nigeria-domestic) checkout stays hidden until a naira rail (Paystack or Flutterwave) is live:
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
const FEE_SET = ngnFeeSettings();

const itemKey = (i: BillerItem) => `${i.biller_code}:${i.item_code}:${i.short_name ?? i.name}`;

// Country-agnostic category matchers (work for NG discos AND GH's ECG etc.)
const TABS = [
  { key: "electricity", label: "Electricity", match: (b: BillerItem) => /ELECTRIC|DISCO|PREPAID METER|EKEDC|IKEDC|EEDC|AEDC|IBEDC|PHED|KEDCO|BEDC|JED|YEDC|ABUJA|ENUGU DISCO|KANO DISCO|KADUNA|ECG|ELECTRICITY COMPANY/i.test(b.biller_name + " " + b.name) },
  { key: "cable", label: "Cable TV", match: (b: BillerItem) => /DSTV|GOTV|STARTIMES|SHOWMAX/i.test(b.biller_name + " " + b.name) },
  { key: "airtime", label: "Airtime", match: (b: BillerItem) => b.is_airtime || /VTU|AIRTIME/i.test(b.biller_name + " " + b.name + " " + (b.short_name ?? "")) },
  { key: "data", label: "Data", match: (b: BillerItem) => /DATA|BROADBAND|SURFLINE|BUNDLE|POSTPAID PAYMENT/i.test(b.biller_name + " " + b.name) && !b.is_airtime },
];

const CHECKS = [
  { title: "See the name first", text: "We look up the meter, smartcard or number and show who it belongs to before you pay." },
  { title: "Refunded if it fails", text: "If delivery doesn\u2019t go through, your money goes back to you automatically." },
  { title: "No account needed", text: "Just an email address for your receipt. Nothing to download." },
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
  { q: "What does it cost?", a: `The price shown at checkout is everything — the amount you're buying plus a small service fee (${FEE_SET.pct}% of the amount, minimum ₦${FEE_SET.min.toLocaleString()}, maximum ₦${FEE_SET.max.toLocaleString()}).` },
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

const BRANDS = "MTN, Airtel, Glo, 9mobile, DStv, GOtv, StarTimes and every major electricity company";

const h2 = "font-display font-bold text-3xl md:text-[2.6rem] leading-[1.08] tracking-tight";

// Provider names from the catalogue read better without the "VTU" suffix.
const niceName = (n: string) => n.replace(/\s+VTU$/i, "");

const LABELS: Record<string, { provider: string; plan: string }> = {
  electricity: { provider: "Electricity company", plan: "Meter type" },
  cable: { provider: "TV provider", plan: "Package" },
  airtime: { provider: "Network", plan: "Amount" },
  data: { provider: "Network or provider", plan: "Data plan" },
};

const QUICK_AMOUNTS = [200, 500, 1000, 2000, 5000];

export default function Home() {
  const [country, setCountry] = useState<CountryCode>("NG");
  const [payIn, setPayIn] = useState<"gbp" | "ngn">(UK_ENABLED ? "gbp" : "ngn");
  const [items, setItems] = useState<BillerItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [tab, setTab] = useState("electricity");
  const [provider, setProvider] = useState("");
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
    setItems([]); setLoaded(false); setItem(null); setProvider(""); setValidated(null); setIdentifier(""); setAmountLocal("");
    // While payments are closed the form is hidden, so don't ask the bills provider for a list nobody can use.
    if (!ANY_PAY) { setLoaded(true); return; }
    fetch(`/api/billers?country=${country}`)
      .then(async (r) => ({ ok: r.ok, d: await r.json().catch(() => ({})) }))
      .then(({ ok, d }) => {
        setItems(d.items ?? []); setLoaded(true);
        if (!ok || d.error || !(d.items ?? []).length) {
          setError(`We couldn’t load the list of services${d.error ? ` (${String(d.error).slice(0, 140)})` : ""}. Refresh the page to try again.`);
        }
      })
      .catch(() => { setLoaded(true); setError("We couldn’t load the list of services. Refresh the page to try again."); });
  }, [country]);

  const tabItems = useMemo(() => {
    const t = TABS.find((t) => t.key === tab)!;
    return items.filter(t.match);
  }, [items, tab]);

  // Group the tab's items by provider (e.g. one DisCo, one network) so long plan lists stay short.
  const providers = useMemo(() => {
    const m = new Map<string, BillerItem[]>();
    for (const i of tabItems) {
      const a = m.get(i.biller_name);
      if (a) a.push(i); else m.set(i.biller_name, [i]);
    }
    return Array.from(m.entries()).sort((a, b) => niceName(a[0]).localeCompare(niceName(b[0])));
  }, [tabItems]);

  const plans = useMemo(() => {
    const group = providers.find(([n]) => n === provider)?.[1] ?? [];
    return group.every((i) => i.amount > 0) ? [...group].sort((a, b) => a.amount - b.amount) : group;
  }, [providers, provider]);

  const fixedAmount = item && item.amount > 0;
  // FLW returns some countries' fixed prices in minor units (GH: pesewas).
  const fixedLocal = item && item.amount > 0 ? item.amount / cfg.fixedAmountDivisor : 0;
  const billAmount = fixedAmount ? fixedLocal : Number(amountLocal || 0);
  const ngnFee = billAmount > 0 ? ngnServiceFee(billAmount) : 0;
  const ngnTotal = billAmount + ngnFee;
  const isNoValidate = (i: BillerItem | null) =>
    !!i && (i.is_airtime || /VTU|AIRTIME|DATA|BROADBAND|SURFLINE|POSTPAID PAYMENT/i.test(i.biller_name + " " + i.name));

  // Naira checkout limits (the server enforces the same ones) — say so before the last step.
  const minNgn = cfg.minDomestic ?? cfg.minLocal;
  const belowMin = inNgn && billAmount > 0 && billAmount < minNgn;
  const aboveMax = inNgn && billAmount > cfg.maxLocal;

  const stage = !item ? 0 : !validated ? 1 : 2;

  function chooseTab(key: string) {
    setTab(key); setProvider(""); setItem(null); setValidated(null); setError(null);
  }
  function chooseProvider(name: string) {
    setProvider(name); setValidated(null); setError(null);
    const group = providers.find(([n]) => n === name)?.[1] ?? [];
    setItem(group.length === 1 ? group[0] : null);
  }
  function choosePlan(key: string) {
    const found = plans.find((i) => itemKey(i) === key) ?? null;
    setItem(found); setValidated(null); setError(null);
  }
  function jumpTo(key: string) {
    chooseTab(key);
    document.getElementById("pay")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

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
    ? "Pay in naira by card, bank transfer or USSD. You see the name on the meter or smartcard before any money moves."
    : null;
  const payLine = NGN_ENABLED
    ? "Pay in pounds from the UK, or in naira from inside Nigeria. You see who you’re paying before any money moves."
    : "Pay in pounds, straight from your card. You see who you’re paying before any money moves.";

  const payDisabled =
    busy !== null || !email || (!fixedAmount && !amountLocal) || belowMin || aboveMax;

  const countries = [
    {
      code: "NG", name: "Nigeria",
      text: "Electricity from every major DisCo, DStv, GOtv and StarTimes, plus airtime and data on every network.",
      status: NGN_ENABLED && UK_ENABLED ? "Pay in £ from abroad, or in ₦ from inside Nigeria"
        : NGN_ENABLED ? "Pay in ₦ by card, bank transfer or USSD"
        : UK_ENABLED ? "Pay in £ from abroad"
        : "Opening soon",
      live: ANY_PAY,
    },
    GH_ENABLED
      ? { code: "GH", name: "Ghana", text: "ECG electricity, DStv and GOtv, MTN, Vodafone and Tigo airtime, plus Surfline and Vodafone broadband.", status: "Pay in £ from abroad", live: true }
      : { code: "GH", name: "Ghana", text: "Electricity, TV, airtime and data are built and on the way.", status: "Coming soon", live: false },
    UK_ENABLED
      ? { code: "+", name: "More soon", text: "Every new country is the same promise: see the name, pay, get delivery — or get your money back.", status: "On the way", live: false }
      : { code: "UK", name: "Pay from the UK", text: "Pay in pounds by card for family back home.", status: "Coming soon", live: false },
  ];

  return (
    <main id="content">
      {/* ───────── HERO + PAY FORM ───────── */}
      <section className="max-w-6xl mx-auto px-5 pt-8 sm:pt-14 pb-16 sm:pb-24 grid lg:grid-cols-[1fr_28rem] xl:grid-cols-[1fr_30rem] gap-10 lg:gap-16 items-start">
        <div className="lg:pt-8">
          <h1 className="font-display font-extrabold text-[2.5rem] sm:text-6xl lg:text-[4.25rem] leading-[1.03] tracking-tight max-w-[14ch] sm:max-w-[16ch]">
            {DOMESTIC ? "Light, TV, airtime and data, paid in seconds." : "The bills back home, paid in seconds."}
          </h1>
          <p className="text-haze mt-5 sm:mt-6 text-lg leading-relaxed max-w-[34rem]">
            {heroSub ?? <>Electricity, TV, airtime and data for Nigeria and Ghana. {payLine}</>}
          </p>

          <ul className="mt-8 sm:mt-10 grid gap-5 max-w-[34rem]">
            {CHECKS.map((c) => (
              <li key={c.title} className="flex gap-3.5">
                <span className="mt-0.5 shrink-0 w-6 h-6 rounded-full bg-ok/15 text-ok flex items-center justify-center">
                  <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
                <span>
                  <span className="block font-display font-bold text-[17px] leading-snug">{c.title}</span>
                  <span className="block text-haze text-[15px] leading-relaxed mt-0.5">{c.text}</span>
                </span>
              </li>
            ))}
          </ul>

          <p className="hidden lg:block text-haze text-sm mt-10 max-w-[34rem] leading-relaxed">Works with {BRANDS}.</p>
        </div>

        {/* The real payment form */}
        <div id="pay" className="scroll-mt-24 w-full lg:sticky lg:top-24">
          <div className="bg-panel border border-line rounded-3xl shadow-card">
            <div className="p-5 sm:p-6">
              <div className="flex items-center justify-between gap-3">
                <h2 className="font-display font-bold text-xl">Pay a bill</h2>
                {inNgn && (
                  <span className="inline-flex items-center gap-1.5 text-xs text-haze">
                    <svg width="13" height="13" viewBox="0 0 24 24" aria-hidden="true"><rect x="4.5" y="10.5" width="15" height="10" rx="2.5" fill="none" stroke="currentColor" strokeWidth="2" /><path d="M8 10.5V8a4 4 0 018 0v2.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
                    Secure checkout
                  </span>
                )}
              </div>

              {!ANY_PAY && (
                <div className="py-10 text-center">
                  <p className="font-display font-bold text-2xl">Payments open very shortly.</p>
                  <p className="text-haze text-sm mt-3 leading-relaxed max-w-xs mx-auto">We&rsquo;re finishing the last checks. Email <a href="mailto:nolgichq@gmail.com?subject=Tell%20me%20when%20Nolgic%20opens" className="text-tungsten underline underline-offset-2">nolgichq@gmail.com</a> and we&rsquo;ll tell you the day it opens.</p>
                </div>
              )}

              {ANY_PAY && (<>
                {/* Progress: this really is a sequence */}
                <ol className="mt-4 flex items-center gap-2 text-xs font-medium" aria-label="Progress">
                  {["Choose bill", "Check recipient", "Pay"].map((label, n) => {
                    const done = stage > n; const now = stage === n;
                    return (
                      <li key={label} className="flex items-center gap-2 flex-1 last:flex-none" aria-current={now ? "step" : undefined}>
                        <span className={`shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold num ${done ? "bg-ok text-white" : now ? "bg-cta text-oncta" : "bg-sunk text-haze"}`}>
                          {done ? <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" /></svg> : n + 1}
                        </span>
                        <span className={`${now ? "text-paper" : "text-haze"} hidden min-[380px]:inline whitespace-nowrap`}>{label}</span>
                        {n < 2 && <span className={`h-px flex-1 ${done ? "bg-ok/50" : "bg-line"}`} aria-hidden="true" />}
                      </li>
                    );
                  })}
                </ol>

                {UK_ENABLED && (
                  <div className="mt-5">
                    <p className="text-sm font-medium mb-1.5">Where are you paying from?</p>
                    <div className="grid grid-cols-2 gap-1 rounded-xl bg-sunk p-1">
                      {([
                        { k: "gbp", label: "UK or abroad · £", on: UK_ENABLED },
                        { k: "ngn", label: "Nigeria · ₦", on: NGN_ENABLED },
                      ] as const).map((o) => (
                        <button
                          key={o.k}
                          type="button"
                          disabled={!o.on}
                          aria-disabled={!o.on}
                          aria-pressed={payIn === o.k}
                          onClick={() => { if (!o.on) return; setPayIn(o.k); if (o.k === "ngn") { setCountry("NG"); chooseTab("electricity"); } }}
                          className={`rounded-lg px-2 py-2 text-sm font-semibold leading-tight ${
                            !o.on ? "text-haze/60 cursor-not-allowed" : payIn === o.k ? "bg-panel text-paper shadow-sm" : "text-haze hover:text-paper"
                          }`}
                        >
                          {o.label}
                          {!o.on && <span className="block text-[11px] font-normal mt-0.5">Coming soon</span>}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {!inNgn && (
                  <div className="mt-5">
                    <p className="text-sm font-medium mb-1.5">Country</p>
                    <div className="flex gap-2 flex-wrap">
                      {allCountries().map((c) => {
                        const on = c.code === "GH" ? GH_ENABLED : true;
                        return (
                          <button
                            key={c.code}
                            type="button"
                            disabled={!on}
                            aria-disabled={!on}
                            aria-pressed={country === c.code}
                            onClick={() => { if (!on) return; setCountry(c.code); chooseTab("electricity"); }}
                            className={`px-3.5 h-10 rounded-full text-sm border font-semibold flex items-center gap-2 ${
                              !on ? "border-line text-haze/60 cursor-not-allowed" : country === c.code ? "bg-paper text-night border-paper" : "border-line text-haze hover:border-paper/40"
                            }`}
                          >
                            {c.name}
                            {!on && <span className="text-[11px] font-normal">Coming soon</span>}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Step 1 — what */}
                <div className="mt-5" role="group" aria-label="What are you paying?">
                  <div className="grid grid-cols-4 gap-2">
                    {TABS.map((t, n) => {
                      const on = tab === t.key;
                      return (
                        <button
                          key={t.key}
                          type="button"
                          aria-pressed={on}
                          onClick={() => chooseTab(t.key)}
                          className={`flex flex-col items-center justify-center gap-1.5 rounded-2xl border h-[4.5rem] text-[13px] font-semibold transition-colors ${
                            on ? "border-tungsten bg-cta/15 text-paper" : "border-line text-haze hover:text-paper hover:border-paper/30"
                          }`}
                        >
                          <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true" className={on ? "text-tungsten" : ""}>{CATEGORIES[n].icon}</svg>
                          {t.label === "Electricity" ? "Light" : t.label === "Cable TV" ? "TV" : t.label}
                        </button>
                      );
                    })}
                  </div>

                  <div className="mt-4">
                    <label htmlFor="provider">{LABELS[tab].provider}</label>
                    <select id="provider" value={provider} onChange={(e) => chooseProvider(e.target.value)} disabled={!providers.length}>
                      <option value="">
                        {!loaded ? "Loading…" : providers.length ? "Select…" : "Nothing available here yet"}
                      </option>
                      {providers.map(([name]) => (<option key={name} value={name}>{niceName(name)}</option>))}
                    </select>
                  </div>

                  {provider && plans.length > 1 && (
                    <div className="mt-3">
                      <label htmlFor="plan">{LABELS[tab].plan}</label>
                      <select id="plan" value={item ? itemKey(item) : ""} onChange={(e) => choosePlan(e.target.value)}>
                        <option value="">Select…</option>
                        {plans.map((i) => (
                          <option key={itemKey(i)} value={itemKey(i)}>{i.name}{i.amount > 0 ? ` — ${fmtLocal(i.amount / cfg.fixedAmountDivisor)}` : ""}</option>
                        ))}
                      </select>
                    </div>
                  )}
                  {/* Data and TV always have a package list: show it from the start so it is clear where it will appear. */}
                  {!provider && (tab === "data" || tab === "cable") && (
                    <div className="mt-3">
                      <label htmlFor="plan-wait">{LABELS[tab].plan}</label>
                      <select id="plan-wait" disabled value="" onChange={() => {}}>
                        <option value="">{tab === "data" ? "Choose a network first" : "Choose a TV provider first"}</option>
                      </select>
                    </div>
                  )}
                </div>

                {/* Step 2 — who */}
                {item && (
                  <div className="mt-5 pt-5 border-t border-line stub-in">
                    <label htmlFor="identifier">{item.label_name || "Account number"}</label>
                    <input id="identifier" value={identifier} onChange={(e) => { setIdentifier(e.target.value); setValidated(null); }}
                      placeholder={isNoValidate(item) ? cfg.identifierExamples.phone : cfg.identifierExamples.electricity}
                      inputMode={isNoValidate(item) ? "tel" : "text"} autoComplete="off" />

                    {!fixedAmount && (
                      <div className="mt-3">
                        <label htmlFor="amount">Amount ({cfg.currencySymbol})</label>
                        <input id="amount" value={amountLocal} onChange={(e) => setAmountLocal(e.target.value.replace(/[^\d]/g, ""))} placeholder="5000" inputMode="numeric" className="num" />
                        {inNgn && (
                          <div className="flex gap-2 flex-wrap mt-2">
                            {QUICK_AMOUNTS.filter((a) => a >= minNgn).map((a) => (
                              <button key={a} type="button" onClick={() => setAmountLocal(String(a))}
                                className={`px-3 h-8 rounded-full border text-sm num ${Number(amountLocal) === a ? "border-tungsten bg-cta/15 font-semibold" : "border-line text-haze hover:text-paper hover:border-paper/30"}`}>
                                {fmtLocal(a)}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                    {fixedAmount && (
                      <p className="text-sm text-haze mt-2.5">Price for this plan: <span className="text-paper font-semibold num">{fmtLocal(fixedLocal)}</span></p>
                    )}
                    {belowMin && (
                      <p className="text-sm text-bad mt-2.5" role="status">Naira payments start at {fmtLocal(minNgn)}. Choose a larger amount or plan.</p>
                    )}
                    {aboveMax && (
                      <p className="text-sm text-bad mt-2.5" role="status">The most you can pay in one go is {fmtLocal(cfg.maxLocal)}.</p>
                    )}

                    <button onClick={validate} disabled={busy !== null || !identifier}
                      className="mt-4 w-full h-12 rounded-xl border border-paper/25 font-semibold hover:bg-sunk disabled:opacity-40 disabled:hover:bg-transparent">
                      {busy === "validate" ? "Checking…" : isNoValidate(item) ? "Confirm number" : "Check account name"}
                    </button>

                    {validated && (
                      <div className="mt-4 rounded-2xl bg-ok/10 border border-ok/30 p-4 stub-in" role="status">
                        <p className="text-sm font-semibold text-ok flex items-center gap-1.5">
                          <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></svg>
                          {validated.name ? "Account found" : "Number confirmed"}
                        </p>
                        <p className="font-display text-xl font-bold mt-1 break-words">{validated.name ?? identifier}</p>
                        <p className="text-haze text-sm mt-1 leading-relaxed">Is this who you meant? Once delivered, a token or top-up can&rsquo;t be taken back.</p>
                      </div>
                    )}
                  </div>
                )}

                {/* Step 3 — contact */}
                {validated && (
                  <div className="mt-5 pt-5 border-t border-line stub-in">
                    <label htmlFor="email">Your email (for your receipt)</label>
                    <input id="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" inputMode="email" autoComplete="email" />
                    <div className="mt-3">
                      <label htmlFor="whatsapp">Their mobile number <span className="text-haze font-normal">(optional)</span></label>
                      <input id="whatsapp" value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} placeholder={country === "GH" ? "+233..." : "+234..."} inputMode="tel" autoComplete="off" />
                      <p className="text-xs text-haze mt-1.5">We&rsquo;ll send them the receipt and token.</p>
                    </div>
                  </div>
                )}

                {error && <div role="alert" className="mt-4 rounded-xl border border-bad/40 bg-bad/10 p-3.5 text-bad text-sm leading-relaxed">{error}</div>}
              </>)}
            </div>

            {/* Receipt stub: appears as soon as there is an amount, tears along the dashed line */}
            {ANY_PAY && validated && (
              <div className="tear bg-sunk rounded-b-3xl px-5 sm:px-6 pt-6 pb-5 sm:pb-6 stub-in">
                {inNgn && billAmount > 0 && (
                  <dl className="text-sm space-y-1.5 num">
                    <div className="flex justify-between gap-4"><dt className="text-haze truncate">{item?.name}</dt><dd className="shrink-0">{fmtLocal(billAmount)}</dd></div>
                    <div className="flex justify-between gap-4"><dt className="text-haze">Service fee</dt><dd className="shrink-0">{fmtLocal(ngnFee)}</dd></div>
                    <div className="flex justify-between gap-4 items-baseline pt-2.5 mt-2.5 border-t border-line"><dt className="font-semibold">Total</dt><dd className="font-display font-bold text-2xl">{fmtLocal(ngnTotal)}</dd></div>
                  </dl>
                )}
                <button onClick={pay} disabled={payDisabled}
                  className="mt-4 w-full h-14 rounded-2xl bg-cta text-oncta font-display font-bold text-lg hover:brightness-105 active:brightness-95 disabled:opacity-40 disabled:hover:brightness-100 num">
                  {busy === "pay" ? "Opening secure checkout…" : inNgn && billAmount > 0 ? `Pay ${fmtLocal(ngnTotal)}` : "Continue to payment"}
                </button>
                <p className="text-haze text-xs mt-3 text-center leading-relaxed">
                  {inNgn
                    ? "Pay by card, bank transfer or USSD. If delivery fails, you’re refunded automatically."
                    : "Card payment handled by Stripe. If delivery fails, you’re refunded automatically — you can never lose money."}
                </p>
              </div>
            )}
          </div>

          {DOMESTIC && ANY_PAY && (
            <p className="text-center text-sm text-haze mt-4">
              Paying from the UK or Ghana? <a href="#countries" className="text-tungsten font-medium underline underline-offset-2">Coming soon</a>
            </p>
          )}
        </div>
      </section>

      {/* ───────── WHAT YOU CAN PAY ───────── */}
      <section className="border-y border-line bg-panel">
        <div className="max-w-6xl mx-auto px-5 py-16 sm:py-24">
          <h2 className={`${h2} max-w-2xl`}>Four things that keep a household running.</h2>
          <div className="mt-10 sm:mt-12 border-t border-line">
            {CATEGORIES.map((c, n) => (
              <div key={c.title} className="grid sm:grid-cols-[3rem_1fr_auto] gap-x-6 gap-y-3 items-center py-6 border-b border-line">
                <div className="w-12 h-12 rounded-2xl bg-cta text-oncta flex items-center justify-center">
                  <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">{c.icon}</svg>
                </div>
                <div>
                  <h3 className="font-display font-bold text-xl">{c.title}</h3>
                  <p className="text-haze leading-relaxed mt-1 max-w-xl">{c.text}</p>
                  <p className="text-haze/80 text-sm mt-1.5">{c.names}</p>
                </div>
                {ANY_PAY && (
                  <button type="button" onClick={() => jumpTo(TABS[n].key)}
                    className="justify-self-start sm:justify-self-end h-11 px-5 rounded-xl border border-paper/25 font-semibold hover:bg-sunk">
                    Pay {c.title === "Cable TV" ? "TV" : c.title.toLowerCase()}
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ───────── HOW IT WORKS ───────── */}
      <section id="how" className="max-w-6xl mx-auto px-5 py-16 sm:py-24 scroll-mt-20">
        <h2 className={`${h2} max-w-2xl`}>One minute from your phone to their light.</h2>
        <ol className="mt-10 sm:mt-14 grid md:grid-cols-3 gap-10 md:gap-8 relative">
          {STEPS.map((s) => (
            <li key={s.n} className="relative">
              <span className="w-11 h-11 rounded-full bg-paper text-night font-display font-bold text-lg flex items-center justify-center num">{s.n}</span>
              <h3 className="font-display font-bold text-xl mt-5 mb-2">{s.title}</h3>
              <p className="text-haze leading-relaxed max-w-sm">{s.text}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* ───────── THE PROMISE ───────── */}
      <section className="bg-[#0B1026] text-[#F5F2E9]">
        <div className="max-w-6xl mx-auto px-5 py-16 sm:py-24 grid lg:grid-cols-[1.1fr_1fr] gap-10 lg:gap-20 items-start">
          <h2 className="font-display font-bold text-3xl md:text-[2.6rem] leading-[1.08] tracking-tight max-w-lg">
            You can&rsquo;t pay for something that wasn&rsquo;t delivered.
          </h2>
          <div className="space-y-6 text-[17px] leading-relaxed text-[#C9CEE5]">
            <p>If the provider rejects the payment, we refund you in full, automatically.</p>
            <p>If the provider is slow to confirm, we check it ourselves and either deliver or refund. Your money is never just held.</p>
            <p>If you ever need us, email <a href="mailto:nolgichq@gmail.com" className="text-[#FFB627] underline underline-offset-2">nolgichq@gmail.com</a> with your order number.</p>
          </div>
        </div>
      </section>

      {/* ───────── COUNTRIES ───────── */}
      <section id="countries" className="max-w-6xl mx-auto px-5 py-16 sm:py-24 scroll-mt-20">
        <h2 className={`${h2} max-w-2xl`}>{DOMESTIC ? "One tool for paying bills across Africa. Starting in Nigeria." : "One tool for paying bills across Africa. Starting with two countries."}</h2>
        <div className="mt-10 sm:mt-12 border-t border-line">
          {countries.map((c) => (
            <div key={c.name} className="grid sm:grid-cols-[3rem_1fr_auto] gap-x-6 gap-y-2 items-start sm:items-center py-6 border-b border-line">
              <span className={`w-12 h-12 rounded-2xl flex items-center justify-center text-sm font-bold ${c.live ? "bg-paper text-night" : "border border-dashed border-paper/40 text-haze"}`}>{c.code}</span>
              <div>
                <h3 className="font-display font-bold text-xl">{c.name}</h3>
                <p className="text-haze leading-relaxed mt-1 max-w-xl">{c.text}</p>
              </div>
              <span className={`justify-self-start sm:justify-self-end text-sm font-semibold px-3 h-8 inline-flex items-center rounded-full ${c.live ? "bg-ok/15 text-ok" : "bg-sunk text-haze"}`}>{c.status}</span>
            </div>
          ))}
        </div>
      </section>

      {/* ───────── STORY / COMING SOON ───────── */}
      {DOMESTIC ? (
        <section className="max-w-2xl mx-auto px-5 pb-6">
          <h2 className={`${h2} mb-5`}>Paying from the UK or Ghana?</h2>
          <p className="text-haze text-lg leading-relaxed">Payments in pounds for family in Nigeria, and bills in Ghana, are on the way. Tell us you&rsquo;re waiting and we&rsquo;ll let you know the day they open: <a href="mailto:nolgichq@gmail.com?subject=Tell%20me%20when%20UK%20payments%20open" className="text-tungsten underline underline-offset-2">nolgichq@gmail.com</a>.</p>
        </section>
      ) : (
      <section className="max-w-2xl mx-auto px-5 pb-6">
        <h2 className={`${h2} mb-5`}>Every Sunday call ends the same way.</h2>
        <div className="text-haze text-lg leading-relaxed space-y-4">
          <p>&ldquo;NEPA has taken the light.&rdquo; &ldquo;The DSTV has expired.&rdquo; &ldquo;Send me credit.&rdquo; If you&rsquo;re abroad, you know the list — and the old routine: send money through an app, lose a chunk to fees and rates, then wait and hope somebody queues at the right kiosk.</p>
          <p>Nolgic skips the middle. You&rsquo;re not sending money — you&rsquo;re buying the actual thing: the token, the subscription, the top-up, delivered straight to the meter, decoder or phone in seconds. The price you see is everything you pay.</p>
          <p className="text-paper font-semibold">Designed in London — because we make the same Sunday calls.</p>
        </div>
      </section>
      )}

      {/* ───────── FAQ ───────── */}
      <section id="faq" className="max-w-2xl mx-auto px-5 pt-16 sm:pt-20 pb-20 sm:pb-28 scroll-mt-20">
        <h2 className={`${h2} mb-8`}>Questions, answered.</h2>
        <div className="border-t border-line">
          {FAQS.map((f) => (
            <details key={f.q} className="border-b border-line group">
              <summary className="font-display font-semibold text-[17px] cursor-pointer list-none flex justify-between items-center gap-4 py-5 [&::-webkit-details-marker]:hidden">
                {f.q}
                <span className="shrink-0 w-7 h-7 rounded-full bg-sunk text-tungsten flex items-center justify-center text-lg leading-none group-open:rotate-45 transition-transform" aria-hidden="true">+</span>
              </summary>
              <p className="text-haze leading-relaxed pb-5 pr-10">{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify([
        { "@context": "https://schema.org", "@type": "Organization", name: "Nolgic", url: process.env.NEXT_PUBLIC_APP_URL ?? "https://nolgic.com", logo: `${process.env.NEXT_PUBLIC_APP_URL ?? "https://nolgic.com"}/logo.svg`, email: "nolgichq@gmail.com" },
        { "@context": "https://schema.org", "@type": "WebSite", name: "Nolgic", url: process.env.NEXT_PUBLIC_APP_URL ?? "https://nolgic.com" },
        { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: FAQS.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })) },
      ]) }} />

      <footer className="border-t border-line bg-panel">
        <div className="max-w-6xl mx-auto px-5 py-12 grid sm:grid-cols-[1.4fr_1fr_1fr] gap-10 text-sm text-haze leading-relaxed">
          <div>
            <Logo size="sm" />
            <p className="mt-4 max-w-xs">Nolgic sells prepaid digital products (tokens, subscriptions, top-ups). It is not a money transfer service.</p>
          </div>
          <div>
            <p className="font-semibold text-paper mb-3">Nolgic</p>
            <ul className="space-y-2">
              <li><a href="/#pay" className="hover:text-paper">Pay a bill</a></li>
              <li><a href="/#how" className="hover:text-paper">How it works</a></li>
              <li><a href="/#faq" className="hover:text-paper">FAQ</a></li>
            </ul>
          </div>
          <div>
            <p className="font-semibold text-paper mb-3">Help</p>
            <ul className="space-y-2">
              <li><a href="mailto:nolgichq@gmail.com" className="hover:text-paper">nolgichq@gmail.com</a></li>
              <li><a href="/legal" className="hover:text-paper">Terms, refunds &amp; privacy</a></li>
            </ul>
          </div>
        </div>
        <div className="max-w-6xl mx-auto px-5 pb-10 text-xs text-haze">Designed in London · © {new Date().getFullYear()} Nolgic</div>
      </footer>
    </main>
  );
}
