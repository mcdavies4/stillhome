// "Running low soon": which of a signed-in customer's meters and TV cards are probably about to need a top-up.
// Uses the same prediction as the reminder emails (lib/reminders.ts), so the two never disagree.
// Read-only: it never writes anything and never touches the payment path.

import { supabaseAdmin } from "@/lib/supabase";
import { forecastMeters, GRACE_DAYS, HISTORY_DAYS, type Hist } from "@/lib/reminders";
import type { Saved } from "@/lib/saved";

const DAY = 86400_000;
export const SHOW_WITHIN_DAYS = 14;   // only meters expected to run out within two weeks
export const MAX_SHOWN = 4;

export type Topup = {
  kind: "electricity" | "tv";
  name: string;            // "IKEJA ELECTRIC", "DSTV"
  tail: string;            // "…1234"
  daysLeft: number;        // whole days; 0 or less means "probably low now"
  gapDays: number;
  basis: "own history" | "usual";
  lastAt: string;
  amountNgn: number;
  orderId: string;
  savedId: string | null;  // when the meter is saved, the one-tap Pay button can use it
};

export const cleanName = (n: string | null | undefined) => String(n ?? "").replace(/\s*(PREPAID|POSTPAID|VTU)$/i, "").trim();

/** Pure: forecasts for one customer's delivered orders, trimmed to what is worth showing. */
export function topupsFrom(history: Hist[], saved: Saved[], now: number): Topup[] {
  return forecastMeters(history, now)
    .filter((f) => f.daysLeft <= SHOW_WITHIN_DAYS && f.ageDays <= f.gapDays + GRACE_DAYS)
    .sort((a, b) => a.daysLeft - b.daysLeft)
    .slice(0, MAX_SHOWN)
    .map((f) => {
      const o = f.order;
      const match = saved.find((s) => s.identifier === o.identifier && s.billerCode === (o.biller_code ?? ""));
      return {
        kind: f.kind,
        name: cleanName(o.biller_name) || (f.kind === "tv" ? "TV" : "Electricity"),
        tail: o.identifier.length > 4 ? `…${o.identifier.slice(-4)}` : o.identifier,
        daysLeft: Math.round(f.daysLeft),
        gapDays: f.gapDays,
        basis: f.basis,
        lastAt: o.created_at,
        amountNgn: Number(o.amount_ngn) || 0,
        orderId: o.id,
        savedId: match?.id ?? null,
      };
    });
}

export async function accountTopups(email: string, saved: Saved[], now = Date.now()): Promise<Topup[]> {
  const since = new Date(now - HISTORY_DAYS * DAY).toISOString();
  const { data } = await supabaseAdmin().from("orders")
    .select("id,email,identifier,biller_code,item_code,biller_name,amount_ngn,created_at,is_test")
    .eq("email", email).eq("status", "fulfilled").gte("created_at", since).order("created_at", { ascending: false }).limit(300);
  const history = ((data ?? []) as any[]).filter((o) => !o.is_test) as Hist[];
  return topupsFrom(history, saved, now);
}
