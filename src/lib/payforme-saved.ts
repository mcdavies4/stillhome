// The requests and giveaways this browser made, so the person can get back to their own page (and their tokens).
// Kept only on this device. A giveaway also keeps its message and each winner's name here, never on our servers.

export const PFM_SAVED_KEY = "nolgic.pfm.v1";
export type PfmSaved = {
  id: string; key: string; name: string; total: number; at: number;
  give?: boolean;      // made on /giveaway: its maker pays it, and sends each winner their delivery
  note?: string;       // the message that goes with each winner's WhatsApp
  email?: string;      // the maker's email, so paying again needs no retyping
  names?: string[];    // winner names, in the same order as the items
};

const t = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f<>]/g, " ").trim().slice(0, max) : "");

export function parseSaved(raw: unknown): PfmSaved[] {
  if (!Array.isArray(raw)) return [];
  const out: PfmSaved[] = [];
  for (const x of raw.slice(0, 10)) {
    if (!x || typeof x !== "object") continue;
    const o = x as Record<string, unknown>;
    const id = t(o.id, 40), key = t(o.key, 40);
    if (!id || !key) continue;
    const s: PfmSaved = { id, key, name: t(o.name, 60), total: Number(o.total) || 0, at: Number(o.at) || 0 };
    if (o.give === true) {
      s.give = true; s.note = t(o.note, 160); s.email = t(o.email, 120);
      s.names = Array.isArray(o.names) ? o.names.slice(0, 15).map((n) => t(n, 30)) : [];
    }
    out.push(s);
  }
  return out;
}

export const readPfmSaved = (): PfmSaved[] => { try { return parseSaved(JSON.parse(localStorage.getItem(PFM_SAVED_KEY) || "[]")); } catch { return []; } };
export const writePfmSaved = (s: PfmSaved[]) => { try { localStorage.setItem(PFM_SAVED_KEY, JSON.stringify(s.slice(0, 10))); } catch { /* private window */ } };
export const findPfmSaved = (id: string): PfmSaved | null => readPfmSaved().find((s) => s.id === id) ?? null;
