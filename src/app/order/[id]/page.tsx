"use client";

import { useEffect, useState } from "react";
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
};

const COPY: Record<string, { title: string; body: string; tone: string }> = {
  pending_payment: { title: "Waiting for payment…", body: "Complete the Stripe checkout to continue.", tone: "text-haze" },
  paid: { title: "Delivering now…", body: "Payment received — vending with the provider. This usually takes seconds.", tone: "text-tungsten" },
  fulfilled: { title: "Delivered. They\u2019re covered ✅", body: "The payment landed. If you added a WhatsApp number, the receipt is on its way.", tone: "text-ok" },
  failed_refunded: { title: "Delivery failed — you’ve been refunded", body: "The provider rejected the payment, so we refunded your card in full automatically. Check the details and try again.", tone: "text-bad" },
  refund_failed: { title: "Something went wrong", body: "Delivery failed and the automatic refund needs attention. Contact support with this order ID — we’ll sort it immediately.", tone: "text-bad" },
};

export default function OrderPage() {
  const { id } = useParams<{ id: string }>();
  const [order, setOrder] = useState<Order | null>(null);

  useEffect(() => {
    let stop = false;
    async function poll() {
      const r = await fetch(`/api/orders?id=${id}`);
      if (r.ok) {
        const d: Order = await r.json();
        if (!stop) setOrder(d);
        if (["paid", "pending_payment"].includes(d.status) && !stop) {
          setTimeout(poll, 2500);
        }
      }
    }
    poll();
    return () => { stop = true; };
  }, [id]);

  if (!order) return <main className="max-w-xl mx-auto px-5 pt-20 text-haze">Loading order…</main>;

  const c = COPY[order.status] ?? COPY.paid;

  return (
    <main className="max-w-xl mx-auto px-5 pt-16 pb-24">
      <h1 className={`font-display font-extrabold text-3xl ${c.tone} ${order.status === "fulfilled" ? "flicker" : ""}`}>
        {c.title}
      </h1>
      <p className="text-haze mt-3 leading-relaxed">{c.body}</p>

      <div className="bg-panel border border-line rounded-2xl p-5 mt-8 space-y-3 font-mono text-sm">
        <Row k="Service" v={order.biller_name} />
        <Row k={order.identifier_label} v={order.identifier} />
        {order.customer_name && <Row k="Account" v={order.customer_name} />}
        <Row k="Amount" v={`₦${Number(order.amount_ngn).toLocaleString("en-NG")}`} />
        <Row k="Charged" v={`£${(order.amount_gbp_pence / 100).toFixed(2)}`} />
        <Row k="Order" v={order.id.slice(0, 8)} />
      </div>

      {order.flw_token && (
        <div className="mt-6 border border-tungsten/50 bg-tungsten/10 rounded-2xl p-5 shadow-glow">
          <p className="font-mono text-xs text-tungsten uppercase tracking-widest mb-2">Meter token</p>
          <p className="font-mono text-2xl tracking-widest break-all">{order.flw_token}</p>
          <p className="text-haze text-sm mt-2">Load this on the prepaid meter to restore power.</p>
        </div>
      )}

      <a href="/" className="block text-center text-tungsten mt-10 underline underline-offset-4">
        Make another payment
      </a>
    </main>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-haze">{k}</span>
      <span className="text-right">{v}</span>
    </div>
  );
}
