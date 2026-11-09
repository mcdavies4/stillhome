// The browser half of sales-rep links: no server imports, safe to use in pages.
// A rep link looks like https://nolgic.com/?rep=chika . The first rep who brings someone in is the one counted for 30 days
// (a later link from another rep does not take it over), and it is sent along when that person pays.
export const REP_RE = /^[a-z0-9]{3,20}$/;
export const REP_KEY = "nolgic.rep.v1";
export const REP_TTL_MS = 30 * 86400_000;

export const cleanRepCode = (v: unknown): string | null => { const c = String(v ?? "").trim().toLowerCase(); return REP_RE.test(c) ? c : null; };

export function parseRep(raw: string | null, now = Date.now()): { code: string; at: number } | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw);
    const code = cleanRepCode(o?.code);
    const at = Number(o?.at);
    if (!code || !Number.isFinite(at) || now - at > REP_TTL_MS || at - now > 60_000) return null;
    return { code, at };
  } catch { return null; }
}

/** Remember ?rep=code from this address, unless a different rep already has a live claim. Returns the code now on file. */
export function captureRep(search: string, store: Pick<Storage, "getItem" | "setItem">, now = Date.now()): string | null {
  const incoming = cleanRepCode(new URLSearchParams(search).get("rep"));
  let current: { code: string; at: number } | null = null;
  try { current = parseRep(store.getItem(REP_KEY), now); } catch { /* storage blocked */ }
  if (current) return current.code;                 // first rep stays counted while their claim is live
  if (!incoming) return null;
  try { store.setItem(REP_KEY, JSON.stringify({ code: incoming, at: now })); } catch { /* storage blocked: not remembered */ }
  return incoming;
}

export function readRep(): string | null {
  try { return parseRep(localStorage.getItem(REP_KEY))?.code ?? null; } catch { return null; }
}
