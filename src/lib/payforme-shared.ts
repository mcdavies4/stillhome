// src/lib/payforme-shared.ts
// Pay for Me: the parts the browser and the server both need. No secrets, no database.

export const payForMeEnabled = () => process.env.NEXT_PUBLIC_PAYFORME_ENABLED === "1";

export const PFM_MAX_ITEMS = 8;
export const PFM_NOTE_MAX = 160;
export const PFM_VALID_DAYS = 7;

export type PfmCategory = "electricity" | "cable" | "airtime" | "data";

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
  { key: "electricity", label: "Electricity", match: (b) => /ELECTRIC|DISCO|PREPAID METER|EKEDC|IKEDC|EEDC|AEDC|IBEDC|PHED|KEDCO|BEDC|JED|YEDC|ABUJA|ENUGU DISCO|KANO DISCO|KADUNA|ELECTRICITY COMPANY/i.test(b.biller_name + " " + b.name) },
  { key: "cable", label: "Cable TV", match: (b) => /DSTV|GOTV|STARTIMES|SHOWMAX/i.test(b.biller_name + " " + b.name) },
  { key: "airtime", label: "Airtime", match: (b) => b.is_airtime || /VTU|AIRTIME/i.test(b.biller_name + " " + b.name + " " + (b.short_name ?? "")) },
  { key: "data", label: "Data", match: (b) => /DATA|BROADBAND|SURFLINE|BUNDLE|POSTPAID PAYMENT/i.test(b.biller_name + " " + b.name) && !b.is_airtime },
];

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
    `You can see exactly what it is and pay by card here:`,
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
