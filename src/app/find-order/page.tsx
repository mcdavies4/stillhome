"use client";

import { track } from "@/lib/track";
import { useState } from "react";
import { supportLink } from "@/lib/support-contact";

// "Lost your token or receipt?" Type the email you paid with; we email you your recent orders.
// The page never says whether an address has orders (so it cannot be used to look people up).
export default function FindOrder() {
  const [email, setEmail] = useState("");
  const [hp, setHp] = useState("");
  const [state, setState] = useState<"form" | "busy" | "sent">("form");
  const [error, setError] = useState("");
  const wa = supportLink({});

  async function submit(e: React.FormEvent) {
    track("find_order");
    e.preventDefault();
    if (state === "busy") return;
    setState("busy"); setError("");
    try {
      const r = await fetch("/api/find-order", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, website: hp }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setError(d.error ?? "Something went wrong. Please try again."); setState("form"); return; }
      setState("sent");
    } catch { setError("Can't reach Nolgic. Check your connection and try again."); setState("form"); }
  }

  return (
    <main id="content" className="max-w-xl mx-auto px-5 pt-12 pb-24">
      <h1 className="font-display font-extrabold text-3xl sm:text-4xl leading-tight tracking-tight">Find your order</h1>
      <p className="mt-3 text-haze text-lg leading-relaxed">Lost your meter token or receipt? Enter the email you paid with and we&rsquo;ll send you your recent orders.</p>

      {state === "sent" ? (
        <div className="mt-8 rounded-2xl border border-ok/30 bg-ok/10 p-5" role="status">
          <p className="font-semibold text-ok">Check your inbox.</p>
          <p className="text-haze text-sm leading-relaxed mt-1.5">
            If that address has paid for anything in the last 90 days, the email is on its way. It can take a minute, and it may land in spam.
            Nothing arrived? You may have paid with a different email. Try another, or contact us below.
          </p>
          <button type="button" onClick={() => { setState("form"); setEmail(""); }} className="mt-4 h-11 px-5 rounded-xl border border-paper/25 font-semibold hover:bg-sunk">Try another email</button>
        </div>
      ) : (
        <form onSubmit={submit} className="mt-8" noValidate>
          <label htmlFor="fo-email">Email you paid with</label>
          <input id="fo-email" type="email" inputMode="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" required />
          {/* a field only bots will fill in */}
          <div aria-hidden="true" style={{ position: "absolute", left: "-9999px", width: 1, height: 1, overflow: "hidden" }}>
            <label htmlFor="fo-web">Website</label><input id="fo-web" tabIndex={-1} autoComplete="off" value={hp} onChange={(e) => setHp(e.target.value)} />
          </div>
          {error && <p className="text-bad text-sm mt-3" role="alert">{error}</p>}
          <button type="submit" disabled={state === "busy" || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)}
            className="mt-5 h-12 px-6 rounded-xl bg-cta text-oncta font-display font-bold hover:brightness-105 active:brightness-95 disabled:opacity-50">
            {state === "busy" ? "Sending…" : "Email me my orders"}
          </button>
        </form>
      )}

      <div className="mt-10 rounded-2xl border border-line p-5">
        <p className="font-display font-bold">Still stuck?</p>
        <p className="text-haze text-sm leading-relaxed mt-1.5">
          Email <a className="text-tungsten underline underline-offset-2" href="mailto:nolgichq@gmail.com">nolgichq@gmail.com</a> with the meter, card or phone number you paid for.
        </p>
        {wa && <a href={wa} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex h-11 px-5 items-center rounded-xl border border-paper/25 font-semibold hover:bg-sunk">Message us on WhatsApp</a>}
      </div>
    </main>
  );
}
