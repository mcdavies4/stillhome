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
    // Airtime & data have no name lookup — the phone number is the account.
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
      window.location.href = d.url; // off to Stripe Checkout
    } catch (e: any) {
      setError(e.message);
      setBusy(null);
    }
  }

  return (
    <main className="max-w-xl mx-auto px-5 pb-24">
      <header className="pt-14 pb-10">
        <p className="font-mono text-tungsten text-xs tracking-[0.3em] uppercase mb-3">
          UK → Nigeria · instant
        </p>
        <h1 className="font-display font-extrabold text-5xl leading-[1.02]">
          3,000 miles away.{" "}
          <span className="flicker text-tungsten drop-shadow-[0_0_24px_rgba(255,182,39,0.45)]">
            Still home.
          </span>
        </h1>
        <p className="text-haze mt-4 leading-relaxed">
          Pay light, DSTV and airtime for family in Nigeria. You see the
          account name <em className="text-paper not-italic">before</em> you
          pay — and they get the receipt on WhatsApp.
        </p>
      </header>

      {/* Step 1 — what */}
      <section className="bg-panel border border-line rounded-2xl p-5 mb-4">
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
      </section>

      {/* Step 2 — who */}
      {item && (
        <section className="bg-panel border border-line rounded-2xl p-5 mb-4">
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
                Confirm this is who you meant — bill payments can’t be reversed
                once delivered.
              </p>
            </div>
          )}
        </section>
      )}

      {/* Step 3 — pay */}
      {validated && (
        <section className="bg-panel border border-line rounded-2xl p-5">
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
            Card payment handled by Stripe. If delivery fails, you’re refunded
            automatically — you can never lose money.
          </p>
        </section>
      )}

      {error && (
        <div className="mt-4 border border-bad/40 bg-bad/10 rounded-xl p-4 text-bad text-sm">
          {error}
        </div>
      )}

      <footer className="mt-16 pt-6 border-t border-line text-haze text-xs leading-relaxed">
        <p>
          StillHome sells prepaid digital products (tokens, subscriptions,
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
