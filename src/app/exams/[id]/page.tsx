"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { splitPins } from "@/lib/exams-shared";

type Order = {
  id: string; status: string; biller_name: string; identifier: string; identifier_label: string;
  amount_ngn: number; service_fee_local?: number | null; flw_token: string | null; created_at?: string;
};

const naira = (n: number) => `₦${Math.round(n).toLocaleString("en-NG")}`;

const COPY: Record<string, { title: string; body: string }> = {
  pending_payment: { title: "Waiting for payment", body: "Finish your payment to get the PIN. This page updates by itself." },
  paid: { title: "Payment received. Getting your PIN", body: "This usually takes a few seconds." },
  fulfilled: { title: "Your PIN is ready", body: "It is also in your email. Keep it private, because anyone who has it can use it." },
  needs_review: { title: "Payment received. We’re confirming your PIN", body: "The exam board’s system hasn’t confirmed this one yet, so we’re checking it by hand. You will get the PIN by email, or a full refund. Your money is safe." },
  failed_refunded: { title: "We couldn’t get your PIN. You’ve been refunded", body: "The payment has been refunded in full. It can take a few working days to show on your statement. Check the details and try again." },
  refund_failed: { title: "We need to fix something", body: "We couldn’t get your PIN and the automatic refund didn’t go through. We’ve been alerted. Email nolgichq@gmail.com with your order number and we’ll sort it out straight away." },
  expired: { title: "This order expired", body: "No payment was taken. You can start a new order any time." },
};

export default function ExamOrderPage() {
  const { id } = useParams<{ id: string }>();
  const [order, setOrder] = useState<Order | null>(null);
  const [missing, setMissing] = useState(false);
  const [copied, setCopied] = useState("");

  useEffect(() => {
    let stop = false;
    let tries = 0;
    async function poll() {
      try {
        const r = await fetch(`/api/orders?id=${id}`);
        if (r.status === 404 || r.status === 400) { if (!stop) setMissing(true); return; }
        if (r.ok) {
          const d: Order = await r.json();
          if (stop) return;
          setOrder(d);
          // Keep checking while the payment or the PIN is still on its way (about 5 minutes), then stop.
          if (["paid", "pending_payment", "needs_review"].includes(d.status) && tries++ < 100) setTimeout(poll, 3000);
        } else if (tries++ < 5) setTimeout(poll, 3000);
      } catch { if (tries++ < 5) setTimeout(poll, 3000); }
    }
    poll();
    return () => { stop = true; };
  }, [id]);

  async function copy(label: string, value: string) {
    try { await navigator.clipboard.writeText(value); }
    catch {
      const ta = document.createElement("textarea");
      ta.value = value; document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); } catch {}
      document.body.removeChild(ta);
    }
    setCopied(label);
    setTimeout(() => setCopied(""), 2000);
  }

  if (missing) {
    return (
      <main id="content" className="max-w-xl mx-auto px-5 pt-16 pb-24">
        <h1 className="font-display font-bold text-3xl mt-10">We can&rsquo;t find that order</h1>
        <p className="text-haze mt-3">Check the link in your email, or <a className="underline underline-offset-4" href="/exams">start a new order</a>.</p>
      </main>
    );
  }
  if (!order) {
    return (
      <main id="content" className="max-w-xl mx-auto px-5 pt-16 pb-24" aria-busy="true">
        <div className="h-8 w-3/4 rounded-lg bg-sunk" /><div className="h-4 w-full rounded bg-sunk mt-4" />
        <p className="sr-only">Loading order…</p>
      </main>
    );
  }

  const c = COPY[order.status] ?? COPY.paid;
  const pins = order.status === "fulfilled" ? splitPins(order.flw_token) : [];
  const total = Number(order.amount_ngn) + Number(order.service_fee_local ?? 0);

  return (
    <main id="content" className="max-w-xl mx-auto px-5 pt-10 sm:pt-16 pb-24">
      <h1 className="font-display font-bold text-3xl leading-tight" role="status">{c.title}</h1>
      <p className="text-haze mt-3 text-lg leading-relaxed">{c.body}</p>

      {order.status === "fulfilled" && !pins.length && (
        <p className="mt-6 rounded-2xl bg-sunk p-4 text-haze" role="status">Your PIN is on its way by email. If it doesn&rsquo;t arrive in a few minutes, email nolgichq@gmail.com with order number {order.id.slice(0, 8)}.</p>
      )}
      {pins.length > 0 && (
        <div className="mt-6 space-y-3">
          {pins.map((p, i) => (
            <div key={i} className="rounded-3xl border border-line bg-panel p-5">
              <p className="text-sm text-haze">{p.label}</p>
              <p className="font-mono font-medium text-2xl sm:text-3xl tracking-[0.06em] break-all mt-2 text-tungsten num">{p.value}</p>
              <button type="button" onClick={() => copy(`${p.label}${i}`, p.value)}
                className="mt-3 h-11 px-5 rounded-xl border border-line text-paper font-medium hover:bg-sunk">
                {copied === `${p.label}${i}` ? "Copied" : `Copy ${p.label.toLowerCase()}`}
              </button>
            </div>
          ))}
        </div>
      )}

      <dl className="mt-8 rounded-3xl bg-sunk p-5 space-y-2 text-[15px]">
        <div className="flex justify-between gap-4"><dt className="text-haze">Order</dt><dd className="num">{order.id.slice(0, 8)}</dd></div>
        <div className="flex justify-between gap-4"><dt className="text-haze">Item</dt><dd className="text-right">{order.biller_name}</dd></div>
        <div className="flex justify-between gap-4"><dt className="text-haze">{order.identifier_label}</dt><dd className="num">{order.identifier}</dd></div>
        <div className="flex justify-between gap-4 pt-2 border-t border-line"><dt className="font-semibold">Total paid</dt><dd className="num font-semibold">{naira(total)}</dd></div>
      </dl>
      <p className="text-sm text-haze mt-6">Questions? Email <a className="underline underline-offset-4" href="mailto:nolgichq@gmail.com">nolgichq@gmail.com</a> or use Help on this page.</p>
    </main>
  );
}
