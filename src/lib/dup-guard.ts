// src/lib/dup-guard.ts
// Stops a second paid order for the same meter / number / plan / amount within a short window.
// Catches the double-tap, the "did it work? let me pay again" retry, and a Telegram + web double purchase.
//
// Only orders that already took money (or are being delivered) count. Unpaid links and refunded orders
// do NOT block, so an abandoned payment never stops a real retry.
// Fails OPEN: if the check itself can't run, the order goes ahead (never block a customer on a database hiccup).

import { supabaseAdmin } from "@/lib/supabase";

export const DUP_WINDOW_MIN = Number(process.env.DUP_GUARD_WINDOW_MIN ?? "10");
const COUNTS = ["paid", "fulfilled", "needs_review"];

export interface DuplicateHit { id: string; status: string; }

export async function findRecentPaidDuplicate(p: {
  identifier: string;
  billerCode: string;
  itemCode: string;
  amountNgn: number;
  windowMinutes?: number;
}): Promise<DuplicateHit | null> {
  try {
    const since = new Date(Date.now() - (p.windowMinutes ?? DUP_WINDOW_MIN) * 60_000).toISOString();
    const { data, error } = await supabaseAdmin()
      .from("orders")
      .select("id,status")
      .eq("identifier", p.identifier)
      .eq("biller_code", p.billerCode)
      .eq("item_code", p.itemCode)
      .eq("amount_ngn", Math.round(Number(p.amountNgn)))
      .gte("created_at", since)
      .in("status", COUNTS)
      .limit(1);
    if (error) return null;
    return (data ?? [])[0] ?? null;
  } catch {
    return null;
  }
}

export const duplicateMessage = (orderId: string) =>
  `We already have a paid order for this number and plan in the last ${DUP_WINDOW_MIN} minutes (order ${orderId.slice(0, 8)}). ` +
  `Check its status on your order page before paying again. If it didn't arrive, wait a few minutes or contact nolgichq@gmail.com.`;
