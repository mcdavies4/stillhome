// src/lib/paybeta-bulk.ts
// Paybeta Bulk Airtime API (https://docs.paybeta.ng/bulk-airtime-44874409e0).
//   POST /v2/bulk-airtime        {reference, description, recipients:[{biller, phone_number, amount, reference}]}
//   GET  /v2/bulk-airtime/{batch_id or reference}
// The batch reference is unique per account, so submitting is idempotent: a second submit of the same
// reference is rejected as a duplicate and the batch is simply read back instead.
//
// The docs don't spell out every field, so the parser is deliberately tolerant — but it never guesses:
// a recipient whose status we don't recognise is reported as "unknown" and the caller holds the batch for review.

import { pb } from "@/lib/paybeta";
import { FlwError } from "@/lib/flutterwave";
import type { Network } from "@/lib/bulk-shared";

export type PbRecipientState = "delivered" | "failed" | "pending" | "unknown";

export interface PbBulkRecipient {
  row: number | null;
  reference: string;
  phone: string;
  amount: number;
  state: PbRecipientState;
  raw: string;
  detail: string;
}

export interface PbBulk {
  found: boolean;
  batchId: string;
  status: string;
  recipients: PbBulkRecipient[];
  /** Summary counts from Paybeta (null when it didn't send them). */
  summary: { successful: number; pending: number; failed: number; queued: number; cancelled: number } | null;
  charged: number | null;
}

export function recipientState(raw: string): PbRecipientState {
  const s = raw.toLowerCase().trim();
  if (/^(delivered|successful|success|completed|complete)$/.test(s)) return "delivered";
  if (/^(failed|cancelled|canceled|reversed|refunded|declined|rejected|error)$/.test(s)) return "failed";
  if (/^(pending|queued|processing|initiated|submitted|in_progress|in-progress|awaiting)$/.test(s)) return "pending";
  return "unknown";
}

const n = (v: unknown): number => {
  const x = Number(v);
  return Number.isFinite(x) ? x : NaN;
};

function pickList(d: any): any[] | null {
  const c = [d?.recipients, d?.recipients?.data, d?.recipients?.items, d?.items, d?.transactions];
  for (const x of c) if (Array.isArray(x)) return x;
  return null;
}

/** Parse a batch body (works for both the submit response and the GET). Exported for tests. */
export function parseBulk(d: any): PbBulk | null {
  if (!d || typeof d !== "object") return null;
  const batchId = String(d.batch_id ?? d.batchId ?? d.id ?? "").trim();
  const list = pickList(d);
  if (!batchId && !list) return null;
  const s = d.summary && typeof d.summary === "object" ? d.summary : null;
  const summary = s
    ? {
        successful: n(s.successful ?? s.delivered ?? 0) || 0,
        pending: n(s.pending ?? 0) || 0,
        failed: n(s.failed ?? 0) || 0,
        queued: n(s.queued ?? 0) || 0,
        cancelled: n(s.cancelled ?? s.canceled ?? 0) || 0,
      }
    : null;
  const recipients: PbBulkRecipient[] = (list ?? []).map((r: any) => {
    const raw = String(r?.status ?? "");
    return {
      row: Number.isFinite(n(r?.row)) ? n(r.row) : null,
      reference: String(r?.reference ?? ""),
      phone: String(r?.phone_number ?? r?.phoneNumber ?? ""),
      amount: n(r?.amount),
      state: recipientState(raw),
      raw,
      detail: String(r?.response_description ?? r?.message ?? "").slice(0, 160),
    };
  });
  const charged = n(d.totals?.amount_charged ?? d.amount_charged ?? d.total_charge);
  return { found: true, batchId, status: String(d.status ?? "").toLowerCase(), recipients, summary, charged: Number.isFinite(charged) ? charged : null };
}

/** Read a batch by our reference (or Paybeta's BLK- id). found:false only on a clean 404; anything else unclear throws. */
export async function pbBulkGet(ref: string): Promise<PbBulk> {
  const r = await pb(`/v2/bulk-airtime/${encodeURIComponent(ref)}`, { timeoutMs: 25000 });
  if (r.http === 404) return { found: false, batchId: "", status: "", recipients: [], summary: null, charged: null };
  if (r.http < 200 || r.http >= 300 || r.unreadable) {
    throw new FlwError(`Paybeta bulk lookup unclear (HTTP ${r.http}${r.message ? `: ${r.message}` : ""})`, r.body);
  }
  const parsed = parseBulk(r.data);
  if (!parsed) throw new FlwError("Paybeta bulk lookup returned an unreadable batch", r.body);
  return parsed;
}

export type PbBulkSubmit =
  | { kind: "submitted"; batch: PbBulk }
  | { kind: "duplicate" } // already exists on Paybeta: read it back with pbBulkGet
  | { kind: "rejected"; message: string } // clean 4xx: nothing was bought, safe to refund
  | { kind: "unknown"; message: string }; // timeout / 5xx / garbled: outcome unknown, never refund on this

export async function pbBulkSubmit(p: {
  reference: string;
  description: string;
  recipients: { network: Network; phone: string; amount: number; reference: string }[];
}): Promise<PbBulkSubmit> {
  let r;
  try {
    r = await pb("/v2/bulk-airtime", {
      method: "POST",
      timeoutMs: 45000,
      body: {
        reference: p.reference,
        description: p.description.slice(0, 100),
        recipients: p.recipients.map((x) => ({ biller: x.network, phone_number: x.phone, amount: x.amount, reference: x.reference })),
      },
    });
  } catch (e: any) {
    return { kind: "unknown", message: String(e?.message ?? e) }; // timeout / network: may or may not have been received
  }
  if (r.http === 201 || (r.http >= 200 && r.http < 300 && !r.unreadable)) {
    const parsed = parseBulk(r.data);
    if (parsed && parsed.batchId) return { kind: "submitted", batch: parsed };
    return { kind: "unknown", message: `Paybeta answered HTTP ${r.http} without a batch id` };
  }
  if (r.http === 409 || /duplicate|already|exist|reference.*(used|taken)/i.test(r.message)) return { kind: "duplicate" };
  if (r.http >= 400 && r.http < 500) return { kind: "rejected", message: `HTTP ${r.http}${r.message ? `: ${r.message}` : ""}` };
  return { kind: "unknown", message: `HTTP ${r.http}${r.message ? `: ${r.message}` : ""}` };
}
