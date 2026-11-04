"use client";

import { useEffect, useState } from "react";
import { readRef } from "@/lib/referral-client";

// Shown on the pay form to someone who arrived through a friend's invite link (only when referrals are on).
export default function RefBanner() {
  const [on, setOn] = useState(false);
  useEffect(() => { setOn(!!readRef()); }, []);
  if (!on) return null;
  return (
    <p className="mt-3 rounded-xl bg-ok/10 border border-ok/30 px-4 py-3 text-sm leading-relaxed" role="status" data-testid="ref-banner">
      A friend invited you. If this is your first order with Nolgic, there&rsquo;s no service fee. We take it off at checkout.
    </p>
  );
}
