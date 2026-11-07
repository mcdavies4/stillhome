// Giveaway links, kept on this device only:
//   * the giver's own links (so they can find their private page again), and
//   * for each link this browser joined, that person's own key (so they can see their delivery and token).
// Everything read back is checked, because browser storage can hold anything.

const MAKER_KEY = "nolgic.pfc.maker.v1";
const JOIN_KEY = "nolgic.pfc.join.v1";
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type PfcMine = { id: string; key: string; at: number; budget: number; people: number };

function read(k: string): unknown { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch { return null; } }
function write(k: string, v: unknown) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private window */ } }

export function readMyLinks(): PfcMine[] {
  const raw = read(MAKER_KEY);
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 10).flatMap((x: any) =>
    x && ID.test(String(x.id)) && ID.test(String(x.key))
      ? [{ id: String(x.id), key: String(x.key), at: Number(x.at) || 0, budget: Number(x.budget) || 0, people: Number(x.people) || 0 }]
      : []);
}
export function rememberMyLink(m: PfcMine) { write(MAKER_KEY, [m, ...readMyLinks().filter((x) => x.id !== m.id)].slice(0, 10)); }
export const myLinkKey = (id: string): string | null => readMyLinks().find((x) => x.id === id)?.key ?? null;

export function readJoined(): Record<string, string> {
  const raw = read(JOIN_KEY);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [id, k] of Object.entries(raw as Record<string, unknown>).slice(0, 30)) if (ID.test(id) && ID.test(String(k))) out[id] = String(k);
  return out;
}
export function rememberJoined(id: string, entryKey: string) { write(JOIN_KEY, { ...readJoined(), [id]: entryKey }); }
export const joinedKey = (id: string): string | null => readJoined()[id] ?? null;
export function forgetJoined(id: string) { const j = readJoined(); delete j[id]; write(JOIN_KEY, j); }
