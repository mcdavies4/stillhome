"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { playUrl } from "@/lib/app-links";

const KEY = "nolgic-play-banner";
const HIDE_DAYS = 30;

// A slim strip at the very top, shown ONLY to people on an Android phone browser who haven't closed it
// in the last 30 days. Not shown on desktop or iPhone (the app is Android only), inside the installed
// app / home-screen app, or on admin and feedback pages. It sits in the page (not fixed), so it never covers
// the pay form, the support button or the "someone just paid" notice.
export default function AndroidBanner() {
  const path = usePathname() ?? "";
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (path.startsWith("/admin") || path.startsWith("/feedback")) { setShow(false); return; }
    try {
      const isAndroid = /Android/i.test(navigator.userAgent);
      const isMobile = /Mobile/i.test(navigator.userAgent); // Android tablets say "Android" without "Mobile"
      const installed = window.matchMedia?.("(display-mode: standalone)").matches || /; wv\)/i.test(navigator.userAgent);
      if (!isAndroid || !isMobile || installed) { setShow(false); return; }
      const t = Number(localStorage.getItem(KEY) ?? 0);
      setShow(!(t && Date.now() - t < HIDE_DAYS * 86400_000));
    } catch { setShow(true); } // storage blocked: still show it, the close button works for this visit
  }, [path]);

  if (!show) return null;
  const close = () => { try { localStorage.setItem(KEY, String(Date.now())); } catch { /* ignore */ } setShow(false); };

  return (
    <div role="region" aria-label="Get the Nolgic app" className="bg-sunk border-b border-line">
      <div className="max-w-6xl mx-auto pl-5 pr-2 h-14 flex items-center gap-3">
        <img src="/icon-192.png" alt="" width={32} height={32} className="rounded-lg shrink-0" />
        <p className="flex-1 min-w-0 text-[13px] leading-tight">
          <span className="block font-semibold">Nolgic for Android</span>
          <span className="block text-haze truncate">Pay light, TV, airtime and data faster</span>
        </p>
        <a href={playUrl("banner")} target="_blank" rel="noopener" className="shrink-0 h-9 px-4 inline-flex items-center rounded-lg bg-cta text-oncta text-sm font-display font-bold">
          Install
        </a>
        <button type="button" onClick={close} aria-label="Close" className="shrink-0 w-10 h-10 inline-flex items-center justify-center rounded-lg text-haze hover:text-paper">
          <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" /></svg>
        </button>
      </div>
    </div>
  );
}
