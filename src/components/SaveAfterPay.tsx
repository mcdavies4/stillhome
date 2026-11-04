"use client";

import { useEffect, useState } from "react";
import { addSaved, clearCandidate, isSaved, readCandidate, readSaved, writeSaved, tail, type Candidate } from "@/lib/saved";

// On a delivered order: offers to save the meter / smartcard / number that was just paid for.
// It only appears when this browser made the payment (the pay form leaves a short-lived note) and it matches this order.
export default function SaveAfterPay({ billerName, identifier }: { billerName: string; identifier: string }) {
  const [cand, setCand] = useState<Candidate | null>(null);
  const [nick, setNick] = useState("");
  const [state, setState] = useState<"hidden" | "offer" | "saved" | "failed">("hidden");

  useEffect(() => {
    const c = readCandidate();
    if (!c || c.identifier !== identifier || c.billerName.trim() !== billerName.trim()) return;
    if (isSaved(readSaved(), c)) { clearCandidate(); return; } // already saved: nothing to ask
    setCand(c); setState("offer");
  }, [billerName, identifier]);

  if (state === "hidden" || !cand) return null;

  if (state === "saved") {
    return (
      <div className="mt-4 rounded-2xl border border-ok/30 bg-ok/10 p-5" role="status">
        <p className="font-semibold text-ok">Saved on this device.</p>
        <p className="text-haze text-sm mt-1">Next time, tap it under &ldquo;Pay again&rdquo; at the top of the pay form.</p>
      </div>
    );
  }

  const save = () => {
    const ok = writeSaved(addSaved(readSaved(), cand, nick));
    if (ok) { clearCandidate(); setState("saved"); } else setState("failed");
  };

  return (
    <div className="mt-4 rounded-2xl border border-line p-5">
      <p className="font-display font-bold">Pay this again faster</p>
      <p className="text-haze text-sm leading-relaxed mt-1">
        Save {cand.ownerName ? <span className="text-paper font-medium">{cand.ownerName}</span> : <>this {cand.label.toLowerCase()}</>} ({tail(cand.identifier)}) on this device. Next time, tap it instead of typing the number.
        Nothing is stored on our servers.
      </p>
      <label htmlFor="save-nick" className="mt-3">Give it a name <span className="text-haze font-normal">(optional)</span></label>
      <input id="save-nick" value={nick} onChange={(e) => setNick(e.target.value)} maxLength={24} placeholder="e.g. Mum's light" autoComplete="off" enterKeyHint="done"
        onKeyDown={(e) => { if (e.key === "Enter") save(); }} />
      {state === "failed" && <p className="text-bad text-sm mt-2" role="status">This browser wouldn&rsquo;t let us save it. Private windows can&rsquo;t.</p>}
      <div className="mt-3 flex gap-2">
        <button type="button" onClick={save} className="h-11 px-5 rounded-xl bg-cta text-oncta font-display font-bold hover:brightness-105 active:brightness-95">Save</button>
        <button type="button" onClick={() => { clearCandidate(); setState("hidden"); }} className="h-11 px-5 rounded-xl border border-paper/25 font-semibold hover:bg-sunk">No thanks</button>
      </div>
    </div>
  );
}
