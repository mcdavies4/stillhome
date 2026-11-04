"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

// The site-wide notice the founder sets from /admin/growth (for example "Deliveries are a little slow today").
// Shown at the top of every public page, closeable for the rest of the visit. If it cannot be loaded, nothing shows.
type S = { level?: "info" | "warn"; message?: string };
const seen = {
  get: (k: string) => { try { return sessionStorage.getItem(k); } catch { return null; } },
  set: (k: string) => { try { sessionStorage.setItem(k, "1"); } catch { /* ignore */ } },
};

export default function StatusBar() {
  const path = usePathname() ?? "";
  const [s, setS] = useState<S | null>(null);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if (path.startsWith("/admin")) return;
    let stop = false;
    fetch("/api/status").then((r) => (r.ok ? r.json() : null)).then((d: S | null) => {
      if (stop || !d || !d.message) { if (!stop) setS(null); return; }
      setS(d); setHidden(!!seen.get("nolgic-status:" + d.message));
    }).catch(() => { /* no notice */ });
    return () => { stop = true; };
  }, [path]);

  if (!s || !s.message || hidden || path.startsWith("/admin")) return null;
  const warn = s.level === "warn";
  return (
    <div role="status" data-testid="status-bar" className={`border-b ${warn ? "bg-cta/15 border-cta/40" : "bg-sunk border-line"}`}>
      <div className="max-w-6xl mx-auto pl-5 pr-2 min-h-11 py-2 flex items-center gap-3">
        <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" className={`shrink-0 ${warn ? "text-tungsten" : "text-haze"}`}><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2.2" /><path d="M12 11v5M12 7.6v.1" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" /></svg>
        <p className="flex-1 text-[13px] leading-snug">{s.message}</p>
        <button type="button" aria-label="Close notice" onClick={() => { seen.set("nolgic-status:" + s.message); setHidden(true); }} className="shrink-0 w-10 h-10 inline-flex items-center justify-center rounded-lg text-haze hover:text-paper">
          <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" /></svg>
        </button>
      </div>
    </div>
  );
}
