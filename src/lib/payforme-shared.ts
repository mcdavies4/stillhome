// src/lib/payforme-shared.ts
// Pay for Me: the parts the browser and the server both need. No secrets, no database.

import { notPower } from "@/lib/not-power";
import { examFee } from "@/lib/exams-shared";
import { feeKindOf, ngnServiceFee } from "@/lib/ngn-fee";

export const payForMeEnabled = () => process.env.NEXT_PUBLIC_PAYFORME_ENABLED === "1";

export const PFM_MAX_ITEMS = 8;
export const GIVEAWAY_MAX_ITEMS = 15; // a giveaway is one payment for many people, so it may be longer than an ask
export const PFM_NOTE_MAX = 160;
export const PFM_VALID_DAYS = 7;

export type PfmCategory = "electricity" | "cable" | "airtime" | "data" | "exam";

/** JAMB / WAEC / NECO / NABTEB PIN services (the same rule as the bills provider uses). */
export const pfmIsExam = (billerCode: string | null | undefined) => /^(jamb|waec|neco|nabteb)([_-]|$)/i.test(String(billerCode ?? ""));

/** The service fee for one item: exam PINs have their own fee, everything else the normal per-kind fee. */
export function pfmItemFee(i: { biller_code: string; item_code?: string; biller_name?: string; name?: string }, amount: number): number {
  return pfmIsExam(i.biller_code) ? examFee(amount) : ngnServiceFee(amount, feeKindOf(i as any));
}

export type PfmBiller = {
  biller_code: string;
  item_code: string;
  name: string;
  biller_name: string;
  short_name: string;
  amount: number;
  is_airtime: boolean;
  label_name: string;
};

/** The same four groups as the home page. */
export const PFM_TABS: { key: PfmCategory; label: string; match: (b: PfmBiller) => boolean }[] = [
  { key: "electricity", label: "Electricity", match: (b) => !pfmIsExam(b.biller_code) && !notPower(b.biller_name + " " + b.name) && /ELECTRIC|DISCO|PREPAID METER|EKEDC|IKEDC|EEDC|AEDC|IBEDC|PHED|KEDCO|BEDC|JED|YEDC|ABUJA|ENUGU DISCO|KANO DISCO|KADUNA|ELECTRICITY COMPANY/i.test(b.biller_name + " " + b.name) },
  { key: "cable", label: "Cable TV", match: (b) => !pfmIsExam(b.biller_code) && /DSTV|GOTV|STARTIMES|SHOWMAX/i.test(b.biller_name + " " + b.name) && !/ELECTRIC/i.test(b.biller_name + " " + b.name) },
  { key: "airtime", label: "Airtime", match: (b) => !pfmIsExam(b.biller_code) && (b.is_airtime || /VTU|AIRTIME/i.test(b.biller_name + " " + b.name + " " + (b.short_name ?? ""))) },
  { key: "data", label: "Data", match: (b) => !pfmIsExam(b.biller_code) && /DATA|BROADBAND|SURFLINE|BUNDLE|POSTPAID PAYMENT/i.test(b.biller_name + " " + b.name) && !b.is_airtime },
  // Exam PINs are not in the bills list; the pages add them from /api/exams (biller_code = the exam service).
  { key: "exam", label: "Exam PINs", match: (b) => pfmIsExam(b.biller_code) },
];

/** An exam group from /api/exams, shaped like a bill so the same picker can show it. */
export function examAsBillers(groups: { service: string; title: string; idLabel: string; items: { code: string; name: string; price: number }[] }[]): PfmBiller[] {
  return groups.flatMap((g) => g.items.map((i) => ({
    biller_code: g.service, item_code: i.code, name: i.name,
    biller_name: /\b(JAMB|WAEC|NECO|NABTEB)\b/i.test(i.name) ? i.name : `${g.title} — ${i.name}`,
    short_name: i.code, amount: i.price, is_airtime: false, label_name: g.idLabel,
  })));
}

