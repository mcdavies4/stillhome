// src/lib/bulk.ts
// Bulk airtime, server side. One Flutterwave payment -> one Paybeta bulk batch -> per-number results ->
// a PARTIAL refund of only the numbers that failed.
//
// Life of a batch (bulk_orders.status):
//   pending_payment -> paid -> processing -> settling -> settled
//                         \-> (nothing could be bought) settled with everything refunded
//   needs_review   Nolgic can't tell what happened (never refunds on a guess; you get an email)
//   refund_failed  numbers failed but the Flutterwave refund didn't go through (you get an email)
//
// Safety rules (same spirit as single orders):
//   * money is only taken once: the payment is re-verified with Flutterwave and claimed atomically
//   * the Paybeta batch reference is unique, so submitting twice can never buy twice
//   * a refund is only ever issued for numbers Paybeta has FINALLY reported failed, or when Paybeta cleanly
//     rejected the whole batch. Timeouts, 5xx and unrecognised statuses never refund.
//   * every status change is an atomic claim, so a webhook and a page poll can't both settle (or both refund).

import { supabaseAdmin } from "@/lib/supabase";
import { alertFounder } from "@/lib/alerts";
import { billsTestMode } from "@/lib/bills";
import { pbBalance } from "@/lib/paybeta";
import { pbBulkGet, pbBulkSubmit, type PbBulk } from "@/lib/paybeta-bulk";
import { flwPayIsTestMode, refundTransaction, verifyById, verifyByReference, FlwPayError, type FlwTx } from "@/lib/flwpay";
import { sendBulkReceiptEmail } from "@/lib/bulk-email";
import { maskPhone, type BulkView, type Network } from "@/lib/bulk-shared";

export const bulkEnabled = () => process.env.BULK_ENABLED === "1";

export const bulkTxRef = (id: string) => `NLGFB-${id}`;
export const bulkIdFromTxRef = (ref: string): string | null => {
  const m = /^NLGFB-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(ref);
  return m ? m[1].toLowerCase() : null;
};
/** Our batch reference at Paybeta. 35 chars; can never be mistaken for a single-vend "PB<32hex>" reference. */
export const bulkPbReference = (id: string) => `PBB${id.replace(/-/g, "").toLowerCase()}`;
export const bulkRowRef = (batchRef: string, row: number) => `${batchRef}-${row}`;

const money = (v: number) => `₦${Math.round(v).toLocaleString("en-NG")}`;
const FINAL: string[] = ["settled", "refund_failed", "expired"];
const SUBMIT_GIVE_UP_MS = 30 * 60_000; // paid but Paybeta never confirmed receipt
const PROCESS_GIVE_UP_MS = 3 * 3600_000; // submitted but results still not final

const notFound = (e: unknown) => e instanceof FlwPayError && (e.http === 404 || /no transaction|not found/i.test(e.message));

type Row = Record<string, any>;

async function claim(id: string, from: string[], to: string, extra: Row = {}): Promise<Row | null> {
  const { data } = await supabaseAdmin()
    .from("bulk_orders")
    .update({ status: to, updated_at: new Date().toISOString(), ...extra })
    .eq("id", id)
    .in("status", from)
    .select("*")
    .maybeSingle();
  return (data as Row | null) ?? null;
}

async function recipientsOf(id: string): Promise<Row[]> {
  const { data } = await supabaseAdmin().from("bulk_recipients").select("*").eq("bulk_id", id).order("row_no");
  return (data as Row[]) ?? [];
}

// ───────────────────────── 1. payment ─────────────────────────

export type BulkConfirmState = "processed" | "unpaid" | "already" | "mismatch" | "skipped";

