"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import type { BulkView } from "@/lib/bulk-shared";

const naira = (n: number) => `₦${Math.round(n).toLocaleString("en-NG")}`;
const NET: Record<string, string> = { mtn: "MTN", glo: "Glo", airtel: "Airtel", "9mobile": "9mobile" };

type Tone = "wait" | "work" | "ok" | "bad" | "check";
function headline(v: BulkView): { title: string; body: string; tone: Tone } {
  switch (v.status) {
    case "pending_payment": return { title: "Waiting for payment", body: "Complete your payment to continue. This page updates by itself.", tone: "wait" };
    case "paid":
    case "processing":
    case "settling":
      return { title: "Sending your airtime", body: "Each number is being topped up. This usually takes a minute or two. You can close this page; we email you the result.", tone: "work" };
    case "settled":
      if (v.failed === 0) return { title: "All delivered", body: `Airtime has been sent to all ${v.count} numbers.`, tone: "ok" };
      if (v.delivered === 0) return { title: "Nothing could be delivered. You’ve been refunded", body: "The provider didn’t complete any of these numbers, so we’ve refunded your whole payment, fee included. It can take a few working days to show.", tone: "bad" };
      return { title: `${v.delivered} of ${v.count} delivered`, body: `${v.failed} number${v.failed > 1 ? "s" : ""} didn’t go through. We’ve refunded ${naira(v.refunded_ngn)} for ${v.failed > 1 ? "them" : "it"}. It can take a few working days to show.`, tone: "ok" };
    case "needs_review": return { title: "Payment received. We’re checking your batch", body: "The provider hasn’t given us a final answer yet, so we’re checking it by hand. Every number will either be delivered or refunded. Your money is safe.", tone: "check" };
    case "refund_failed": return { title: "We need to fix something", body: "Some numbers failed and the automatic refund didn’t go through. We’ve been alerted. Email nolgichq@gmail.com with your batch number and we’ll sort it out straight away.", tone: "bad" };
    default: return { title: "This batch expired", body: "No payment was taken. You can start a new batch any time.", tone: "wait" };
  }
}
const RING: Record<Tone, string> = { wait: "bg-sunk text-haze", work: "bg-cta/20 text-tungsten", ok: "bg-ok/15 text-ok", bad: "bg-bad/15 text-bad", check: "bg-cta/20 text-tungsten" };