/** Airtime, data and broadband have no name lookup: the phone number IS the account. */
export const pfmNoValidate = (i: { is_airtime?: boolean | null; biller_name?: string | null; name?: string | null; item_code?: string | null } | null | undefined) =>
  !!i && (!!i.is_airtime || /VTU|AIRTIME|DATA|BROADBAND|SURFLINE|POSTPAID PAYMENT/i.test(`${i.biller_name ?? ""} ${i.name ?? ""} ${i.item_code ?? ""}`));

/** "Ikeja Electric" + "Ikeja Electric — Prepaid" -> "Ikeja Electric · Prepaid" (no repeating the provider's name). */
export function pfmTitle(billerName: string, itemName?: string | null): string {
  const b = String(billerName ?? "").replace(/\s+VTU$/i, "").trim();
  const i = String(itemName ?? "").replace(/\s+VTU$/i, "").trim();
  if (!i || i.toLowerCase() === b.toLowerCase()) return b;
  if (i.toLowerCase().startsWith(b.toLowerCase())) {
    const rest = i.slice(b.length).replace(/^[\s\u2014\u2013\-:\u00b7]+/, "").trim();
    return rest ? `${b} \u00b7 ${rest}` : b;
  }
  return `${b} \u00b7 ${i}`;
}

/** "08031234567" -> "0803 ••• 4567". Meters keep the last four digits. */
export function maskIdentifier(id: string): string {
  const s = String(id ?? "").replace(/\s+/g, "");
  if (s.length <= 4) return s;
  const head = s.length >= 10 ? s.slice(0, 4) + " " : "";
  return `${head}••• ${s.slice(-4)}`;
}

export type PfmItemState = "waiting" | "working" | "delivered" | "refunded" | "checking";
export type PfmUiStatus = "open" | "paying" | "working" | "done" | "cancelled" | "expired" | "checking";

export type PfmItemView = {
  n: number;
  billerName: string;
  itemName: string | null;
  identifier: string;        // masked
  label: string;
  customerName: string | null;
  amount: number;
  fee: number;
  state: PfmItemState;
  token: string | null;      // only ever filled for the owner (the person who made the request)
  orderId: string | null;    // only for the owner
};

export type PfmView = {
  id: string;
  receiverName: string;
  note: string | null;
  status: PfmUiStatus;
  expiresAt: string;
  amount: number;
  fee: number;
  total: number;
  refunded: number;          // naira already sent back for items that could not be delivered
  items: PfmItemView[];
  owner: boolean;
  canCancel: boolean;
  payerFirstName: string | null;
};

const money = (n: number) => `₦${Math.round(Number(n)).toLocaleString("en-NG")}`;
export { money as pfmMoney };

/** The WhatsApp message the person asking sends to the one who will pay. */
export function requestShareText(p: { receiverName: string; total: number; count: number; link: string; note?: string | null }): string {
  const what = p.count === 1 ? "1 thing" : `${p.count} things`;
  return [
    `Hi, it's ${p.receiverName}. Please help me pay for ${what} (${money(p.total)} in all) on Nolgic.`,
    p.note ? `"${p.note}"` : "",
    `You can see exactly what it is and pay here:`,
    p.link,
  ].filter(Boolean).join("\n");
}

export const waShareUrl = (text: string) => `https://wa.me/?text=${encodeURIComponent(text)}`;

/** The message the owner can forward to whoever needs a token. */
export function tokenShareText(i: { billerName: string; identifier: string; token: string | null; customerName?: string | null }): string {
  return i.token
    ? `${i.billerName}${i.customerName ? ` (${i.customerName})` : ""}\nMeter: ${i.identifier}\nToken: ${i.token}`
    : `${i.billerName} for ${i.identifier} has been paid.`;
}

/** Map a normal order's status onto what a person sees. */
export function itemStateOf(orderStatus: string | null | undefined): PfmItemState {
  switch (orderStatus) {
    case "fulfilled": return "delivered";
    case "failed_refunded": return "refunded";
    case "needs_review":
    case "refund_failed": return "checking";
    case "paid": return "working";
    default: return "waiting";
  }
}

/** Reference formats. Paystack and Flutterwave each get their own prefix so a payment can never be mistaken for another product's. */
export const pfmRef = (rail: "paystack" | "flutterwave", requestId: string, attempt: number) =>
  `${rail === "flutterwave" ? "NLGFP" : "NLGP"}-${requestId}-${attempt}`;

