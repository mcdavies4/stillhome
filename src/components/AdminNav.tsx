"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

// One menu for every admin page. The support-inbox link carries the unread count.
// It reads the same sign-in (sessionStorage "nolgic-admin") the admin pages use; signed out, it simply shows no count.
const ITEMS: { href: string; label: string }[] = [
  { href: "/admin", label: "Dashboard" },
  { href: "/admin/analytics", label: "Visitors" },
  { href: "/admin/inbox", label: "Support inbox" },
  { href: "/admin/finance", label: "Finance" },
  { href: "/admin/growth", label: "Growth" },
  { href: "/admin/feedback", label: "Abandoned orders" },
  { href: "/admin/exams-check", label: "Exam PIN check" },
  { href: "/admin/partners", label: "Partners" },
];

export default function AdminNav({ tone = "site" }: { tone?: "site" | "night" }) {
  const path = (usePathname() ?? "").replace(/\/$/, "") || "/";
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    let alive = true;
    const check = async () => {
      let pass: string | null = null;
      try { pass = sessionStorage.getItem("nolgic-admin"); } catch {}
      if (!pass) { if (alive) setUnread(0); return; }
      try {
        const r = await fetch("/api/admin/support", { headers: { Authorization: `Bearer ${pass}` }, cache: "no-store" });
        if (r.ok && alive) setUnread(Number((await r.json()).unread ?? 0) || 0);
      } catch {}
    };
    check();
    const t = setInterval(check, 45000);
    const onAuth = () => { check(); };
    window.addEventListener("nolgic-admin-auth", onAuth);
    return () => { alive = false; clearInterval(t); window.removeEventListener("nolgic-admin-auth", onAuth); };
  }, [path]);

  const night = tone === "night";
  return (
    <nav aria-label="Admin pages" className={night ? "" : "border-b border-line bg-panel/60"}>
      <ul className={`flex gap-2 overflow-x-auto whitespace-nowrap ${night ? "" : "max-w-5xl mx-auto px-4 sm:px-5 py-2.5"}`}>
        {ITEMS.map((it) => {
          const here = it.href === "/admin" ? path === "/admin" : path === it.href || path.startsWith(it.href + "/");
          const hot = it.href === "/admin/inbox" && unread > 0;
          const base = "inline-flex items-center gap-2 h-9 px-3.5 rounded-xl border text-sm font-semibold transition-colors";
          const look = night
            ? here ? "border-[#FFB627] bg-[#FFB627] text-[#0B1026]" : hot ? "border-[#FFB627] text-[#F5F2E9]" : "border-[#2a3157] text-[#F5F2E9] hover:bg-[#141A38]"
            : here ? "border-cta bg-cta text-oncta" : hot ? "border-tungsten bg-cta/15 text-paper" : "border-line text-paper hover:bg-sunk";
          return (
            <li key={it.href} className="shrink-0">
              <Link href={it.href} aria-current={here ? "page" : undefined} className={`${base} ${look}`}>
                {it.label}
                {it.href === "/admin/inbox" && unread > 0 ? <span className="px-1.5 rounded-full bg-bad text-white text-[11px]" aria-label={`${unread} unread`}>{unread}</span> : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
