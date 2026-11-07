// "Send to family on WhatsApp": a ready-written message built from the delivered order, opened with a plain
// wa.me link. No WhatsApp account, bot or API is involved: the customer's own WhatsApp sends it.

export type ShareOrder = {
  biller_name: string;
  identifier: string;
  identifier_label?: string | null;
  amount_ngn: number | string;
  flw_token?: string | null;
  customer_name?: string | null;
};

const naira = (n: number | string) => `₦${Math.round(Number(n)).toLocaleString("en-NG")}`;
const groupToken = (t: string) => (/^\d{16,24}$/.test(t) ? t.replace(/(\d{4})(?=\d)/g, "$1 ") : t);
const clean = (s: string) => s.replace(/\s+VTU$/i, "").trim();

export function shareKind(o: ShareOrder): "light" | "tv" | "airtime" | "data" | "other" {
  const t = `${o.biller_name} ${o.identifier_label ?? ""}`;
  if (o.flw_token || /ELECTRIC|DISCO|PREPAID|METER|POWER/i.test(t)) return "light";
  if (/DSTV|GOTV|STARTIMES|CABLE|SMARTCARD|IUC|DECODER/i.test(t)) return "tv";
  if (/DATA|BROADBAND|SURFLINE|BUNDLE/i.test(t)) return "data";
  if (/AIRTIME|VTU/i.test(t)) return "airtime";
  return "other";
}

// A gift: the buyer's own words go on top, and the receipt line speaks as the buyer ("I just paid…").
export type ShareGift = { from?: string; note?: string; to?: string };

export function shareMessage(o: ShareOrder, link = "nolgic.com", gift?: ShareGift | null): string {
  const amt = naira(o.amount_ngn);
  const name = clean(o.biller_name);
  const lines: string[] = [];
  const g = gift ? { from: (gift.from ?? "").trim(), note: (gift.note ?? "").trim(), to: (gift.to ?? "").trim() } : null;
  if (g) {
    const kind = shareKind(o);
    const what = kind === "light" ? `${amt} light` : kind === "tv" ? `${name} (${amt})` : kind === "data" ? `${name} data (${amt})` : kind === "airtime" ? `${amt} airtime` : `${name} (${amt})`;
    if (g.to) lines.push(`Hi ${g.to} 👋`);
    lines.push(`🎁 I just paid ${what} for you.`);
    if (g.note) lines.push(`"${g.note}"`);
    if (g.from) lines.push(`— ${g.from}`);
    lines.push("");
  }
  const start = lines.length;
  switch (shareKind(o)) {
    case "light":
      lines.push(`✅ ${amt} light has been paid for.`);
      lines.push(`Meter: ${o.identifier}`);
      if (o.flw_token) { lines.push(`Token: ${groupToken(o.flw_token)}`); lines.push("Enter the token on the meter to load the units."); }
      else lines.push("The token will reach you shortly.");
      break;
    case "tv":
      lines.push(`✅ ${name} has been paid: ${amt}.`);
      lines.push(`${o.identifier_label || "Smartcard"}: ${o.identifier}`);
      break;
    case "airtime":
      lines.push(`✅ ${amt} airtime sent to ${o.identifier}.`);
      break;
    case "data":
      lines.push(`✅ ${name} data sent to ${o.identifier} (${amt}).`);
      break;
    default:
      lines.push(`✅ ${name}: ${amt} paid.`);
      lines.push(`${o.identifier_label || "Number"}: ${o.identifier}`);
  }
  if (g && lines[start]?.startsWith("✅")) lines.splice(start, 1); // the 🎁 line above already says it
  if (g && lines.length === start && lines[start - 1] === "") lines.pop();
  lines.push("", g ? `Want to surprise someone too? ${link}` : `Paid with Nolgic · ${link}`);
  return lines.join("\n");
}

// With a number (digits, country code first) WhatsApp opens straight to that person; without, the sender picks who.
export const whatsappShareUrl = (text: string, to?: string | null) => `https://wa.me/${to && /^[1-9]\d{7,14}$/.test(to) ? to : ""}?text=${encodeURIComponent(text)}`;
