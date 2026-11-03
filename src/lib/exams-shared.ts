// Exam PINs (JAMB / WAEC) — pure helpers shared by the server and the page. No secrets in here.
//
// Switches (both must be 1 for the page to open):
//   EXAMS_ENABLED=1               server side (checkout)
//   NEXT_PUBLIC_EXAMS_ENABLED=1   shows the page and the menu link
// Fee (naira): pct% of the PIN price, never below MIN, never above MAX. Paybeta pays a flat commission on exam PINs
// (JAMB: ₦150 through the API), so keep MIN above your payment-processing cost on the PIN.
//   NEXT_PUBLIC_EXAM_FEE_PCT (2)  NEXT_PUBLIC_EXAM_FEE_MIN (200)  NEXT_PUBLIC_EXAM_FEE_MAX (500)
// Biggest PIN order:  NEXT_PUBLIC_EXAM_MAX_ORDER (60000)

function num(v: string | undefined, d: number): number {
  const n = Number(v);
  return v !== undefined && v !== "" && Number.isFinite(n) && n >= 0 ? n : d;
}

export function examFeeSettings() {
  const pct = num(process.env.NEXT_PUBLIC_EXAM_FEE_PCT, 2);
  const min = num(process.env.NEXT_PUBLIC_EXAM_FEE_MIN, 200);
  const max = Math.max(min, num(process.env.NEXT_PUBLIC_EXAM_FEE_MAX, 500));
  return { pct, min, max };
}

export function examFee(price: number): number {
  const { pct, min, max } = examFeeSettings();
  const raw = Math.round((Number(price) * pct) / 100);
  return Math.min(max, Math.max(min, raw));
}

export const examMaxOrder = () => num(process.env.NEXT_PUBLIC_EXAM_MAX_ORDER, 60000);

/** What each service is called, and what the customer must type. Paybeta's own names are the fallback. */
export function examService(slug: string, paybetaName?: string): { title: string; idLabel: string; idHint: string; idPattern: RegExp; idError: string } {
  if (/^jamb/i.test(slug)) {
    return {
      title: "JAMB PIN",
      idLabel: "JAMB profile code",
      idHint: "The profile code the candidate got when they registered with their phone number. A wrong code means a PIN that can't be used, so check it twice.",
      idPattern: /^[A-Za-z0-9]{6,15}$/,
      idError: "Enter the profile code with letters and numbers only, no spaces.",
    };
  }
  const phone = {
    idLabel: "Phone number",
    idHint: "The Nigerian mobile number this PIN is for.",
    idPattern: /^\d{10,14}$/,
    idError: "Enter the phone number with digits only, no spaces.",
  };
  if (/^waec/i.test(slug)) return { title: "WAEC PIN", ...phone }; // one service: result checker + registration token
  if (/^neco/i.test(slug)) return { title: "NECO PIN", ...phone };
  return { title: paybetaName || slug.toUpperCase(), ...phone };
}

export function examIdOk(slug: string, id: string): boolean {
  return examService(slug).idPattern.test(id);
}

/** A stored PIN ("PIN: 123 · Serial: 456") split into labelled lines for display. */
export function splitPins(token: string | null | undefined): { label: string; value: string }[] {
  if (!token) return [];
  return token
    .split(" · ")
    .map((part) => {
      const m = /^\s*(PIN|Serial)\s*:\s*(.+)$/i.exec(part);
      return m ? { label: m[1].toUpperCase() === "PIN" ? "PIN" : "Serial number", value: m[2].trim() } : { label: "PIN", value: part.trim() };
    })
    .filter((x) => x.value);
}

export const isExamBiller = (billerName: string | null | undefined) => /\b(JAMB|WAEC|NECO|NABTEB)\b/i.test(billerName ?? "");
