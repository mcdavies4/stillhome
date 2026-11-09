// Browser-side bits for the account feature (kept out of page files: Next only allows page exports it knows).
export const ACCT_EMAIL_KEY = "nolgic.acct-email.v1";
export const ACCT_FLAG = "nolgic_acct_on";

export function readAcctEmail(): string {
  try { return window.localStorage.getItem(ACCT_EMAIL_KEY) ?? ""; } catch { return ""; }
}
/** True when this browser has a signed-in account (the flag cookie holds no secret; the server still checks the real session). */
export function acctSignedIn(): boolean {
  try { return document.cookie.split(/;\s*/).some((c) => c === `${ACCT_FLAG}=1`); } catch { return false; }
}
