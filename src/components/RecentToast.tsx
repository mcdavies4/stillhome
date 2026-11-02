"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

type Notice = { text: string; when: string };

const FIRST_DELAY = 9000; // wait before the first notice
const SHOW_FOR = 6500;
const GAP = 22000;
const MAX_PER_VISIT = 5;
const KEY = "nolgic-recent-dismissed";

// A small "someone just paid" notice built only from real, delivered orders (see /api/recent).
// Shows nothing while there are not enough real orders. Closing it stops it for the visit.
export default function RecentToast() {
  const path = usePathname();
  const [items, setItems] = useState<Notice[]>([]);
  const [shown, setShown] = useState<Notice | null>(null);

  useEffect(() => {
    if (path !== "/") return;
    try { if (sessionStorage.getItem(KEY)) return; } catch {}
    let off = false;
    fetch("/api/recent")
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d) => { if (!off && Array.isArray(d.items)) setItems(d.items); })
      .catch(() => {});
    return () => { off = true; };
  }, [path]);

  useEffect(() => {
    if (!items.length) return;
    let off = false;
    let count = 0;
    let timer: ReturnType<typeof setTimeout>;
    const next = () => {
      if (off || count >= MAX_PER_VISIT) return;
      setShown(items[count % items.length]);
      count += 1;
      timer = setTimeout(() => { setShown(null); timer = setTimeout(next, GAP); }, SHOW_FOR);
    };
    timer = setTimeout(next, FIRST_DELAY);
    return () => { off = true; clearTimeout(timer); };
  }, [items]);

  if (!shown) return null;
  return (
    <div role="status" aria-live="polite"
      className="fixed left-3 right-3 sm:right-auto bottom-3 z-40 sm:max-w-sm rounded-2xl border border-line bg-panel text-paper shadow-card px-4 py-3 flex items-start gap-3">
      <span aria-hidden className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-ok" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold leading-snug">{shown.text}</p>
        <p className="text-xs text-haze mt-0.5">{shown.when} · a real Nolgic order</p>
      </div>
      <button type="button" aria-label="Close" onClick={() => { setShown(null); setItems([]); try { sessionStorage.setItem(KEY, "1"); } catch {} }}
        className="-mr-1 -mt-1 h-8 w-8 shrink-0 rounded-lg text-haze hover:text-paper">×</button>
    </div>
  );
}