/** Called from the Flutterwave webhook AND the status page. Verifies the payment, claims the batch, submits it. */
export async function confirmBulkPayment(id: string, opts: { transactionId?: string | null } = {}): Promise<{ state: BulkConfirmState; note?: string }> {
  const db = supabaseAdmin();
  const { data: b } = await db.from("bulk_orders").select("*").eq("id", id).maybeSingle();
  if (!b) return { state: "skipped", note: "no such batch" };
  if (b.status !== "pending_payment") return { state: "already", note: b.status };

  const expectedRef = bulkTxRef(b.id);
  let tx: FlwTx;
  try {
    const txId = opts.transactionId ?? b.flw_pay_id ?? null;
    tx = txId ? await verifyById(txId) : await verifyByReference(expectedRef);
  } catch (e) {
    if (notFound(e)) return { state: "unpaid", note: "no transaction yet" };
    throw e;
  }
  if (tx.txRef !== expectedRef) {
    await alertFounder("⚠️ Bulk payment mismatch", `Bulk ${b.id}: transaction ${tx.id} has tx_ref "${tx.txRef}", expected "${expectedRef}". Not processed.`);
    return { state: "mismatch", note: "tx_ref mismatch" };
  }
  if (tx.status !== "successful") return { state: "unpaid", note: tx.status || "no status" };

  const expected = Number(b.amount_total) + Number(b.service_fee ?? 0);
  if (tx.currency !== "NGN" || !Number.isFinite(tx.amount) || Math.abs(tx.amount - expected) > 0.005) {
    await db.from("bulk_orders").update({ status: "needs_review", flw_pay_id: tx.id, updated_at: new Date().toISOString(), error: `PAYMENT MISMATCH: got ${tx.amount} ${tx.currency}, expected ${expected} NGN` }).eq("id", b.id).eq("status", "pending_payment");
    await alertFounder("🚨 Bulk amount mismatch — NOT vended", `Bulk ${b.id}\nPaid: ${tx.amount} ${tx.currency} (${tx.status})\nExpected: ${expected} NGN\nTransaction ${tx.id}. Check Flutterwave and refund if needed.`);
    return { state: "mismatch", note: "amount mismatch" };
  }
  if (flwPayIsTestMode() && !billsTestMode() && process.env.PAYSTACK_TEST_ALLOW_LIVE_VEND !== "1") {
    await db.from("bulk_orders").update({ status: "needs_review", flw_pay_id: tx.id, updated_at: new Date().toISOString(), error: "TEST payment on a LIVE bills provider — not vended" }).eq("id", b.id).eq("status", "pending_payment");
    await alertFounder("Bulk TEST payment — not vended", `Bulk ${b.id}: Flutterwave pay-in is in test mode but the bills provider is live, so nothing was bought.`);
    return { state: "skipped", note: "test payment, live bills" };
  }

  const claimed = await claim(b.id, ["pending_payment"], "paid", { flw_pay_id: tx.id, flw_pay_ref: expectedRef, paid_at: new Date().toISOString() });
  if (!claimed) return { state: "already", note: "claimed elsewhere" };

  await submitBatch(claimed);
  return { state: "processed" };
}

// ───────────────────────── 2. submit to Paybeta ─────────────────────────

