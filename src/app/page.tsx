"use client";

import { useEffect, useMemo, useState } from "react";

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

const itemKey = (i: BillerItem) => `${i.biller_code}:${i.item_code}:${i.short_name ?? i.name}`;

const TABS = [
  { key: "electricity", label: "Electricity", match: (b: BillerItem) => /ELECTRIC|DISCO|PREPAID METER|EKEDC|IKEDC|EEDC|AEDC|IBEDC|PHED|KEDCO|BEDC|JED|YEDC|ABUJA|ENUGU DISCO|KANO DISCO|KADUNA/i.test(b.biller_name + " " + b.name) },
  { key: "cable", label: "Cable TV", match: (b: BillerItem) => /DSTV|GOTV|STARTIMES|SHOWMAX/i.test(b.biller_name + " " + b.name) },
  { key: "airtime", label: "Airtime", match: (b: BillerItem) => b.is_airtime || /VTU|AIRTIME/i.test(b.biller_name + " " + b.name + " " + (b.short_name ?? "")) },
  { key: "data", label: "Data", match: (b: BillerItem) => /DATA/i.test(b.biller_name + " " + b.name) && !b.is_airtime },
];

const fmtNgn = (n: number) => `₦${Number(n).toLocaleString("en-NG")}`;

const PROMISES = [
  { label: "NAME-CHECK", text: "We show you whose meter or decoder it is before you pay." },
  { label: "AUTO-REFUND", text: "Delivery fails? Your card is refunded in full, automatically." },
  { label: "WHATSAPP RECEIPT", text: "They get the receipt — and the meter token — on WhatsApp." },
  { label: "NO ACCOUNT", text: "Pay in under a minute. No signup, no app to install." },
];

const FAQS = [
  {
    q: "How do I pay a NEPA / electricity bill in Nigeria from the UK?",
    a: "Pick the DisCo (EKEDC, IKEDC, EEDC and others), enter the meter number, and we show you the registered account name. Pay in pounds by card and the prepaid token is issued in seconds — we show it on screen, email it to you, and can WhatsApp it to your family.",
  },
  {
    q: "Can I pay for DSTV or GOTV from abroad?",
    a: "Yes. Choose the package, enter the smartcard/IUC number, confirm the account holder's name we look up, and pay by card. The decoder is credited within seconds — no one in Nigeria needs to queue or do anything.",
  },
  {
    q: "How do I buy MTN, Airtel or Glo airtime from the UK?",
    a: "Select the network, enter the Nigerian phone number and amount, and pay in pounds. The airtime lands on the phone instantly. Data bundles work the same way.",
  },
  {
    q: "Is Nolgic a money transfer service?",
    a: "No — you're buying a prepaid product (a token, subscription or top-up) at a pound price shown upfront. We deliver the product directly; we never move money to a person.",
  },
  {
    q: "What happens if delivery fails?",
    a: "Your card is refunded automatically and in full. You can never pay for something that wasn't delivered.",
  },
  {
    q: "What does it cost?",
    a: "The pound price shown at checkout is everything — product price plus a small service fee. No hidden exchange-rate surprises after the fact.",
  },
];

const STEPS = [
  { n: "1", title: "Pick the bill", text: "Electricity token, DSTV, GOTV, airtime or data — for any meter, decoder or phone number in Nigeria." },
  { n: "2", title: "See who you're paying", text: "We look the number up with the provider and show you the registered name. You confirm it's your people before a kobo moves." },
  { n: "3", title: "Pay in pounds. Done.", text: "Card checkout by Stripe. Delivery lands in seconds, and the receipt goes to their WhatsApp — token included." },
];