export default function BulkStatusPage() {
  const { id } = useParams<{ id: string }>();
  const [v, setV] = useState<BulkView | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function poll() {
      try {
        const r = await fetch(`/api/bulk?id=${id}`, { cache: "no-store" });
        if (r.status === 404) { if (!stop) setMissing(true); return; }
        if (r.ok) {
          const d: BulkView = await r.json();
          if (stop) return;
          setV(d);
          if (["settled", "refund_failed", "expired"].includes(d.status)) return;
          timer = setTimeout(poll, d.status === "needs_review" ? 15000 : 4000);
          return;
        }
      } catch { /* network blip: try again */ }
      if (!stop) timer = setTimeout(poll, 6000);
    }
    poll();
    return () => { stop = true; if (timer) clearTimeout(timer); };
  }, [id]);

  if (missing) {
    return (
      <main id="content" className="max-w-xl mx-auto px-5 pt-16 pb-24">
        <h1 className="font-display font-bold text-3xl mt-10">We can&rsquo;t find that batch</h1>
        <a href="/bulk" className="inline-block mt-8 h-12 leading-[3rem] px-6 rounded-xl bg-cta text-oncta font-display font-bold">Start a new batch</a>
      </main>
    );
  }
  if (!v) {
    return (
      <main id="content" className="max-w-xl mx-auto px-5 pt-16 pb-24" aria-busy="true">
        <div className="h-14 w-14 rounded-full bg-sunk" />
        <div className="h-8 w-3/4 rounded-lg bg-sunk mt-6" />
        <div className="h-4 w-full rounded bg-sunk mt-4" />
        <p className="sr-only">Loading batch…</p>
      </main>
    );
  }

  const h = headline(v);
  const done = v.delivered + v.failed;
  const pct = v.count ? Math.round((done / v.count) * 100) : 0;
  const paidNet = v.amount_total + v.service_fee - v.refunded_ngn;
  const paid = v.status !== "pending_payment" && v.status !== "expired";

  return (
    <main id="content" className="max-w-2xl mx-auto px-5 pt-10 sm:pt-14 pb-24">
      <div className={`mt-2 w-14 h-14 rounded-full flex items-center justify-center ${RING[h.tone]}`} aria-hidden="true">
        {h.tone === "ok" && <svg width="28" height="28" viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" /></svg>}
        {h.tone === "work" && <svg className="spin" width="26" height="26" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity=".25" strokeWidth="3" /><path d="M21 12a9 9 0 00-9-9" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" /></svg>}
        {h.tone === "wait" && <svg width="26" height="26" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2.4" /><path d="M12 7v5l3 2" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" /></svg>}
        {h.tone === "check" && <svg width="26" height="26" viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" strokeWidth="2.6" /><path d="M16 16l5 5" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" /></svg>}
        {h.tone === "bad" && <svg width="26" height="26" viewBox="0 0 24 24"><path d="M12 7v6M12 17.2v.1" stroke="currentColor" strokeWidth="3" strokeLinecap="round" /><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2.4" /></svg>}
      </div>
      <h1 className="font-display font-bold text-3xl sm:text-4xl leading-tight tracking-tight mt-6" role="status">{h.title}</h1>
      <p className="text-haze mt-3 text-lg leading-relaxed">{h.body}</p>

      {paid && v.status !== "needs_review" && (
        <div className="mt-6" aria-label="Progress">
          <div className="h-2 rounded-full bg-sunk overflow-hidden"><div className="h-full bg-cta transition-all duration-500" style={{ width: `${pct}%` }} /></div>
          <p className="text-sm text-haze mt-2 num">{done} of {v.count} finished{v.failed > 0 ? ` · ${v.failed} failed` : ""}</p>
        </div>
      )}

      <div className="mt-8 rounded-3xl border border-line bg-panel shadow-card">
        <ul className="divide-y divide-line">
          {v.recipients.map((r) => (
            <li key={r.row} className="px-5 py-3 flex items-center justify-between gap-3 text-[15px]">
              <span className="num">{r.phone} <span className="text-haze">· {NET[r.network] ?? r.network}</span></span>
              <span className="flex items-center gap-3">
                <span className="num text-haze">{naira(r.amount)}</span>
                <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${r.status === "delivered" ? "bg-ok/15 text-ok" : r.status === "failed" ? "bg-bad/15 text-bad" : "bg-sunk text-haze"}`}>
                  {r.status === "delivered" ? "Delivered" : r.status === "failed" ? (v.status === "settled" ? "Refunded" : "Failed") : paid ? "Sending" : "Waiting"}
                </span>
              </span>
            </li>
          ))}
        </ul>
        <div className="tear bg-sunk rounded-b-3xl p-5 sm:p-6 space-y-2 text-[15px]">
          <div className="flex justify-between"><span className="text-haze">Airtime</span><span className="num">{naira(v.amount_total)}</span></div>
          <div className="flex justify-between"><span className="text-haze">Service fee</span><span className="num">{naira(v.service_fee)}</span></div>
          {v.refunded_ngn > 0 && <div className="flex justify-between"><span className="text-haze">Refunded</span><span className="num text-ok">−{naira(v.refunded_ngn)}</span></div>}
          <div className="flex justify-between items-baseline pt-2 border-t border-line">
            <span className="font-semibold">{v.status === "settled" ? "You paid" : "Total"}</span>
            <span className="num font-display font-bold text-2xl">{naira(v.status === "settled" ? paidNet : v.amount_total + v.service_fee)}</span>
          </div>
        </div>
      </div>
      <p className="text-sm text-haze mt-4">Batch number <span className="num">{v.id.slice(0, 8)}</span></p>
      <a href="/bulk" className="inline-block mt-6 h-12 leading-[3rem] px-6 rounded-xl border border-line font-medium hover:bg-sunk">Start another batch</a>
    </main>
  );
}
