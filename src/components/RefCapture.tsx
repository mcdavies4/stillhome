"use client";

import { useEffect } from "react";
import { CODE_RE } from "@/lib/referral-client";

// Remembers an invite code from ?ref=CODE for 30 days, so it is still there when the friend gets to pay.
// Does nothing unless referrals are switched on.
export default function RefCapture() {
  useEffect(() => {
    if (process.env.NEXT_PUBLIC_REFERRALS_ENABLED !== "1") return;
    try {
      const c = (new URLSearchParams(window.location.search).get("ref") ?? "").trim().toUpperCase();
      if (CODE_RE.test(c)) localStorage.setItem("nolgic.ref.v1", JSON.stringify({ code: c, at: Date.now() }));
    } catch { /* storage blocked: the invite just will not be remembered */ }
  }, []);
  return null;
}
