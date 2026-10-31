"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";

type Order = {
  id: string;
  status: string;
  biller_name: string;
  identifier: string;
  identifier_label: string;
  customer_name: string | null;
  amount_ngn: number;
  amount_gbp_pence: number;
  flw_token: string | null;
  country?: string | null;
  currency?: string | null;
  payment_provider?: string | null;
  service_fee_local?: number | null;
};

type Tone = "wait" | "work" | "ok" | "bad" | "check";
const COPY: Record<string, { title: string; body: string; tone: Tone }> = {
  pending_payment: { title: "Waiting for payment", body: "Complete your payment to continue. This page updates by itself.", tone: "wait" },
  paid: { title: "Payment received. Delivering now", body: "We\u2019re sending it through with the provider. This usually takes a few seconds.", tone: "work" },
  fulfilled: { title: "Delivered", body: "It\u2019s done. Your email receipt is on its way, and if you added their mobile number, so is theirs.", tone: "ok" },
  failed_refunded: { title: "Delivery failed. You\u2019ve been refunded", body: "The provider didn\u2019t accept this payment, so we\u2019ve refunded you in full. It can take a few working days to show on your statement. Check the details and try again.", tone: "bad" },
  needs_review: { title: "Payment received. We\u2019re confirming delivery", body: "The provider hasn\u2019t confirmed this one yet, so we\u2019re checking it by hand. It will either be delivered or refunded to you in full. Your money is safe.", tone: "check" },
  expired: { title: "This order expired", body: "No payment was taken. You can start a new payment any time.", tone: "wait" },
  refund_failed: { title: "We need to fix something", body: "Delivery failed and the automatic refund didn\u2019t go through. We\u2019ve been alerted. Email us with your order number and we\u2019ll sort it out straight away.", tone: "bad" },
};

const TONE: Record<Tone, { text: string; ring: string }> = {
  wait: { text: "text-haze", ring: "bg-sunk text-haze" },
  work: { text: "text-paper", ring: "bg-cta/20 text-tungsten" },
  ok: { text: "text-paper", ring: "bg-ok/15 text-ok" },
  bad: { text: "text-paper", ring: "bg-bad/15 text-bad" },
  check: { text: "text-paper", ring: "bg-cta/20 text-tungsten" },
};

// Where the order is on its way: paid → delivering → delivered.
function track(status: string): { label: string; state: "done" | "now" | "todo" | "bad" }[] {
  const s = (a: "done" | "now" | "todo" | "bad", b: "done" | "now" | "todo" | "bad", c: "done" | "now" | "todo" | "bad") => [
    { label: "Payment", state: a }, { label: "Delivery", state: b }, { label: status === "failed_refunded" || status === "refund_failed" ? "Refund" : "Done", state: c },
  ];
  switch (status) {
    case "pending_payment": return s("now", "todo", "todo");
    case "paid": return s("done", "now", "todo");
    case "needs_review": return s("done", "now", "todo");
    case "fulfilled": return s("done", "done", "done");
    case "failed_refunded": return s("done", "bad", "done");
    case "refund_failed": return s("done", "bad", "bad");
    default: return [];
  }
}

// Group a 20-digit electricity token as 4-4-4-4-4 so it's easy to read out and type in.
const groupToken = (t: string) => (/^\d{16,24}$/.test(t) ? t.replace(/(\d{4})(?=\d)/g, "$1 ") : t);

const expectsToken = (o: Order) =>
  /(ELECTRIC|DISCO|PREPAID|METER|TOPUP|TOP UP)/i.test(`${o.biller_name} ${o.identifier_label}`);

