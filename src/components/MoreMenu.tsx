"use client";

import { useEffect, useRef, useState } from "react";

export type MoreItem = { href: string; label: string; external?: boolean };

// One small menu for the links that are not the main job (how it works, FAQ, find my order, terms, the app).
// Same surface colour as the "Pay a bill" card. Closes on outside tap, Escape, or choosing a link.
export default function MoreMenu({ items }: { items: MoreItem[] }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent | TouchEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away);
    document.addEventListener("touchstart", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("touchstart", away); document.removeEventListener("keydown", esc); };
  }, [open]);

  return (
    <div ref={box} className="sm:relative">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 px-2 max-[359px]:px-1 sm:px-3 h-10 rounded-lg text-haze hover:text-paper"
      >
        Menu
        <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" className={`transition-transform ${open ? "rotate-180" : ""}`}>
          <path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div role="menu" className="absolute right-4 sm:right-0 top-full mt-2 w-56 rounded-2xl border border-line bg-panel shadow-card p-1.5 z-50">
          {items.map((i) => (
            <a
              key={i.href + i.label}
              role="menuitem"
              href={i.href}
              {...(i.external ? { target: "_blank", rel: "noopener" } : {})}
              onClick={() => setOpen(false)}
              className="block rounded-xl px-3 py-2.5 text-[15px] text-paper hover:bg-sunk"
            >
              {i.label}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
