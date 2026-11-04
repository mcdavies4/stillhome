// The browser half of referrals: no server imports, safe to use in pages.
export const CODE_RE = /^[2-9A-HJ-NP-Z]{6}$/;
export const REF_KEY = "nolgic.ref.v1";
export const REF_TTL_MS = 30 * 86400_000;

export function parseRef(raw: string | null, now = Date.now()): string | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw);
    const code = String(o?.code ?? "").toUpperCase();
    const at = Number(o?.at);
    if (!CODE_RE.test(code) || !Number.isFinite(at) || now - at > REF_TTL_MS || at - now > 60_000) return null;
    return code;
  } catch { return null; }
}
export function readRef(): string | null {
  if (process.env.NEXT_PUBLIC_REFERRALS_ENABLED !== "1") return null;
  try { return parseRef(localStorage.getItem(REF_KEY)); } catch { return null; }
}
