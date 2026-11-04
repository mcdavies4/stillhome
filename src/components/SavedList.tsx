"use client";

import { useEffect, useState } from "react";
import { readSaved, removeSaved, tail, touchSaved, writeSaved, type Saved } from "@/lib/saved";

// "Saved on this device": tap one to fill the form. Lives only in this browser (see lib/saved.ts).
// Renders nothing until something is saved, so first-time visitors see no change.
export default function SavedList({ ready, onPick }: { ready: boolean; onPick: (s: Saved) => void }) {
  const [list, setList] = useState<Saved[]>([]);

  useEffect(() => {
    setList(readSaved());
    const sync = () => setList(readSaved());
    window.addEventListener("storage", sync);   // another tab saved or removed one
    window.addEventListener("focus", sync);     // came back to this tab (e.g. after paying in another)
    return () => { window.removeEventListener("storage", sync); window.removeEventListener("focus", sync); };
  }, []);

  if (!list.length) return null;

  const pick = (s: Saved) => { const next = touchSaved(list, s.id); writeSaved(next); setList(next); onPick(s); };
  const remove = (s: Saved) => { const next = removeSaved(list, s.id); writeSaved(next); setList(next); };

  return (
    <div className="mt-5" role="group" aria-label="Saved on this device">
      <p className="text-sm font-semibold mb-2">Pay again</p>
      <div className="flex flex-wrap gap-2">
        {list.map((s) => (
          <span key={s.id} className="inline-flex items-stretch rounded-2xl border border-line overflow-hidden">
            <button type="button" disabled={!ready} onClick={() => pick(s)}
              className="px-3 py-1.5 text-left hover:bg-sunk disabled:opacity-50 min-h-[2.75rem]">
              <span className="block text-sm font-semibold leading-tight">{s.nickname}</span>
              <span className="block text-[12px] text-haze leading-tight mt-0.5">{s.billerName ? s.billerName.replace(/\s*(PREPAID|POSTPAID)$/i, "") : s.label} {tail(s.identifier)}</span>
            </button>
            <button type="button" onClick={() => remove(s)} aria-label={`Remove ${s.nickname}`}
              className="w-9 flex items-center justify-center text-haze hover:text-bad border-l border-line">
              <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" /></svg>
            </button>
          </span>
        ))}
      </div>
      <p className="text-[12px] text-haze mt-2 leading-snug">Saved on this device only. We still check the name before you pay.</p>
    </div>
  );
}
