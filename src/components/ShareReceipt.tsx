"use client";

import { useState } from "react";
import { shareMessage, whatsappShareUrl, type ShareOrder } from "@/lib/share";

// On a delivered order: one tap opens WhatsApp with the token or details already written, ready to send to the
// person it is for. It is the customer's own WhatsApp sending it. We are not involved and send nothing.
export default function ShareReceipt({ order }: { order: ShareOrder }) {
  const [copied, setCopied] = useState(false);
  const text = shareMessage(order, (process.env.NEXT_PUBLIC_APP_URL ?? "https://www.nolgic.com").replace(/^https?:\/\//, "").replace(/\/$/, ""));
  const light = !!order.flw_token;

  async function copy() {
    try { await navigator.clipboard.writeText(text); }
    catch { const ta = document.createElement("textarea"); ta.value = text; document.body.appendChild(ta); ta.select(); try { document.execCommand("copy"); } catch {} document.body.removeChild(ta); }
    setCopied(true); setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="mt-4 rounded-2xl border border-line p-5" data-testid="share-receipt">
      <p className="font-display font-bold">{light ? "Send the token to them" : "Tell them it's done"}</p>
      <p className="text-haze text-sm leading-relaxed mt-1">
        {light ? "Opens WhatsApp with the token and meter number already written. Pick who gets it." : "Opens WhatsApp with a ready message. Pick who gets it."}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <a href={whatsappShareUrl(text)} target="_blank" rel="noopener noreferrer"
          className="h-11 px-5 inline-flex items-center gap-2 rounded-xl bg-[#25D366] text-[#0b2a16] font-display font-bold hover:brightness-105 active:brightness-95">
          <svg viewBox="0 0 32 32" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="M16 3C9.4 3 4 8.4 4 15c0 2.1.6 4.2 1.6 6L4 29l8.2-1.5c1.2.6 2.5.9 3.8.9 6.6 0 12-5.4 12-12S22.6 3 16 3zm5.5 14.5c-.3-.2-1.8-.9-2-1-.3-.1-.5-.2-.7.2s-.8 1-.9 1.2c-.2.2-.3.2-.6.1-.3-.2-1.3-.5-2.4-1.5-.9-.8-1.5-1.8-1.7-2.1-.2-.3 0-.5.1-.6l.5-.5c.1-.2.2-.3.3-.5s0-.4 0-.6c0-.2-.7-1.7-1-2.3-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4S9 11.2 9 12.7s1.1 2.9 1.2 3.1c.2.2 2.1 3.2 5.1 4.5.7.3 1.3.5 1.7.6.7.2 1.4.2 1.9.1.6-.1 1.8-.7 2-1.4.3-.7.3-1.3.2-1.4-.1-.2-.3-.2-.6-.4z" /></svg>
          Send on WhatsApp
        </a>
        <button type="button" onClick={copy} className="h-11 px-5 rounded-xl border border-paper/25 font-semibold hover:bg-sunk">{copied ? "Copied" : "Copy message"}</button>
      </div>
    </div>
  );
}