/** Idempotent: safe to call from the webhook, the poll and the daily sweep. */
export async function submitBatch(b: Row): Promise<"processing" | "refunded" | "retry"> {
  const db = supabaseAdmin();
  const ref = b.pb_reference as string;

  const adopt = async (batch: PbBulk) => {
    await claim(b.id, ["paid"], "processing", { pb_batch_id: batch.batchId || null, pb_charged: batch.charged });
    return "processing" as const;
  };

  // Already on Paybeta (a previous attempt got through)? Then adopt it — never submit twice.
  try {
    const existing = await pbBulkGet(ref);
    if (existing.found) return adopt(existing);
  } catch {
    /* unclear: carry on to the wallet check and the (duplicate-safe) submit */
  }

  try {
    const bal = await pbBalance();
    if (bal < Number(b.amount_total)) {
      await alertFounder("🚨 Paybeta wallet too low for a bulk order — customer refunded", `Bulk ${b.id}: needs ${money(b.amount_total)}, wallet has ${money(bal)}. The customer's payment was refunded in full. Top up the wallet.`);
      await refundEverything(b, "Not enough provider balance to process this batch");
      return "refunded";
    }
  } catch {
    /* balance unreadable: Paybeta will reject by itself if the wallet is short */
  }

  const recs = await recipientsOf(b.id);
  const res = await pbBulkSubmit({
    reference: ref,
    description: `Nolgic bulk airtime ${b.id.slice(0, 8)}`,
    recipients: recs.map((r) => ({ network: r.network as Network, phone: r.phone, amount: Number(r.amount), reference: bulkRowRef(ref, r.row_no) })),
  });

  if (res.kind === "submitted") return adopt(res.batch);
  if (res.kind === "duplicate") {
    try {
      const again = await pbBulkGet(ref);
      if (again.found) return adopt(again);
    } catch { /* fall through to retry */ }
    return "retry";
  }
  if (res.kind === "rejected") {
    // A clean 4xx: Paybeta did not accept the batch, so nothing was bought.
    await alertFounder("Paybeta rejected a bulk batch — customer refunded", `Bulk ${b.id}: ${res.message}. The customer was refunded in full. If this is a key/IP/wallet problem, fix it before the next batch.`);
    await refundEverything(b, `Provider rejected the batch (${res.message})`);
    return "refunded";
  }
  // unknown: could have been received. Leave it 'paid'; the next poll re-checks by reference.
  console.error(`[bulk] submit outcome unknown for ${b.id}: ${res.message}`);
  await db.from("bulk_orders").update({ error: `submit unclear: ${res.message}`.slice(0, 300), updated_at: new Date().toISOString() }).eq("id", b.id).eq("status", "paid");
  return "retry";
}

// ───────────────────────── 3. refunds + settling ─────────────────────────

/** Nothing was bought: mark every number failed and refund the whole payment (fee included). */
async function refundEverything(b: Row, why: string): Promise<void> {
  const db = supabaseAdmin();
  const claimed = await claim(b.id, ["paid", "processing", "needs_review"], "settling");
  if (!claimed) return;
  await db.from("bulk_recipients").update({ status: "failed", detail: why.slice(0, 160) }).eq("bulk_id", b.id);
  const total = Number(b.amount_total) + Number(b.service_fee ?? 0);
  await doRefundAndFinish(claimed, total, 0, Number(b.recipients_count), why);
}

async function doRefundAndFinish(b: Row, refundNgn: number, delivered: number, failed: number, why: string): Promise<void> {
  const db = supabaseAdmin();
  const recs = await recipientsOf(b.id);
  const deliveredNgn = recs.filter((r) => r.status === "delivered").reduce((s, r) => s + Number(r.amount), 0);

  if (refundNgn > 0) {
    try {
      if (!b.flw_pay_id) throw new Error("no Flutterwave transaction id on file");
      // Full refund when nothing was delivered (omit the amount), partial otherwise.
      const full = Math.abs(refundNgn - (Number(b.amount_total) + Number(b.service_fee ?? 0))) < 0.005;
      await refundTransaction(b.flw_pay_id, full ? undefined : refundNgn);
    } catch (e: any) {
      await db.from("bulk_orders").update({
        status: "refund_failed", delivered_count: delivered, failed_count: failed, delivered_ngn: deliveredNgn,
        error: `REFUND FAILED (${money(refundNgn)}): ${e?.message ?? e}`.slice(0, 300), updated_at: new Date().toISOString(),
      }).eq("id", b.id);
      await alertFounder("🚨 BULK REFUND FAILED — manual action needed", `Bulk ${b.id}\nOwed to customer: ${money(refundNgn)} (${failed} number(s) failed). ${why}\nFlutterwave tx ${b.flw_pay_id}\nError: ${e?.message ?? e}\nRefund it in the Flutterwave dashboard, then set bulk_orders.status to 'settled' and refunded_ngn.`);
      return;
    }
  }

  const { data: done } = await db.from("bulk_orders").update({
    status: "settled", delivered_count: delivered, failed_count: failed, delivered_ngn: deliveredNgn,
    refunded_ngn: refundNgn, settled_at: new Date().toISOString(), updated_at: new Date().toISOString(), error: null,
  }).eq("id", b.id).select("*").maybeSingle();

  try { if (done) await sendBulkReceiptEmail(done as any); } catch (e) { console.error("[bulk] receipt failed", e); }
  if (failed > 0) {
    await alertFounder(
      failed === Number(b.recipients_count) ? "Bulk order: every number failed — customer refunded" : "Bulk order settled with failed numbers — customer partly refunded",
      `Bulk ${b.id}: ${delivered} delivered, ${failed} failed. Refunded ${money(refundNgn)} to the customer. ${why}\nCheck that Paybeta credited your wallet for the failed numbers.`
    );
  }
}

