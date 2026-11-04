"use client";

import { useEffect, useState } from "react";
import { whatsappShareUrl } from "@/lib/share";

// On a delivered order, only when referrals are switched on: the person's own invite link. A friend who pays
// their first order through it pays no service fee, and the person who invited them gets their next fee waived.
export const REFERRALS_ON = process.env.NEXT_PUBLIC_REFERRALS_ENABLED === "1";

export default function ReferCard({ orderId }: { orderId: string }) {
  const [code, setCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!REFERRALS_ON) return;
    fetch("/api/referral/code", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderId }) })
      .then((r) => (r.ok ? r.json() : null)).then((d) => { if (d?.code) setCode(d.code); }).catch(() => {});
  }, [orderId]);

  if (!REFERRALS_ON || !code) return null;
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? "https://www.nolgic.com").replace(/\/$/, "");
  const link = `${base}/?ref=${code}`;
  const msg = `I pay my light, TV, airtime and data bills on Nolgic. You see the name on the meter before you pay, and your first order has no service fee: ${link}`;
  async function copy() {
    try { await navigator.clipboard.writeText(link); } catch { /* shown on screen, can be copied by hand */ }
    setCopied(true); setTimeout(() => setCopied(false), 2000);
  }
  return (
    <div className="mt-4 rounded-2xl border border-line p-5" data-testid="refer-card">
      <p className="font-display font-bold">Invite a friend, skip your next fee</p>
      <p className="text-haze text-sm leading-relaxed mt-1">Their first order has no service fee. When it is delivered, the service fee on your next order is waived too.</p>
      <p className="mt-3 font-mono text-sm break-all select-all">{link}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <a href={whatsappShareUrl(msg)} target="_blank" rel="noopener noreferrer" className="h-11 px-5 inline-flex items-center rounded-xl bg-cta text-oncta font-display font-bold hover:brightness-105 active:brightness-95">Send on WhatsApp</a>
        <button type="button" onClick={copy} className="h-11 px-5 rounded-xl border border-paper/25 font-semibold hover:bg-sunk">{copied ? "Copied" : "Copy link"}</button>
      </div>
    </div>
  );
}
