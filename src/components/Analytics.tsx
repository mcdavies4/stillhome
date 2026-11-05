"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { track, trackView } from "@/lib/track";

// Counts page views (and a few button clicks) with the first-party counter. Renders nothing.
export default function Analytics() {
  const path = usePathname();
  const last = useRef<string | null>(null);

  useEffect(() => {
    if (!path || last.current === path) return;
    last.current = path;
    trackView(path);
  }, [path]);

  // Link clicks without touching every link: the Play Store and WhatsApp share links.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement | null)?.closest?.("a") as HTMLAnchorElement | null;
      if (!a || !a.href) return;
      try {
        const u = new URL(a.href);
        if (u.hostname === "play.google.com") track("play_click", new URLSearchParams(u.searchParams.get("referrer") || "").get("utm_campaign") || "play");
        else if (u.hostname === "wa.me" || u.hostname === "api.whatsapp.com") track("share_click", "whatsapp");
      } catch {}
    };
    document.addEventListener("click", onClick, { capture: true });
    return () => document.removeEventListener("click", onClick, { capture: true } as any);
  }, []);
  return null;
}