/** Apply Paybeta's per-number results to our rows. Returns the verdict for the whole batch. */
async function applyResults(b: Row, pbBatch: PbBulk): Promise<{ final: boolean; unknown: boolean; delivered: number; failed: number; failedNgn: number }> {
  const db = supabaseAdmin();
  const recs = await recipientsOf(b.id);
  const ref = b.pb_reference as string;
  const byRef = new Map(pbBatch.recipients.map((r) => [r.reference, r]));
  const byRow = new Map(pbBatch.recipients.filter((r) => r.row != null).map((r) => [r.row as number, r]));

  let delivered = 0, failed = 0, failedNgn = 0, pending = 0, unknown = 0, missing = 0;
  for (const r of recs) {
    const p = byRef.get(bulkRowRef(ref, r.row_no)) ?? byRow.get(r.row_no);
    if (!p) { missing++; continue; }
    if (p.state === "delivered") {
      delivered++;
      if (r.status !== "delivered") await db.from("bulk_recipients").update({ status: "delivered", detail: p.detail || null }).eq("id", r.id);
    } else if (p.state === "failed") {
      failed++; failedNgn += Number(r.amount);
      if (r.status !== "failed") await db.from("bulk_recipients").update({ status: "failed", detail: p.detail || p.raw || null }).eq("id", r.id);
    } else if (p.state === "pending") pending++;
    else unknown++;
  }
  const s = pbBatch.summary;
  const summaryBusy = !!s && s.pending + s.queued > 0;
  const final = pending === 0 && unknown === 0 && missing === 0 && !summaryBusy && delivered + failed === recs.length;
  return { final, unknown: unknown > 0 || (missing > 0 && pending === 0), delivered, failed, failedNgn };
}

/** Read the batch from Paybeta and, once every number is final, settle it. */
async function syncProcessing(b: Row): Promise<void> {
  const pbBatch = await pbBulkGet(b.pb_reference);
  if (!pbBatch.found) {
    // We think it was submitted but Paybeta has no record: never refund on that, ask a human.
    if (b.status === "processing") {
      const moved = await claim(b.id, ["processing"], "needs_review", { error: "Paybeta has no record of this batch" });
      if (moved) await alertFounder("🚨 Bulk batch not found at Paybeta", `Bulk ${b.id} (${b.pb_reference}) was submitted but Paybeta can't find it. Check the Paybeta console before refunding.`);
    }
    return;
  }
  if (pbBatch.charged != null && b.pb_charged == null) {
    await supabaseAdmin().from("bulk_orders").update({ pb_charged: pbBatch.charged }).eq("id", b.id);
  }
  const verdict = await applyResults(b, pbBatch);

  if (!verdict.final) {
    const age = Date.now() - new Date(b.paid_at ?? b.created_at).getTime();
    const stuck = verdict.unknown || age > PROCESS_GIVE_UP_MS;
    if (stuck && b.status === "processing") {
      const moved = await claim(b.id, ["processing"], "needs_review", { error: verdict.unknown ? "Paybeta returned a status Nolgic doesn't recognise" : "Results still not final after 3 hours" });
      if (moved) await alertFounder("Bulk batch needs a look", `Bulk ${b.id} (${b.pb_reference}, ${pbBatch.batchId}): ${verdict.unknown ? "a number has a status Nolgic doesn't understand" : "results are still not final after 3 hours"}. Nothing has been refunded. Check it in the Paybeta console.`);
    }
    return;
  }

  const claimed = await claim(b.id, ["processing", "needs_review"], "settling");
  if (!claimed) return; // someone else is settling it
  const total = Number(b.amount_total) + Number(b.service_fee ?? 0);
  // Everything failed -> refund the fee too. Otherwise refund only the failed numbers' airtime.
  const refund = verdict.delivered === 0 ? total : verdict.failedNgn;
  await doRefundAndFinish(claimed, refund, verdict.delivered, verdict.failed, verdict.delivered === 0 ? "All numbers failed." : "Some numbers failed.");
}

