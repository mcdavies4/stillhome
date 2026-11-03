"use client";

import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";

type Info = { item: string; amount: number; answered: boolean; reasons: { key: string; label: string }[] };

// Opened from the "Did something go wrong?" email. Nothing is saved until a button is pressed.
export default function Feedback() {
  const { token } = useParams<{ token: string }>();
  const stopLink = useSearchParams().get("stop") === "1";
  const [info, setInfo] = useState<Info | null>(null);
  const [missing, setMissing] = useState(false);
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [state, setState] = useState<"form" | "busy" | "thanks" | "stopped">("form");
  const [error, setError] = useState("");

  useEffect(() => {
    fetch(`/api/feedback?token=${encodeURIComponent(String(token))}`)
      .then(async (r) => { if (!r.ok) { setMissing(true); return; } setInfo(await r.json()); })
      .catch(() => setMissing(true));
  }, [token]);

  async function send(body: Record<string, unknown>, done: "thanks" | "stopped") {
    setState("busy"); setError("");
    try {
      const r = await fetch("/api/feedback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, ...body }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setError(d.error ?? "Something went wrong. Please try again."); setState("form"); return; }
      setState(done);
    } catch { setError("Can't reach Nolgic. Check your connection and try again."); setState("form"); }
  }

  return (
    <main id="content" className="max-w-xl mx-auto px-5 pt-12 pb-24">
      {missing ? (
        <>
          <h1 className="font-display font-extrabold text-3xl">This link isn't valid</h1>
          <p className="mt-3 text-haze">It may be mistyped. You can reach us any time at nolgichq@gmail.com.</p>
        </>
      ) : !info ? (
        <p className="text-haze">Loading…</p>
      ) : state === "thanks" ? (
        <>
          <h1 className="font-display font-extrabold text-3xl">Thank you</h1>
          <p className="mt-3 text-haze">That helps us fix it. If you still need {info.item}, you can start again any time at <a className="underline underline-offset-4" href="/">nolgic.com</a>.</p>
        </>
      ) : state === "stopped" ? (
        <>
          <h1 className="font-display font-extrabold text-3xl">Done</h1>
          <p className="mt-3 text-haze">We won't send you emails like this again.</p>
        </>
      ) : stopLink ? (
        <>
          <h1 className="font-display font-extrabold text-3xl">Stop these emails?</h1>
          <p className="mt-3 text-haze">We'll stop sending "did something go wrong?" emails to this address. Receipts for orders you pay for are not affected.</p>
          <button type="button" disabled={state === "busy"} onClick={() => send({ stop: true }, "stopped")} className="mt-6 h-12 px-6 rounded-xl bg-cta text-oncta font-display font-bold disabled:opacity-50">Stop emailing me</button>
          {error && <p role="alert" className="mt-3 text-bad">{error}</p>}
        </>
      ) : info.answered ? (
        <>
          <h1 className="font-display font-extrabold text-3xl">Already received</h1>
          <p className="mt-3 text-haze">You've already told us. Thank you. Anything else? Reply to our email or write to nolgichq@gmail.com.</p>
        </>
      ) : (
        <>
          <h1 className="font-display font-extrabold text-3xl">What got in the way?</h1>
          <p className="mt-3 text-haze">You started an order for <b className="text-paper">{info.item}</b>. No money was taken for it. Pick the closest one.</p>
          <fieldset className="mt-6 grid gap-2" aria-label="What happened">
            {info.reasons.map((r) => (
              <label key={r.key} className={`flex items-center gap-3 rounded-xl border px-4 min-h-[52px] cursor-pointer ${reason === r.key ? "border-tungsten bg-sunk" : "border-line"}`}>
                <input type="radio" name="reason" value={r.key} checked={reason === r.key} onChange={() => setReason(r.key)} className="accent-[#FFB627]" />
                <span>{r.label}</span>
              </label>
            ))}
          </fieldset>
          <label className="block mt-5">
            <span className="text-sm font-medium">Anything you'd like to add? (optional)</span>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} rows={4} className="mt-1.5 w-full rounded-xl border border-line bg-panel px-4 py-3" />
          </label>
          {error && <p role="alert" className="mt-3 text-bad">{error}</p>}
          <button type="button" disabled={!reason || state === "busy"} onClick={() => send({ reason, note }, "thanks")} className="mt-5 h-12 px-6 rounded-xl bg-cta text-oncta font-display font-bold disabled:opacity-40">Send</button>
          <p className="mt-6 text-xs text-haze">The 36th Solutions Ltd, trading as Nolgic. We only use this to improve the service. <a className="underline underline-offset-4" href={`/feedback/${String(token)}?stop=1`}>Don't email me like this again</a>.</p>
        </>
      )}
    </main>
  );
}
