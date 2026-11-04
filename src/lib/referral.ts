// Referral credit: a friend's invite waives the service fee on THEIR first order, and the person who invited
// them gets their next order's fee waived once that friend's order is delivered. A credit is only ever a waived
// service fee (never cash, never more than REFERRAL_MAX_WAIVE_NGN), so the most it can cost is margin we would
// have earned on that order. Switched on with NEXT_PUBLIC_REFERRALS_ENABLED=1; with it unset nothing here runs.
//
// Credits are not stored as balances. They are worked out from the referrals table and the status of the
// orders it points to, so an order that never gets paid (or is refunded) gives the credit back by itself, and
// nothing on the payment path needs to change.

import { supabaseAdmin } from "@/lib/supabase";
import { randomBytes } from "node:crypto";
import { CODE_RE as _CODE_RE } from "@/lib/referral-client";

export const referralsEnabled = () => process.env.NEXT_PUBLIC_REFERRALS_ENABLED === "1";
const num = (v: string | undefined, d: number) => { const n = Number(v); return v !== undefined && v !== "" && Number.isFinite(n) && n >= 0 ? n : d; };
export const maxWaiveNgn = () => num(process.env.REFERRAL_MAX_WAIVE_NGN, 500);
export const maxReferralsPerPerson = () => Math.max(1, Math.floor(num(process.env.REFERRAL_MAX_PER_PERSON, 10)));

const ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"; // no 0/O/1/I
export { CODE_RE } from "@/lib/referral-client";
export function makeCode(bytes: (n: number) => Uint8Array = (n) => randomBytes(n)): string {
  const b = bytes(6);
  let s = ""; for (let i = 0; i < 6; i++) s += ALPHABET[b[i] % ALPHABET.length];
  return s;
}
export const cleanRef = (v: unknown): string | null => { const c = String(v ?? "").trim().toUpperCase(); return _CODE_RE.test(c) ? c : null; };

/** Statuses where the customer has really paid: the order counts as "a customer" and holds any credit it used. */
export const PAID_LIKE = ["paid", "fulfilled", "needs_review", "refund_failed"];

export async function getOrCreateCode(email: string): Promise<string> {
  const db = supabaseAdmin();
  const { data: ex } = await db.from("referral_codes").select("code").eq("email", email).maybeSingle();
  if (ex) return (ex as any).code;
  for (let i = 0; i < 5; i++) {
    const code = makeCode();
    const { error } = await db.from("referral_codes").insert({ code, email });
    if (!error) return code;
    const again = await db.from("referral_codes").select("code").eq("email", email).maybeSingle();
    if (again.data) return (again.data as any).code; // someone else made it a moment ago
  }
  throw new Error("could not make a referral code");
}

export type Plan =
  | { mode: "none"; fee: number; waived: 0 }
  | { mode: "referee"; fee: number; waived: number; code: string; referrerEmail: string; existingId: string | null }
  | { mode: "referrer"; fee: number; waived: number; referralId: string; previousOrderId: string | null };

const none = (fee: number): Plan => ({ mode: "none", fee, waived: 0 });

/** Decide the fee for this order. Read-only. `fee` is what to charge after any waiver. Any doubt means "no waiver". */
export async function planFeeWaiver(i: { email: string; ref?: string | null; feeNgn: number }): Promise<Plan> {
  const fee = Math.max(0, Math.round(Number(i.feeNgn) || 0));
  if (!referralsEnabled() || fee <= 0) return none(fee);
  try {
    const db = supabaseAdmin();
    const waive = Math.min(fee, maxWaiveNgn());
    if (waive <= 0) return none(fee);

    // 1. Credits earned by inviting people: a friend's order that was delivered, and a credit not already spent on a paid order.
    const { data: mine } = await db.from("referrals").select("*").eq("referrer_email", i.email);
    const mineRows = (mine ?? []) as any[];
    if (mineRows.length) {
      const ids = Array.from(new Set(mineRows.flatMap((r) => [r.referee_order_id, r.referrer_credit_order_id]).filter(Boolean)));
      const { data: ords } = ids.length ? await db.from("orders").select("id,status,is_test").in("id", ids) : { data: [] as any[] };
      const by = new Map(((ords ?? []) as any[]).map((o) => [o.id, o]));
      const earned = mineRows.find((r) => {
        const friend = by.get(r.referee_order_id);
        if (!friend || friend.is_test || friend.status !== "fulfilled") return false;
        const used = r.referrer_credit_order_id ? by.get(r.referrer_credit_order_id) : null;
        return !used || !PAID_LIKE.includes(used.status);
      });
      if (earned) return { mode: "referrer", fee: fee - waive, waived: waive, referralId: earned.id, previousOrderId: earned.referrer_credit_order_id ?? null };
    }

    // 2. A friend's invite on a first order.
    const code = cleanRef(i.ref);
    if (!code) return none(fee);
    const { data: owner } = await db.from("referral_codes").select("code,email").eq("code", code).maybeSingle();
    if (!owner || (owner as any).email === i.email) return none(fee);
    const referrerEmail = (owner as any).email as string;

    const { data: before } = await db.from("orders").select("id,status,is_test").eq("email", i.email).in("status", PAID_LIKE);
    if (((before ?? []) as any[]).some((o) => !o.is_test)) return none(fee); // already a customer
    const { data: prior } = await db.from("referrals").select("id,referee_order_id,code").eq("referee_email", i.email).maybeSingle();
    if (prior) {
      // They were invited before. Fine to retry while that first order has not been paid; never a second time.
      const p = prior as any;
      if (p.referee_order_id) {
        const { data: po } = await db.from("orders").select("status").eq("id", p.referee_order_id).maybeSingle();
        if (po && PAID_LIKE.includes((po as any).status)) return none(fee);
      }
      return { mode: "referee", fee: fee - waive, waived: waive, code: p.code, referrerEmail, existingId: p.id };
    }
    const { count } = await db.from("referrals").select("id", { count: "exact", head: true }).eq("referrer_email", referrerEmail);
    if ((count ?? 0) >= maxReferralsPerPerson()) return none(fee);
    return { mode: "referee", fee: fee - waive, waived: waive, code, referrerEmail, existingId: null };
  } catch (e) {
    console.error("[referral] plan failed (no waiver)", (e as any)?.message ?? e);
    return none(fee);
  }
}

/** Record that this order used the waiver. Called right after the order row exists. Never throws. */
export async function commitFeeWaiver(p: Plan, email: string, orderId: string): Promise<void> {
  if (p.mode === "none") return;
  try {
    const db = supabaseAdmin();
    if (p.mode === "referee") {
      if (p.existingId) await db.from("referrals").update({ referee_order_id: orderId, referee_waived_ngn: p.waived }).eq("id", p.existingId);
      else {
        const { error } = await db.from("referrals").insert({ code: p.code, referrer_email: p.referrerEmail, referee_email: email, referee_order_id: orderId, referee_waived_ngn: p.waived });
        if (error) console.error("[referral] could not record (fee already waived on this order)", error.message);
      }
      return;
    }
    const q = db.from("referrals").update({ referrer_credit_order_id: orderId, referrer_waived_ngn: p.waived }).eq("id", p.referralId);
    const { error } = await q;
    if (error) console.error("[referral] could not record credit use", error.message);
  } catch (e) { console.error("[referral] commit failed", (e as any)?.message ?? e); }
}
