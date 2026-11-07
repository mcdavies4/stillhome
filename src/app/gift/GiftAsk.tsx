"use client";

import { useState } from "react";
import { track } from "@/lib/track";
import { GIFTS, NAME_MAX, askDetailsMessage, cleanText, type GiftKey } from "@/lib/gift";
import { whatsappShareUrl } from "@/lib/share";

const KEYS: GiftKey[] = ["electricity", "airtime", "data", "cable"];

// For a surprise, the gifter needs the meter or number first. This writes the message that asks for it.
// It is a plain wa.me link opened by the gifter's own WhatsApp: no number is collected and nothing is sent by us.
export default function GiftAsk() {
  const [kind, setKind] = useState<GiftKey>("electricity");
  const [from, setFrom] = useState("");
  const text = askDetailsMessage(kind, from);

  function open() {
    track("gift_ask", kind);
    window.open(whatsappShareUrl(text), "_blank", "noopener,noreferrer");
  }

  return (
    <div className="rounded-2xl border border-line bg-panel shadow-card p-5 sm:p-6" data-testid="gift-ask">
      <p className="font-display font-bold text-xl">Don&rsquo;t have their details yet?</p>
      <p className="text-haze mt-1.5 leading-relaxed">Ask in one tap. It opens your WhatsApp with the message written; you choose who gets it.</p>
      <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="What are you sending?">
        {KEYS.map((k) => (
          <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)}
            className={"h-10 px-4 rounded-full border text-sm font-semibold " + (kind === k ? "bg-cta text-oncta border-transparent" : "border-line hover:border-paper/40")}>
            {GIFTS[k].label}
          </button>
        ))}
      </div>
      <div className="mt-4">
        <label htmlFor="gift-ask-name">Your name <span className="text-haze font-normal">(optional)</span></label>
        <input id="gift-ask-name" value={from} onChange={(e) => setFrom(cleanText(e.target.value, NAME_MAX))} maxLength={NAME_MAX} placeholder="Emeka" autoComplete="given-name" />
      </div>
      <p className="mt-4 whitespace-pre-line rounded-xl bg-sunk border border-line p-3.5 text-[15px] leading-relaxed" aria-label="Message preview">{text}</p>
      <button type="button" onClick={open}
        className="mt-4 h-12 px-6 inline-flex items-center rounded-xl bg-[#25D366] text-[#0b2a16] font-display font-bold hover:brightness-105 active:brightness-95">
        Ask on WhatsApp
      </button>
    </div>
  );
}