// ───────────────────────── 4. the one entry point the pages call ─────────────────────────

const lastSync = new Map<string, number>();

export async function syncBulk(id: string): Promise<void> {
  const last = lastSync.get(id) ?? 0;
  if (Date.now() - last < 4000) return;
  lastSync.set(id, Date.now());
  if (lastSync.size > 500) lastSync.clear();

  const db = supabaseAdmin();
  const { data: b } = await db.from("bulk_orders").select("*").eq("id", id).maybeSingle();
  if (!b) return;
  const age = Date.now() - new Date(b.paid_at ?? b.created_at).getTime();

  try {
    if (b.status === "pending_payment") {
      if (Date.now() - new Date(b.created_at).getTime() < 3 * 3600_000) await confirmBulkPayment(id);
    } else if (b.status === "paid") {
      const r = await submitBatch(b);
      if (r === "retry" && age > SUBMIT_GIVE_UP_MS) {
        const moved = await claim(b.id, ["paid"], "needs_review", { error: "Paid, but Paybeta never confirmed the batch" });
        if (moved) await alertFounder("🚨 Paid bulk batch not confirmed by Paybeta", `Bulk ${b.id} (${b.pb_reference}) was paid ${Math.round(age / 60000)} min ago but Paybeta never confirmed it. Nothing was refunded. Check the Paybeta console, then refund or resubmit by hand.`);
      }
    } else if (b.status === "processing" || b.status === "needs_review") {
      if (b.pb_batch_id || b.status === "processing") await syncProcessing(b);
    }
  } catch (e: any) {
    console.error("[bulk] sync failed", id, e?.message ?? e);
  }
}

/** Daily safety net (called by the reconcile cron): nudge every batch that isn't finished. */
export async function sweepBulk(): Promise<{ checked: number }> {
  const db = supabaseAdmin();
  const since = new Date(Date.now() - 7 * 86400_000).toISOString();
  const { data } = await db.from("bulk_orders").select("id,status").in("status", ["pending_payment", "paid", "processing", "needs_review"]).gte("created_at", since).limit(100);
  for (const r of data ?? []) {
    lastSync.delete(r.id);
    await syncBulk(r.id);
  }
  return { checked: (data ?? []).length };
}

export async function getBulkView(id: string): Promise<BulkView | null> {
  const db = supabaseAdmin();
  const { data: b } = await db.from("bulk_orders").select("*").eq("id", id).maybeSingle();
  if (!b) return null;
  const recs = await recipientsOf(id);
  return {
    id: b.id,
    status: b.status,
    count: b.recipients_count,
    amount_total: Number(b.amount_total),
    service_fee: Number(b.service_fee ?? 0),
    delivered: recs.filter((r) => r.status === "delivered").length,
    failed: recs.filter((r) => r.status === "failed").length,
    delivered_ngn: recs.filter((r) => r.status === "delivered").reduce((s, r) => s + Number(r.amount), 0),
    refunded_ngn: Number(b.refunded_ngn ?? 0),
    created_at: b.created_at,
    recipients: recs.map((r) => ({ row: r.row_no, network: r.network, phone: maskPhone(r.phone), amount: Number(r.amount), status: r.status })),
  };
}

export const bulkIsFinal = (s: string) => FINAL.includes(s);
