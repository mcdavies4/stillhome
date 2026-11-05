// "Ask someone to pay": the list a person is building stays put, like a cart.
// It lives in this browser only (localStorage), survives a refresh or a closed tab, and goes away when they
// remove things, press Clear list, or make their link. Everything read back is checked, because browser
// storage can hold anything (old versions, edits, nothing at all).

import { PFM_MAX_ITEMS, PFM_NOTE_MAX } from "@/lib/payforme-shared";

export const DRAFT_KEY = "nolgic.pfm.draft.v1";
export const DRAFT_DAYS = 14;

export type DraftEntry = {
  billerCode: string; itemCode: string; billerName: string; itemName: string;
  identifier: string; identifierLabel: string; amount: number; name: string | null;
};
export type Draft = { name: string; email: string; note: string; list: DraftEntry[]; at: number };

const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");

export function sanitizeDraft(raw: unknown, now = Date.now()): Draft | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const at = Number(r.at);
  if (!Number.isFinite(at) || now - at > DRAFT_DAYS * 86400_000 || at > now + 86400_000) return null;
  const list: DraftEntry[] = [];
  if (Array.isArray(r.list)) {
    for (const e of r.list.slice(0, PFM_MAX_ITEMS)) {
      if (!e || typeof e !== "object") continue;
      const x = e as Record<string, unknown>;
      const amount = Number(x.amount);
      const entry: DraftEntry = {
        billerCode: str(x.billerCode, 80), itemCode: str(x.itemCode, 80), billerName: str(x.billerName, 120), itemName: str(x.itemName, 160),
        identifier: str(x.identifier, 24), identifierLabel: str(x.identifierLabel, 60) || "Account number", amount: Math.round(amount),
        name: typeof x.name === "string" && x.name ? x.name.slice(0, 120) : null,
      };
      if (!entry.billerCode || !entry.itemCode || !entry.billerName || !entry.identifier || !Number.isFinite(amount) || amount < 100) continue;
      list.push(entry);
    }
  }
  const d: Draft = { name: str(r.name, 60), email: str(r.email, 120), note: str(r.note, PFM_NOTE_MAX), list, at };
  return isEmptyDraft(d) ? null : d;
}

export const isEmptyDraft = (d: { name: string; email: string; note: string; list: unknown[] }) =>
  !d.list.length && !d.name.trim() && !d.email.trim() && !d.note.trim();

export function readDraft(): Draft | null {
  try { return sanitizeDraft(JSON.parse(localStorage.getItem(DRAFT_KEY) || "null")); } catch { return null; }
}

/** Saves the draft, or removes it when there is nothing left worth keeping. */
export function writeDraft(d: { name: string; email: string; note: string; list: DraftEntry[] }) {
  try {
    if (isEmptyDraft(d)) localStorage.removeItem(DRAFT_KEY);
    else localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...d, at: Date.now() }));
  } catch { /* private window or storage full: the page still works, it just won't remember */ }
}

export function clearDraft() { try { localStorage.removeItem(DRAFT_KEY); } catch { /* nothing to do */ } }