export default function Home() {
  const [items, setItems] = useState<BillerItem[]>([]);
  const [tab, setTab] = useState("electricity");
  const [item, setItem] = useState<BillerItem | null>(null);
  const [identifier, setIdentifier] = useState("");
  const [amountNgn, setAmountNgn] = useState("");
  const [email, setEmail] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [validated, setValidated] = useState<{ name: string | null } | null>(null);
  const [busy, setBusy] = useState<"validate" | "pay" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/billers")
      .then((r) => r.json())
      .then((d) => setItems(d.items ?? []))
      .catch(() => setError("Could not load billers. Refresh to retry."));
  }, []);

  const tabItems = useMemo(() => {
    const t = TABS.find((t) => t.key === tab)!;
    return items.filter(t.match);
  }, [items, tab]);

  const fixedAmount = item && item.amount > 0;
  const isNoValidate = (i: BillerItem | null) =>
    !!i && (i.is_airtime || /VTU|AIRTIME|DATA/i.test(i.biller_name + " " + i.name));

  async function validate() {
    if (!item || !identifier) return;
    if (isNoValidate(item)) {
      setValidated({ name: null });
      setError(null);
      return;
    }
    setBusy("validate");
    setError(null);
    setValidated(null);
    try {
      const r = await fetch("/api/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemCode: item.item_code, billerCode: item.biller_code, identifier }),
      });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error);
      setValidated({ name: d.name });
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  }

  async function pay() {
    if (!item || !validated) return;
    setBusy("pay");
    setError(null);
    try {
      const r = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          billerCode: item.biller_code,
          itemCode: item.item_code,
          billerName: item.biller_name,
          identifier,
          identifierLabel: item.label_name || "Account number",
          amountNgn: fixedAmount ? item.amount : Number(amountNgn),
          recipientWhatsapp: whatsapp || null,
        }),
      });
      const d = await r.json();
      if (d.error) throw new Error(d.error);
      window.location.href = d.url;
    } catch (e: any) {
      setError(e.message);
      setBusy(null);
    }
  }

  return (
    <main className="max-w-5xl mx-auto px-5 pb-24">
      {/* ── Hero: the thesis + the payoff ─────────────────────── */}
      <header className="pt-10 pb-16 grid md:grid-cols-2 gap-10 items-center">
        <div>
          <p className="font-mono text-tungsten text-xs tracking-[0.3em] uppercase mb-4">
            UK → Nigeria · delivered in seconds
          </p>
          <h1 className="font-display font-extrabold text-5xl md:text-6xl leading-[1.02]">
            3,000 miles away.{" "}
            <span className="flicker text-tungsten drop-shadow-[0_0_24px_rgba(255,182,39,0.45)]">
              Still home.
            </span>
          </h1>
          <p className="text-haze mt-5 text-lg leading-relaxed">
            Pay light, DSTV, airtime and data for your people in Nigeria —
            straight from your card in pounds. You see the account name before
            you pay. They see the receipt on WhatsApp.
          </p>
          <div className="flex gap-3 mt-8 flex-wrap">
            <a
              href="#pay"
              className="px-6 py-3.5 rounded-xl bg-tungsten text-night font-display font-bold text-lg shadow-glow hover:brightness-110"
            >
              Pay a bill now
            </a>
            <a
              href="#how"
              className="px-6 py-3.5 rounded-xl border border-line text-haze hover:border-tungsten/50 hover:text-paper"
            >
              How it works
            </a>
          </div>
        </div>

        {/* Signature: the moment on Mum's phone */}
        <div aria-hidden="true" className="relative">
          <div className="absolute -inset-8 bg-tungsten/10 blur-3xl rounded-full" />
          <div className="relative bg-panel border border-line rounded-3xl p-4 max-w-sm mx-auto">
            <p className="font-mono text-[10px] text-haze uppercase tracking-widest text-center mb-3">
              Mum&rsquo;s phone · Enugu · 19:42
            </p>
            <div className="space-y-2.5">
              <div className="msg msg-1 bg-night border border-line rounded-2xl rounded-tl-sm px-4 py-3 mr-10">
                <p className="font-mono text-xs text-ok mb-1">✅ Nolgic — payment successful</p>
                <p className="text-sm">EKEDC Prepaid — ₦20,000</p>
              </div>
              <div className="msg msg-2 bg-night border border-line rounded-2xl rounded-tl-sm px-4 py-3 mr-10">
                <p className="font-mono text-xs text-tungsten mb-1">🔑 Meter token</p>
                <p className="font-mono text-sm tracking-widest">4521 8830 9917 2264 0053</p>
              </div>
              <div className="msg msg-3 bg-tungsten/15 border border-tungsten/30 rounded-2xl rounded-tr-sm px-4 py-3 ml-10">
                <p className="text-sm">Up NEPA!! 🙌 Thank you my dear ❤️</p>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* ── The four promises ─────────────────────────────────── */}
      <section className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-20">
        {PROMISES.map((p) => (
          <div key={p.label} className="bg-panel border border-line rounded-2xl p-4">
            <p className="font-mono text-[10px] text-tungsten tracking-[0.25em] mb-2">{p.label}</p>
            <p className="text-sm text-haze leading-relaxed">{p.text}</p>
          </div>
        ))}
      </section>

      {/* ── How it works ──────────────────────────────────────── */}
      <section id="how" className="mb-20 scroll-mt-8">
        <p className="font-mono text-xs text-haze uppercase tracking-[0.3em] mb-3">How it works</p>
        <h2 className="font-display font-extrabold text-3xl mb-8">
          One minute from your phone to their <span className="text-tungsten">light</span>.
        </h2>
        <div className="grid md:grid-cols-3 gap-4">
          {STEPS.map((s) => (
            <div key={s.n} className="bg-panel border border-line rounded-2xl p-5">
              <p className="font-display font-extrabold text-4xl text-tungsten/40 mb-3">{s.n}</p>
              <p className="font-display font-semibold text-lg mb-2">{s.title}</p>
              <p className="text-haze text-sm leading-relaxed">{s.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── The payment widget ────────────────────────────────── */}
      <section id="pay" className="max-w-xl mx-auto scroll-mt-8 mb-20">
        <p className="font-mono text-xs text-haze uppercase tracking-[0.3em] mb-3 text-center">Start here</p>
        <h2 className="font-display font-extrabold text-3xl mb-8 text-center">
          Who are we paying for today?
        </h2>

        {/* Step 1 — what */}
        <div className="bg-panel border border-line rounded-2xl p-5 mb-4">
          <p className="font-mono text-xs text-haze uppercase tracking-widest mb-3">1 · What are you paying?</p>
          <div className="flex gap-2 flex-wrap mb-4">
            {TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => { setTab(t.key); setItem(null); setValidated(null); }}
                className={`px-3.5 py-1.5 rounded-full text-sm border ${
                  tab === t.key
                    ? "bg-tungsten text-night border-tungsten font-semibold"
                    : "border-line text-haze hover:border-tungsten/50"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <label>Provider / plan</label>
          <select
            value={item ? itemKey(item) : ""}
            onChange={(e) => {
              const found = tabItems.find((i) => itemKey(i) === e.target.value) ?? null;
              setItem(found);
              setValidated(null);
            }}
          >
            <option value="">Select…</option>
            {tabItems.map((i) => (
              <option key={itemKey(i)} value={itemKey(i)}>
                {i.name}{i.amount > 0 ? ` — ${fmtNgn(i.amount)}` : ""}
              </option>
            ))}
          </select>
        </div>

        {/* Step 2 — who */}
        {item && (
          <div className="bg-panel border border-line rounded-2xl p-5 mb-4">
            <p className="font-mono text-xs text-haze uppercase tracking-widest mb-3">2 · Who is it for?</p>
            <label>{item.label_name || "Account number"}</label>
            <input
              value={identifier}
              onChange={(e) => { setIdentifier(e.target.value); setValidated(null); }}
              placeholder={isNoValidate(item) ? "+234..." : "e.g. 04512345678"}
              inputMode={isNoValidate(item) ? "tel" : "text"}
            />
            {!fixedAmount && (
              <div className="mt-3">
                <label>Amount (₦)</label>
                <input
                  value={amountNgn}
                  onChange={(e) => setAmountNgn(e.target.value.replace(/[^\d]/g, ""))}
                  placeholder="10000"
                  inputMode="numeric"
                />
              </div>
            )}
            <button
              onClick={validate}
              disabled={busy !== null || !identifier}
              className="mt-4 w-full py-3 rounded-xl border border-tungsten/60 text-tungsten font-semibold hover:bg-tungsten/10 disabled:opacity-40"
            >
              {busy === "validate" ? "Checking…" : isNoValidate(item) ? "Confirm number" : "Check account name"}
            </button>

            {validated && (
              <div className="mt-4 border border-ok/40 bg-ok/10 rounded-xl p-4">
                <p className="font-mono text-xs text-ok uppercase tracking-widest mb-1">
                  {validated.name ? "Account found" : "Number confirmed"}
                </p>
                <p className="font-display text-xl font-semibold">
                  {validated.name ?? identifier}
                </p>
                <p className="text-haze text-sm mt-1">
                  Confirm this is who you meant — bill payments can&rsquo;t be
                  reversed once delivered.
                </p>
              </div>
            )}
          </div>
        )}

        {/* Step 3 — pay */}
        {validated && (
          <div className="bg-panel border border-line rounded-2xl p-5">
            <p className="font-mono text-xs text-haze uppercase tracking-widest mb-3">3 · Pay in pounds</p>
            <label>Your email (for your receipt)</label>
            <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" inputMode="email" />
            <div className="mt-3">
              <label>Their WhatsApp (optional — we send them the receipt / token)</label>
              <input value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} placeholder="+23480..." inputMode="tel" />
            </div>
            <button
              onClick={pay}
              disabled={busy !== null || !email || (!fixedAmount && !amountNgn)}
              className="mt-5 w-full py-3.5 rounded-xl bg-tungsten text-night font-display font-bold text-lg shadow-glow hover:brightness-110 disabled:opacity-40"
            >
              {busy === "pay" ? "Opening secure checkout…" : "Continue to payment"}
            </button>
            <p className="text-haze text-xs mt-3 text-center">
              Card payment handled by Stripe. If delivery fails, you&rsquo;re
              refunded automatically — you can never lose money.
            </p>
          </div>
        )}

        {error && (
          <div className="mt-4 border border-bad/40 bg-bad/10 rounded-xl p-4 text-bad text-sm">
            {error}
          </div>
        )}
      </section>

      {/* ── FAQ ───────────────────────────────────────────────── */}
      <section id="faq" className="max-w-2xl mx-auto mb-20 scroll-mt-8">
        <p className="font-mono text-xs text-haze uppercase tracking-[0.3em] mb-3">FAQ</p>
        <h2 className="font-display font-extrabold text-3xl mb-8">Questions, answered.</h2>
        <div className="space-y-3">
          {FAQS.map((f) => (
            <details key={f.q} className="bg-panel border border-line rounded-2xl p-5 group">
              <summary className="font-display font-semibold cursor-pointer list-none flex justify-between items-center gap-4">
                {f.q}
                <span className="text-tungsten group-open:rotate-45 transition-transform text-xl leading-none">+</span>
              </summary>
              <p className="text-haze text-sm leading-relaxed mt-3">{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* ── Why we built this ─────────────────────────────────── */}
      <section className="max-w-2xl mx-auto mb-8">
        <p className="font-mono text-xs text-haze uppercase tracking-[0.3em] mb-3">Why Nolgic exists</p>
        <h2 className="font-display font-extrabold text-3xl mb-5">
          Every Sunday call ends the same way.
        </h2>
        <div className="text-haze leading-relaxed space-y-4">
          <p>
            &ldquo;NEPA has taken the light.&rdquo; &ldquo;The DSTV has
            expired.&rdquo; &ldquo;Send me credit.&rdquo; If you&rsquo;re
            Nigerian abroad, you know the list — and you know the old routine:
            send money through an app, lose a chunk to fees and rates, then
            wait and hope somebody queues at the right kiosk before the
            football starts.
          </p>
          <p>
            Nolgic skips the middle. You&rsquo;re not sending money —
            you&rsquo;re buying the actual thing: the token, the subscription,
            the top-up, delivered straight to the meter, decoder or phone in
            seconds. The price you see in pounds is everything you pay, and the
            receipt lands on their WhatsApp so nobody has to ask
            &ldquo;did it go through?&rdquo;
          </p>
          <p className="text-paper">
            Built in London by The 36th Solutions Ltd — because we make the
            same Sunday calls.
          </p>
        </div>
      </section>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify([
            {
              "@context": "https://schema.org",
              "@type": "Organization",
              name: "Nolgic",
              legalName: "The 36th Solutions Ltd",
              url: process.env.NEXT_PUBLIC_APP_URL ?? "https://stillhome-ten.vercel.app",
              logo: `${process.env.NEXT_PUBLIC_APP_URL ?? "https://stillhome-ten.vercel.app"}/logo.svg`,
              email: "the36thltd@outlook.com",
            },
            {
              "@context": "https://schema.org",
              "@type": "WebSite",
              name: "Nolgic",
              url: process.env.NEXT_PUBLIC_APP_URL ?? "https://stillhome-ten.vercel.app",
            },
            {
              "@context": "https://schema.org",
              "@type": "FAQPage",
              mainEntity: FAQS.map((f) => ({
                "@type": "Question",
                name: f.q,
                acceptedAnswer: { "@type": "Answer", text: f.a },
              })),
            },
          ]),
        }}
      />

      <footer className="mt-16 pt-6 border-t border-line text-haze text-xs leading-        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.svg" alt="Nolgic" className="h-6 w-auto mb-4 opacity-80 dark:hidden" />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-dark.svg" alt="Nolgic" className="h-6 w-auto mb-4 opacity-80 hidden dark:block" />

          Nolgic sells prepaid digital products (tokens, subscriptions,
          top-ups) — it is not a money transfer service.{" "}
          <a href="/legal" className="text-tungsten underline underline-offset-2">
            Terms, refunds &amp; privacy
          </a>
        </p>
        <p className="mt-2">© {new Date().getFullYear()} The 36th Solutions Ltd</p>
      </footer>
    </main>
  );
}
