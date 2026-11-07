// Gifting: paying for someone else's light, airtime, data or TV, and telling them about it.
// Nothing here touches payments or our database. The gift message lives only in the buyer's own browser
// (like saved meters), is matched to the delivered order by meter/number, and is sent by the buyer's own WhatsApp.

export const GIFT_KEY = "nolgic.gift.v1";
export const GIFT_TTL_MS = 6 * 3600_000;
export const NOTE_MAX = 140;
export const NAME_MAX = 30;

export type Gift = {
  identifier: string; // the meter / smartcard / phone number the gift was paid for
  from: string;       // the buyer's first name, used as the sign-off
  note: string;       // a short personal message
  at: number;
};

// Strips control characters and angle brackets, collapses runs of spaces/newlines, caps the length.
export function cleanText(v: unknown, max: number): string {
  return String(v ?? "").replace(/[\u0000-\u001f\u007f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

// A meter or number as digits only, so "0803 123 4567" and "08031234567" match.
export const idKey = (v: unknown): string => String(v ?? "").replace(/\D/g, "");

export function parseGift(raw: unknown): Gift | null {
  let o: unknown = raw;
  if (typeof raw === "string") { try { o = JSON.parse(raw); } catch { return null; } }
  if (!o || typeof o !== "object") return null;
  const g = o as Record<string, unknown>;
  const identifier = cleanText(g.identifier, 40);
  const at = Number(g.at);
  if (!identifier || !Number.isFinite(at)) return null;
  return { identifier, from: cleanText(g.from, NAME_MAX), note: cleanText(g.note, NOTE_MAX), at };
}

/** The saved gift, only if it is recent and was paid for this same meter/number. */
export function matchGift(g: Gift | null, identifier: string, now = Date.now()): Gift | null {
  if (!g || !idKey(identifier)) return null;
  if (now - g.at > GIFT_TTL_MS || g.at > now + 60_000) return null;
  return idKey(g.identifier) === idKey(identifier) ? g : null;
}

export function rememberGift(g: Omit<Gift, "at">, now = Date.now()): void {
  try { localStorage.setItem(GIFT_KEY, JSON.stringify({ ...g, from: cleanText(g.from, NAME_MAX), note: cleanText(g.note, NOTE_MAX), at: now })); } catch { /* private mode: the gift still works, just without the saved message */ }
}

export function readGiftFor(identifier: string, now = Date.now()): Gift | null {
  try { return matchGift(parseGift(localStorage.getItem(GIFT_KEY)), identifier, now); } catch { return null; }
}

export function clearGift(): void {
  try { localStorage.removeItem(GIFT_KEY); } catch { /* nothing to clear */ }
}

// ── The four things people gift, and the words that go with each ──
export type GiftKey = "electricity" | "airtime" | "data" | "cable";

export const GIFTS: Record<GiftKey, { label: string; title: string; line: string; need: string }> = {
  electricity: { label: "Light", title: "Pay for their light", line: "Buy a prepaid token for their meter. The token comes to you, and you send it on.", need: "meter number" },
  airtime: { label: "Airtime", title: "Top up their phone", line: "Airtime lands on their number in seconds.", need: "phone number" },
  data: { label: "Data", title: "Send them data", line: "A data bundle straight to their phone.", need: "phone number" },
  cable: { label: "TV", title: "Keep their TV on", line: "Renew their DStv, GOtv or StarTimes. You see the name on the decoder first.", need: "smartcard number" },
};

export const isGiftKey = (k: unknown): k is GiftKey => typeof k === "string" && Object.prototype.hasOwnProperty.call(GIFTS, k);

// Preset messages, one tap to fill the box. They are written into the form by the page itself, never taken from a link.
export const OCCASIONS: { key: string; label: string; note: string }[] = [
  { key: "birthday", label: "Birthday", note: "Happy birthday! 🎂" },
  { key: "mum", label: "For Mum", note: "For you, Mum, with love ❤️" },
  { key: "thanks", label: "Thank you", note: "Thank you for everything 🙏" },
  { key: "month", label: "On me this month", note: "This month's on me 💡" },
];

// Giveaway messages: what the host says to each winner.
export const GIVEAWAY_NOTES = [
  { key: "won", label: "You won", note: "Congratulations, you won! 🎉" },
  { key: "thanks", label: "Thank you", note: "Thank you for being part of this 🙏" },
  { key: "birthday", label: "Birthday", note: "Happy birthday! 🎂" },
  { key: "season", label: "Season's greetings", note: "Happy holidays, from me to you 🎄" },
];

/**
 * The message that asks someone for the details a surprise needs. Warm, short, and clear that
 * Nolgic is only the shop: the gifter is the one writing.
 */
export function askDetailsMessage(kind: GiftKey, from = ""): string {
  const who = cleanText(from, NAME_MAX);
  const ask: Record<GiftKey, string> = {
    electricity: "Please send me your meter number and your electricity company (like Ikeja Electric or Eko Electric), and let me know if it's prepaid.",
    airtime: "Please send me the number you want topped up, and the network.",
    data: "Please send me the number you want the data on, and the network.",
    cable: "Please send me your smartcard (IUC) number and the package you're on.",
  };
  const lead: Record<GiftKey, string> = {
    electricity: "I'd like to sort your light 💡",
    airtime: "I'd like to top up your phone 📱",
    data: "I'd like to send you some data 📶",
    cable: "I'd like to renew your TV 📺",
  };
  const lines = [`Hi! ${lead[kind]}`, ask[kind], "Nothing for you to pay. I've got it."];
  if (who) lines.push(`— ${who}`);
  return lines.join("\n");
}

// Nigerian mobile numbers only: lets airtime and data gifts open WhatsApp straight to the person they went to.
export function waRecipient(identifier: string): string | null {
  const d = idKey(identifier);
  if (/^0[789][01]\d{8}$/.test(d)) return "234" + d.slice(1);
  if (/^234[789][01]\d{8}$/.test(d)) return d;
  return null;
}
