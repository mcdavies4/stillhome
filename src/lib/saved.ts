// Saved meters, smartcards and numbers. Kept ONLY in the customer's own browser (localStorage), never on our servers:
// a meter number plus its owner's name is personal data, and this way nothing new has to be stored or protected.
// The list never skips the name check: tapping a saved item fills the form, then the account name is looked up again.

export type Saved = {
  id: string;
  nickname: string;        // "Mum's light"
  tab: string;             // electricity | cable | airtime | data
  billerCode: string;
  billerName: string;      // as the catalogue names it, e.g. "IKEJA ELECTRIC"
  itemCode: string;
  itemKey: string;         // the form's own key for the plan/item, so the exact plan can be re-selected
  itemName: string;        // "Prepaid", "DStv Padi"…
  identifier: string;      // meter, smartcard or phone number
  label: string;           // "Meter number", "Smartcard number"…
  ownerName: string | null; // the name the provider returned when it was last checked
  at: number;              // last used
};

/** What the pay form remembers between "Pay" and the delivered page, so the page can offer to save it. */
export type Candidate = Omit<Saved, "id" | "nickname" | "at"> & { at: number };

export const SAVED_KEY = "nolgic.saved.v1";
export const CANDIDATE_KEY = "nolgic.save-candidate.v1";
export const MAX_SAVED = 20;
export const CANDIDATE_TTL_MS = 3 * 3600_000;

const clean = (v: unknown, max: number) => String(v ?? "").replace(/[\u0000-\u001f\u007f<>]/g, "").trim().slice(0, max);

/** Accepts only well-formed entries, so a corrupted or hand-edited list can never break the form. */
export function parseSaved(raw: unknown): Saved[] {
  let arr: unknown = raw;
  if (typeof raw === "string") { try { arr = JSON.parse(raw); } catch { return []; } }
  if (!Array.isArray(arr)) return [];
  const out: Saved[] = [];
  for (const x of arr) {
    if (!x || typeof x !== "object") continue;
    const o = x as Record<string, unknown>;
    const identifier = clean(o.identifier, 32), billerCode = clean(o.billerCode, 60), itemCode = clean(o.itemCode, 60), id = clean(o.id, 40);
    if (!identifier || !billerCode || !itemCode || !id) continue;
    out.push({
      id, nickname: clean(o.nickname, 24) || "Saved", tab: clean(o.tab, 20), billerCode, billerName: clean(o.billerName, 80), itemCode,
      itemKey: clean(o.itemKey, 200), itemName: clean(o.itemName, 80), identifier, label: clean(o.label, 40) || "Number",
      ownerName: o.ownerName ? clean(o.ownerName, 80) : null, at: Number(o.at) || 0,
    });
    if (out.length >= MAX_SAVED) break;
  }
  return out.sort((a, b) => b.at - a.at);
}

const sameThing = (a: { billerCode: string; itemCode: string; identifier: string }, b: { billerCode: string; itemCode: string; identifier: string }) =>
  a.billerCode === b.billerCode && a.itemCode === b.itemCode && a.identifier === b.identifier;

export const isSaved = (list: Saved[], c: { billerCode: string; itemCode: string; identifier: string }) => list.some((s) => sameThing(s, c));

/** Adds (or renames, if it is already there). Never more than MAX_SAVED: the least recently used is dropped. */
export function addSaved(list: Saved[], c: Candidate, nickname: string, now = Date.now(), newId: () => string = () => Math.random().toString(36).slice(2, 10) + now.toString(36)): Saved[] {
  const nick = clean(nickname, 24) || clean(c.ownerName, 24) || clean(c.billerName, 24) || "Saved";
  const existing = list.find((s) => sameThing(s, c));
  const next = existing
    ? list.map((s) => (s === existing ? { ...s, ...c, id: s.id, nickname: nick, at: now } : s))
    : [{ ...c, id: newId(), nickname: nick, at: now }, ...list];
  return next.sort((a, b) => b.at - a.at).slice(0, MAX_SAVED);
}

export const removeSaved = (list: Saved[], id: string) => list.filter((s) => s.id !== id);

/** Moves a used item to the front, so the ones people really use stay at the top. */
export const touchSaved = (list: Saved[], id: string, now = Date.now()) =>
  list.map((s) => (s.id === id ? { ...s, at: now } : s)).sort((a, b) => b.at - a.at);

/** "…4301" — enough to tell two meters apart on screen without showing the whole number. */
export const tail = (identifier: string, n = 4) => (identifier.length > n ? `…${identifier.slice(-n)}` : identifier);

export function parseCandidate(raw: unknown, now = Date.now()): Candidate | null {
  let o: any = raw;
  if (typeof raw === "string") { try { o = JSON.parse(raw); } catch { return null; } }
  if (!o || typeof o !== "object") return null;
  const at = Number(o.at);
  if (!Number.isFinite(at) || now - at > CANDIDATE_TTL_MS || at - now > 60_000) return null;
  const [s] = parseSaved([{ ...o, id: "c", nickname: "c" }]);
  if (!s) return null;
  const { id: _i, nickname: _n, ...rest } = s;
  return { ...rest, at };
}

// ───────── browser storage (every call guarded: private windows and blocked storage must never break the page) ─────────
export function readSaved(): Saved[] {
  try { return parseSaved(window.localStorage.getItem(SAVED_KEY)); } catch { return []; }
}
export function writeSaved(list: Saved[]): boolean {
  try { window.localStorage.setItem(SAVED_KEY, JSON.stringify(list.slice(0, MAX_SAVED))); return true; } catch { return false; }
}
export function rememberCandidate(c: Candidate) {
  try { window.localStorage.setItem(CANDIDATE_KEY, JSON.stringify(c)); } catch { /* ignore */ }
}
export function readCandidate(): Candidate | null {
  try { return parseCandidate(window.localStorage.getItem(CANDIDATE_KEY)); } catch { return null; }
}
export function clearCandidate() {
  try { window.localStorage.removeItem(CANDIDATE_KEY); } catch { /* ignore */ }
}
