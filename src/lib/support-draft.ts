// src/lib/support-draft.ts
// Drafts a reply for the founder to review. Never sends anything: the draft is returned to the admin screen,
// and only a person pressing Send emails the customer.
//
// What the model sees: the last few messages of the thread, with email addresses, phone numbers and long
// digit runs (meter, smartcard, account numbers) replaced by placeholders. It never sees the customer's
// name, order tokens, PINs or payment details.

const MODEL = process.env.SUPPORT_DRAFT_MODEL ?? "claude-haiku-5-5";
const MAX_MESSAGES = 10;

export function scrub(text: string): string {
  return String(text ?? "")
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]")
    .replace(/(?:\+?234|0)[0-9]{9,10}/g, "[phone]")
    .replace(/\b\d{8,}\b/g, "[number]")
    .slice(0, 2000);
}

export const SYSTEM = [
  "You draft replies for Nolgic customer support. Nolgic sells naira bill payments (airtime, data, electricity, TV, exam PINs) in Nigeria.",
  "Write as Nolgic support: warm, plain English, short (under 80 words), no emojis, no headings.",
  "Never promise a refund, a delivery time or a token you cannot verify. If the customer reports a failed payment or missing token, say you are checking and will reply.",
  "Never ask for a password, PIN, card or bank details. Refer to the order page for the receipt and token.",
  "Output only the reply text, with no preamble.",
].join(" ");

export function buildPrompt(messages: { sender: string; body: string }[], page?: string | null): string {
  const recent = messages.slice(-MAX_MESSAGES).map((m) => `${m.sender === "agent" ? "Support" : "Customer"}: ${scrub(m.body)}`);
  return [
    page ? `The customer was on the page: ${scrub(page)}` : "",
    "Conversation so far:",
    ...recent,
    "",
    "Draft the next reply from Support.",
  ].filter(Boolean).join("\n");
}

export async function draftReply(messages: { sender: string; body: string }[], page?: string | null): Promise<string> {
  const key = (process.env.ANTHROPIC_API_KEY ?? "").trim();
  if (!key) throw new Error("AI drafts are not set up (ANTHROPIC_API_KEY is missing).");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 300,
      system: SYSTEM,
      messages: [{ role: "user", content: buildPrompt(messages, page) }],
    }),
  });
  if (!res.ok) throw new Error(`Draft service returned ${res.status}`);
  const data: any = await res.json();
  const text = (data?.content ?? []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("").trim();
  if (!text) throw new Error("No draft returned");
  return text;
}