export default function OrderPage() {
  const { id } = useParams<{ id: string }>();
  const [order, setOrder] = useState<Order | null>(null);
  const tokenPolls = useRef(0);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let stop = false;
    async function poll() {
      const r = await fetch(`/api/orders?id=${id}`);
      if (r.ok) {
        const d: Order = await r.json();
        if (!stop) setOrder(d);
        if (stop) return;

        const inFlight = ["paid", "pending_payment"].includes(d.status);
        // Keep polling briefly for a late electricity token (server re-queries
        // FLW on each poll) — up to ~1 minute, then the email/cron takes over.
        const awaitingToken =
          d.status === "fulfilled" && !d.flw_token && expectsToken(d) && tokenPolls.current < 20;
        if (awaitingToken) tokenPolls.current += 1;

        if (inFlight || awaitingToken) setTimeout(poll, 3000);
      }
    }
    poll();
    return () => { stop = true; };
  }, [id]);

  if (!order) {
    return (
      <main id="content" className="max-w-xl mx-auto px-5 pt-16 pb-24" aria-busy="true">
        <div className="h-14 w-14 rounded-full bg-sunk" />
        <div className="h-8 w-3/4 rounded-lg bg-sunk mt-6" />
        <div className="h-4 w-full rounded bg-sunk mt-4" />
        <div className="h-4 w-2/3 rounded bg-sunk mt-2" />
        <p className="sr-only">Loading order…</p>
      </main>
    );
  }

  const c = COPY[order.status] ?? COPY.paid;
  const tone = TONE[c.tone];
  // Naira orders (paid through Paystack or Flutterwave) were charged in ₦ (amount + fee); everything else in £.
  const sym = order.currency === "GHS" ? "₵" : "₦";
  const chargedText =
    order.payment_provider === "paystack" || order.payment_provider === "flutterwave"
      ? `₦${(Number(order.amount_ngn) + Number(order.service_fee_local ?? 0)).toLocaleString("en-NG")}`
      : `£${(order.amount_gbp_pence / 100).toFixed(2)}`;
  const tokenPending = order.status === "fulfilled" && !order.flw_token && expectsToken(order);
  const steps = track(order.status);
  const needsHelp = ["needs_review", "refund_failed", "failed_refunded"].includes(order.status);
  const orderNo = order.id.slice(0, 8);

  async function copyToken() {
    if (!order?.flw_token) return;
    const raw = order.flw_token.replace(/\s+/g, "");
    try {
      await navigator.clipboard.writeText(raw);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = raw; document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); } catch {}
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <main id="content" className="max-w-xl mx-auto px-5 pt-10 sm:pt-16 pb-24">
      <div className={`w-14 h-14 rounded-full flex items-center justify-center ${tone.ring}`} aria-hidden="true">
        {c.tone === "ok" && <svg width="28" height="28" viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" /></svg>}
        {c.tone === "work" && <svg className="spin" width="26" height="26" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity=".25" strokeWidth="3" /><path d="M21 12a9 9 0 00-9-9" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" /></svg>}
        {c.tone === "wait" && <svg width="26" height="26" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2.4" /><path d="M12 7v5l3 2" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" /></svg>}
        {c.tone === "check" && <svg width="26" height="26" viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" strokeWidth="2.6" /><path d="M16 16l5 5" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" /></svg>}
        {c.tone === "bad" && <svg width="26" height="26" viewBox="0 0 24 24"><path d="M12 7v6M12 17.2v.1" stroke="currentColor" strokeWidth="3" strokeLinecap="round" /><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2.4" /></svg>}
      </div>

      <h1 className={`font-display font-bold text-3xl sm:text-4xl leading-tight tracking-tight mt-6 ${tone.text}`} role="status">
        {c.title}
      </h1>
      <p className="text-haze mt-3 text-lg leading-relaxed">{c.body}</p>

      {steps.length > 0 && (
        <ol className="mt-8 flex items-center gap-2 text-sm font-medium" aria-label="Order progress">
          {steps.map((st, n) => (
            <li key={n} className="flex items-center gap-2 flex-1 last:flex-none">
              <span className={`shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${
                st.state === "done" ? "bg-ok text-white" : st.state === "now" ? "bg-cta text-oncta" : st.state === "bad" ? "bg-bad text-white" : "bg-sunk text-haze"
              }`}>
                {st.state === "done" ? <svg width="13" height="13" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" /></svg> : st.state === "bad" ? "!" : n + 1}
              </span>
              <span className={st.state === "todo" ? "text-haze" : "text-paper"}>{st.label}</span>
              {n < steps.length - 1 && <span className={`h-px flex-1 ${st.state === "done" ? "bg-ok/50" : "bg-line"}`} aria-hidden="true" />}
            </li>
          ))}
        </ol>
      )}

      {order.flw_token && (
        <div className="mt-8 rounded-3xl bg-[#0B1026] text-[#F5F2E9] p-6 shadow-card">
          <p className="text-sm text-[#C9CEE5]">Meter token</p>
          <p className="font-mono font-medium text-[1.65rem] sm:text-3xl tracking-[0.08em] leading-snug break-words mt-2 text-[#FFB627] flicker num" aria-label={`Token ${order.flw_token.split("").join(" ")}`}>
            {groupToken(order.flw_token)}
          </p>
          <div className="flex items-center justify-between gap-4 mt-5">
            <p className="text-sm text-[#C9CEE5] leading-snug">Enter this on the prepaid meter to load the units.</p>
            <button type="button" onClick={copyToken}
              className="shrink-0 h-11 px-5 rounded-xl bg-[#FFB627] text-[#0B1026] font-display font-bold hover:brightness-105 active:brightness-95">
              {copied ? "Copied" : "Copy token"}
            </button>
          </div>
        </div>
      )}

      {tokenPending && (
        <div className="mt-8 rounded-2xl border border-line bg-panel p-5">
          <p className="font-display font-bold">Your token is being issued</p>
          <p className="text-haze text-sm leading-relaxed mt-1.5">
            It usually appears here within a minute. We&rsquo;ll also email it to you the moment it lands, so
            it&rsquo;s safe to close this page.
          </p>
        </div>
      )}

      <div className="mt-8 rounded-3xl border border-line bg-panel shadow-card">
        <dl className="p-5 sm:p-6 space-y-3 text-[15px]">
          <Row k="Service" v={order.biller_name.replace(/\s+VTU$/i, "")} />
          <Row k={order.identifier_label} v={order.identifier} num />
          {order.customer_name && <Row k="Account name" v={order.customer_name} />}
          <Row k="Amount" v={`${sym}${Number(order.amount_ngn).toLocaleString("en-NG")}`} num />
        </dl>
        <div className="tear bg-sunk rounded-b-3xl p-5 sm:p-6 space-y-3 text-[15px]">
          <dl className="space-y-3">
            <div className="flex justify-between items-baseline gap-4">
              <dt className="font-semibold">You paid</dt>
              <dd className="font-display font-bold text-2xl num">{chargedText}</dd>
            </div>
            <Row k="Order number" v={orderNo} mono />
          </dl>
        </div>
      </div>

      {needsHelp && (
        <div className="mt-6 rounded-2xl border border-line p-5">
          <p className="font-display font-bold">Need to talk to us?</p>
          <p className="text-haze text-sm leading-relaxed mt-1.5">
            Email <a className="text-tungsten underline underline-offset-2" href={`mailto:nolgichq@gmail.com?subject=${encodeURIComponent("Order " + orderNo)}`}>nolgichq@gmail.com</a> and
            quote order number <span className="font-mono text-paper">{orderNo}</span>.
          </p>
          {order.status === "needs_review" && (
            <button type="button" onClick={() => window.location.reload()}
              className="mt-4 h-11 px-5 rounded-xl border border-paper/25 font-semibold hover:bg-sunk">
              Check again
            </button>
          )}
        </div>
      )}

      <a href="/" className="mt-10 h-12 flex items-center justify-center rounded-xl border border-paper/25 font-semibold hover:bg-sunk">
        Make another payment
      </a>
    </main>
  );
}

function Row({ k, v, num, mono }: { k: string; v: string; num?: boolean; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-6">
      <dt className="text-haze">{k}</dt>
      <dd className={`text-right break-all ${num ? "num" : ""} ${mono ? "font-mono" : ""}`}>{v}</dd>
    </div>
  );
}
