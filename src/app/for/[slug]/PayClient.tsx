"use client";

import { useState } from "react";
import { cleanText } from "@/lib/gift";
import { pfmItemFee, pfmMoney } from "@/lib/payforme-shared";
import { ngnMaxOrder } from "@/lib/ngn-fee";
import type { PublicLink } from "@/lib/paylink";

const QUICK = [1000, 2000, 5000, 10000];
const ICON: Record<string, string> = { electricity: "⚡", cable: "📺", airtime: "📱", data: "🌐" };

// What someone sees when they open a bills link: the owner's name, what can be paid, an amount, then the payment page.
export default function PayClient({ link }: { link: PublicLink }) {
  const [sel, setSel] = useState(link.items.length === 1 ? link.items[0].id : "");
  const [amount, setAmount] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const item = link.items.find((i) => i.id === sel) ?? null;
  const bill = item ? (item.fixed ?? Number(amount || 0)) : 0;
  const max = ngnMaxOrder(500000);
  const out = bill > 0 && (bill < 100 || bill > max);
  const fee = item && bill > 0 && !out ? pfmItemFee({ biller_code: item.billerCode, item_code: item.itemCode, biller_name: item.billerName, name: item.itemName }, bill) : 0;
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());
  const ready = !!item && bill > 0 && !out && emailOk;

  async function pay() {
    if (busy || !ready || !item) return;
    setBusy(true); setErr("");
    let leaving = false;
    try {
      const r = await fetch(`/api/paylink/${link.slug}/pay`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ itemId: item.id, amount: item.fixed ?? bill, email: email.trim(), name: name.trim() || undefined }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.url) throw new Error(d.error || "We couldn't start the payment. Please try again.");
      leaving = true;
      window.location.href = d.url;
    } catch (e: any) { setErr(e.message); } finally { if (!leaving) setBusy(false); }
  }

  return (
    <main id="content" className="max-w-xl mx-auto px-5 pt-12 pb-24">
      <h1 className="font-display font-extrabold text-3xl sm:text-4xl leading-tight tracking-tight">Pay {link.ownerName}&rsquo;s bills</h1>
      {link.note && <p className="mt-3 text-lg leading-relaxed text-haze">&ldquo;{link.note}&rdquo;</p>}
      <p className="mt-3 text-haze leading-relaxed">Choose what you&rsquo;d like to pay for. You pay in naira, by card, bank transfer or USSD, and it&rsquo;s delivered to {link.ownerName} in seconds.</p>

      <section className="mt-8" aria-labelledby="what">
        <h2 id="what" className="font-display font-bold text-xl">What would you like to pay?</h2>
        <ul className="mt-3 space-y-2" role="radiogroup" aria-label="What to pay">
          {link.items.map((i) => (
            <li key={i.id}>
              <button type="button" role="radio" aria-checked={sel === i.id} onClick={() => { setSel(i.id); setErr(""); }}
                className={`w-full text-left rounded-xl border p-3.5 ${sel === i.id ? "border-tungsten bg-cta/10" : "border-line hover:border-paper/40"}`}>
                <p className="font-semibold">{ICON[i.cat ?? ""] ?? "•"} {i.label}</p>
                <p className="text-sm text-haze">{i.title} · {i.masked}{i.fixed ? ` · ${pfmMoney(i.fixed)}` : ""}</p>
              </button>
            </li>
          ))}
        </ul>
      </section>

      {item && !item.fixed && (
        <section className="mt-6">
          <label htmlFor="pl-amt">Amount (₦)</label>
          <input id="pl-amt" className="num" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ""))} inputMode="numeric" placeholder="5000" maxLength={7} autoComplete="off" />
          <div className="flex gap-2 flex-wrap mt-2">
            {QUICK.map((a) => <button key={a} type="button" onClick={() => setAmount(String(a))} className={`px-3 h-9 rounded-full border text-sm num ${Number(amount) === a ? "border-tungsten bg-cta/15 font-semibold" : "border-line text-haze hover:text-paper"}`}>{pfmMoney(a)}</button>)}
          </div>
          {out && <p className="text-sm text-bad mt-2" role="status">The amount must be between ₦100 and {pfmMoney(max)}.</p>}
        </section>
      )}

      {item && (
        <section className="mt-8">
          <div>
            <label htmlFor="pl-name">Your name <span className="text-haze font-normal">(so {link.ownerName} knows who to thank)</span></label>
            <input id="pl-name" value={name} onChange={(e) => setName(cleanText(e.target.value, 40))} maxLength={40} placeholder="Uncle Chika" autoComplete="name" />
          </div>
          <div className="mt-3">
            <label htmlFor="pl-email">Your email <span className="text-haze font-normal">(for your receipt)</span></label>
            <input id="pl-email" type="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@gmail.com" autoComplete="email" />
          </div>
          {bill > 0 && !out && (
            <dl className="mt-5 rounded-2xl border border-line p-4 text-sm space-y-1.5">
              <div className="flex justify-between"><dt className="text-haze">{item.label}</dt><dd className="num">{pfmMoney(bill)}</dd></div>
              <div className="flex justify-between"><dt className="text-haze">Service fee</dt><dd className="num">{pfmMoney(fee)}</dd></div>
              <div className="flex justify-between font-semibold text-base pt-1.5 border-t border-line"><dt>You pay</dt><dd className="num" data-testid="total">{pfmMoney(bill + fee)}</dd></div>
            </dl>
          )}
          {err && <p className="text-bad text-sm mt-3" role="alert">{err}</p>}
          <button type="button" onClick={pay} disabled={!ready || busy}
            className="mt-4 w-full h-12 rounded-xl bg-cta text-oncta font-display font-bold hover:brightness-105 active:brightness-95 disabled:opacity-50">
            {busy ? "Taking you to the payment page…" : bill > 0 && !out ? `Pay ${pfmMoney(bill + fee)}` : "Pay"}
          </button>
          <p className="text-xs text-haze mt-3 leading-relaxed">Once delivered, a token or top-up can&rsquo;t be taken back. If it can&rsquo;t be delivered, you&rsquo;re refunded automatically.</p>
        </section>
      )}
    </main>
  );
}