export function parsePfmRef(ref: string): { rail: "paystack" | "flutterwave"; requestId: string; attempt: number } | null {
  const m = /^(NLGFP|NLGP)-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-(\d{1,3})$/i.exec(String(ref ?? ""));
  if (!m) return null;
  return { rail: m[1].toUpperCase() === "NLGFP" ? "flutterwave" : "paystack", requestId: m[2].toLowerCase(), attempt: Number(m[3]) };
}

// ───────────────────────── Giveaway links ("let them choose") ─────────────────────────
// The giver shares one link; each person picks their own bill and enters their own number; the giver reviews the
// list and pays for everyone at once. Nothing is paid until the giver closes the link.

export const PFC_MAX_PEOPLE = GIVEAWAY_MAX_ITEMS;   // a closed link becomes one giveaway, so the same cap applies
export const PFC_VALID_DAYS = PFM_VALID_DAYS;
/** How long a giveaway link may stay open. Nothing is paid until the giver closes the list, so a longer window holds no money. */
export const PFC_DAY_CHOICES = [7, 14, 30];
export const PFC_BUDGETS = [1000, 2000, 5000, 10000];
export const PFC_CATEGORIES: PfmCategory[] = ["electricity", "cable", "airtime", "data", "exam"];
export const PFC_CATEGORY_LABEL: Record<PfmCategory, string> = { electricity: "light", cable: "TV", airtime: "airtime", data: "data", exam: "an exam PIN" };

/** Which of the four groups a bill belongs to, using the same rules as the tabs. */
export function pfmCategoryOf(b: Pick<PfmBiller, "biller_name" | "name"> & Partial<PfmBiller>): PfmCategory | null {
  const x: PfmBiller = { biller_code: "", item_code: "", short_name: "", amount: 0, is_airtime: false, label_name: "", ...b } as PfmBiller;
  return PFM_TABS.find((t) => t.match(x))?.key ?? null;
}

/** "light, airtime or TV" */
export function pfcChoiceText(cats: PfmCategory[]): string {
  const w = PFC_CATEGORIES.filter((c) => cats.includes(c)).map((c) => PFC_CATEGORY_LABEL[c]);
  return w.length <= 1 ? (w[0] ?? "") : `${w.slice(0, -1).join(", ")} or ${w[w.length - 1]}`;
}

export type PfcStatus = "open" | "full" | "closed" | "cancelled" | "expired";
export type PfcEntryState = "joined" | "waiting_payment" | PfmItemState | "not_paid" | "removed";

/** One person on the giver's own page. */
export type PfcEntryView = {
  id: string; who: string; whatsapp: string | null; category: PfmCategory | null;
  billerName: string; itemName: string | null; identifier: string; label: string; customerName: string | null;
  amount: number; fee: number; at: string;
};

export type PfcView = {
  id: string;
  makerName: string;
  note: string | null;
  budget: number;
  categories: PfmCategory[];
  maxPeople: number;
  count: number;              // people in so far (everyone may see the number, never the names)
  status: PfcStatus;
  expiresAt: string;
  // only for the giver (?k=)
  owner: boolean;
  entries?: PfcEntryView[];
  amount?: number;
  fee?: number;
  requestId?: string | null;
  requestKey?: string | null;
  makerEmail?: string;
  // only for a person who joined (?e=)
  mine?: { who: string; billerName: string; itemName: string | null; identifier: string; label: string; customerName: string | null; amount: number; state: PfcEntryState; token: string | null; wantsToken: boolean } | null;
};

/** The WhatsApp message the giver sends with the link. */
export function pfcShareText(p: { makerName: string; budget: number; categories: PfmCategory[]; link: string; note?: string | null; until?: string | null }): string {
  return [
    `${p.makerName} is giving away up to ${money(p.budget)} of ${pfcChoiceText(p.categories)} on Nolgic 🎁`,
    p.note ? `"${p.note}"` : "",
    `Open the link, choose what you want and enter your number. Nothing for you to pay:`,
    p.link,
    p.until ? `Open until ${p.until}.` : "",
  ].filter(Boolean).join("\n");
}
