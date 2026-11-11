// src/lib/paylink.ts
// "Bills link": one standing link per person (nolgic.com/for/ada). Whoever opens it picks what to pay and an amount and
// pays in naira. Underneath, every payment is an ordinary Pay for Me request (src/lib/payforme.ts), so the provider
// checks, the fee, the payment verification, delivery, receipts and refunds are exactly the ones that already exist.
// This file only adds: the standing link itself, a public view that hides the private parts, and the guard rails.

import { randomInt } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase";
import { validateCustomer, checkPurchase } from "@/lib/bills";
import { getCountry } from "@/lib/countries";
import { cap, normaliseEmail, safeEqual, UUID_RE } from "@/lib/security";
import { ngnMaxOrder } from "@/lib/ngn-fee";
import { cleanText } from "@/lib/gift";
import { createPayRequest, cancelPayRequest, startPayRequestPayment, isMissingSchema, payForMeReady } from "@/lib/payforme";
import { maskIdentifier, pfmCategoryOf, pfmIsExam, pfmMoney, pfmNoValidate, pfmTitle, type PfmCategory } from "@/lib/payforme-shared";

const db = () => supabaseAdmin();
export const LINK_MAX_ITEMS = 3;
export const LINK_MAX_PER_OWNER = 3;
export const LINK_NAME_MAX = 40;
export const LINK_NOTE_MAX = 100;
const LABEL_MAX = 24;
const OPEN_PER_HOUR = 6;          // payments started on one link in an hour that nobody has finished
const RESERVED = new Set(["new", "admin", "api", "manage", "ask", "giveaway", "exams", "bulk", "account", "proof", "r", "c", "for", "pay", "help", "support", "nolgic", "telegram", "terms", "privacy"]);

export type Fail = { ok: false; status: number; error: string };
const NOT_READY = "Bills links aren't open yet. Please check back soon.";

let readyCache: { ok: boolean; at: number } | null = null;
export const forgetPayLinkReady = () => { readyCache = null; };
/** Pay for Me must be set up, and so must the bills-link tables (0031). Cached for a few minutes. */
export async function payLinkReady(): Promise<boolean> {
  if (readyCache && Date.now() - readyCache.at < (readyCache.ok ? 5 * 60_000 : 15_000)) return readyCache.ok;
  let ok = false;
  try {
    const [pfm, a, b, c] = await Promise.all([
      payForMeReady(),
      db().from("pay_links").select("id").limit(1),
      db().from("pay_link_items").select("id").limit(1),
      db().from("pay_requests").select("link_id").limit(1),
    ]);
    ok = pfm && !a.error && !b.error && !c.error;
    if (!ok) console.error("[paylink] NOT READY: run supabase/migrations/0031_bills_link.sql in the Supabase SQL editor.", a.error?.message ?? "", c.error?.message ?? "");
  } catch (e: any) {
    console.error("[paylink] readiness check failed", e?.message ?? e);
  }
  readyCache = { ok, at: Date.now() };
  return ok;
}

// ───────────────────────── names and slugs ─────────────────────────

const ALPHA = "abcdefghjkmnpqrstuvwxyz23456789";
const rand = (n: number) => Array.from({ length: n }, () => ALPHA[randomInt(ALPHA.length)]).join("");

/** "Mummy Ada!" -> "mummy-ada". 3 to 24 characters, letters, digits and single hyphens. */
export function slugBase(name: string): string {
  const s = String(name ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24).replace(/-+$/g, "");
  return s.length >= 3 ? s : `${s}${s ? "-" : ""}${rand(3)}`;
}
export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,30})[a-z0-9]$/;

async function freeSlug(name: string): Promise<string> {
  const base = slugBase(name);
  for (let i = 0; i < 8; i++) {
    const s = i === 0 ? base : `${base.slice(0, 20)}-${rand(3)}`;
    if (RESERVED.has(s)) continue;
    const { data } = await db().from("pay_links").select("id").eq("slug", s).maybeSingle();
    if (!data) return s;
  }
  return `${base.slice(0, 18)}-${rand(6)}`;
}

// ───────────────────────── making a link ─────────────────────────

export type LinkItemIn = { billerCode: string; itemCode: string; billerName: string; itemName?: string; identifier: string; identifierLabel?: string; label?: string; amount?: number | null };

export async function createPayLink(raw: any, opts: { ownerChat?: number | null } = {}): Promise<{ ok: true; slug: string; key: string; id: string } | Fail> {
  if (!(await payLinkReady())) return { ok: false, status: 503, error: NOT_READY };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, status: 400, error: "Invalid request" };
  const ownerName = cleanText(raw.name, LINK_NAME_MAX);
  if (ownerName.length < 2) return { ok: false, status: 400, error: "Enter the name people will see, like Ada." };
  let ownerEmail: string | null = null;
  if (raw.email) {
    ownerEmail = normaliseEmail(raw.email);
    if (!ownerEmail) return { ok: false, status: 400, error: "That email address doesn't look right." };
  }
  const note = cleanText(raw.note, LINK_NOTE_MAX) || null;
  if (!Array.isArray(raw.items) || raw.items.length < 1) return { ok: false, status: 400, error: "Add at least one thing people can pay for." };
  if (raw.items.length > LINK_MAX_ITEMS) return { ok: false, status: 400, error: `A link can cover up to ${LINK_MAX_ITEMS} things.` };

  const country = getCountry("NG");
  const minNgn = country.minDomestic ?? country.minLocal;
  const maxNgn = ngnMaxOrder(country.maxLocal);
  const items: any[] = [];
  const seen = new Set<string>();
  for (let n = 0; n < raw.items.length; n++) {
    const r = raw.items[n] ?? {};
    const it = {
      billerCode: cap(r.billerCode, 64), itemCode: cap(r.itemCode, 64), billerName: cap(r.billerName, 120), itemName: cap(r.itemName, 120),
      identifier: cap(r.identifier, 64).replace(/\s+/g, ""), identifierLabel: cap(r.identifierLabel, 60) || "Account number",
      amount: r.amount == null || r.amount === "" ? null : Math.round(Number(r.amount)),
    };
    if (!it.billerCode || !it.itemCode || !it.billerName || !it.identifier) return { ok: false, status: 400, error: "One of the items is incomplete." };
    if (pfmIsExam(it.billerCode)) return { ok: false, status: 400, error: "Exam PINs can't be put on a bills link." };
    const dupKey = `${it.billerCode}|${it.itemCode}|${it.identifier}`;
    if (seen.has(dupKey)) return { ok: false, status: 400, error: "The same meter or number is in the list twice." };
    seen.add(dupKey);
    if (it.amount !== null && (!Number.isFinite(it.amount) || it.amount < minNgn || it.amount > maxNgn)) return { ok: false, status: 400, error: `Amounts must be between ${pfmMoney(minNgn)} and ${pfmMoney(maxNgn)}.` };
    // Check it with the provider now, so a wrong meter number never becomes a link people pay into.
    try {
      if (it.amount !== null) {
        const p = await checkPurchase(it.billerCode, it.itemCode, it.amount);
        if (!p.ok) return { ok: false, status: 400, error: `Item ${n + 1}: ${p.error}` };
      }
      let customer: string | null = null;
      if (!pfmNoValidate({ biller_name: it.billerName, name: it.itemName, item_code: it.itemCode })) {
        const v = await validateCustomer(it.itemCode, it.billerCode, it.identifier);
        customer = v.name ?? null;
      }
      items.push({ ...it, customer, label: cleanText(r.label, LABEL_MAX) || pfmTitle(it.billerName, it.itemName).slice(0, LABEL_MAX) });
    } catch (e: any) {
      const m = String(e?.message ?? "");
      return { ok: false, status: 400, error: `Item ${n + 1}: ${m && !/^(Flutterwave|VTpass|Paybeta) /i.test(m) && m.length < 200 ? m : "We couldn't check this number. Check it and try again."}` };
    }
  }

  // One person can't pile up links.
  const mine = opts.ownerChat ? db().from("pay_links").select("id", { count: "exact", head: true }).eq("owner_chat", opts.ownerChat).eq("active", true)
    : ownerEmail ? db().from("pay_links").select("id", { count: "exact", head: true }).eq("owner_email", ownerEmail).eq("active", true) : null;
  if (mine) { const { count } = await mine; if ((count ?? 0) >= LINK_MAX_PER_OWNER) return { ok: false, status: 400, error: `You already have ${LINK_MAX_PER_OWNER} links. Delete one first.` }; }

  const slug = await freeSlug(ownerName);
  const { data: link, error } = await db().from("pay_links").insert({ slug, owner_name: ownerName, owner_email: ownerEmail, owner_chat: opts.ownerChat ?? null, note, active: true }).select("id,owner_key").single();
  if (error || !link) {
    console.error("[paylink] create failed", error?.message);
    if (isMissingSchema(error)) { forgetPayLinkReady(); return { ok: false, status: 503, error: NOT_READY }; }
    return { ok: false, status: 500, error: "Something went wrong. Please try again." };
  }
  const { error: itemErr } = await db().from("pay_link_items").insert(items.map((i, n) => ({
    link_id: link.id, row_no: n + 1, label: i.label, biller_code: i.billerCode, item_code: i.itemCode, biller_name: i.billerName, item_name: i.itemName || null,
    identifier: i.identifier, identifier_label: i.identifierLabel, customer_name: i.customer, amount_ngn: i.amount,
  })));
  if (itemErr) {
    await db().from("pay_links").delete().eq("id", link.id);
    console.error("[paylink] items failed", itemErr.message);
    return { ok: false, status: 500, error: "Something went wrong. Please try again." };
  }
  return { ok: true, slug, key: String(link.owner_key), id: link.id };
}

// ───────────────────────── what the public sees ─────────────────────────

export type PublicItem = { id: string; label: string; title: string; masked: string; cat: PfmCategory | null; fixed: number | null; billerCode: string; itemCode: string; billerName: string; itemName: string };
export type PublicLink = { slug: string; ownerName: string; note: string | null; active: boolean; items: PublicItem[] };

/** Only what a stranger needs: the name the owner chose, what can be paid, and the last four digits. Never the full number or the provider's name for the account. */
export async function getPublicLink(slug: string): Promise<PublicLink | null> {
  if (!SLUG_RE.test(String(slug))) return null;
  const { data: l } = await db().from("pay_links").select("*").eq("slug", slug).maybeSingle();
  if (!l) return null;
  const { data: its } = await db().from("pay_link_items").select("*").eq("link_id", l.id).order("row_no", { ascending: true });
  return {
    slug: l.slug, ownerName: l.owner_name, note: l.note ?? null, active: !!l.active,
    items: ((its ?? []) as any[]).map((i) => ({
      id: i.id, label: i.label, title: pfmTitle(i.biller_name, i.item_name),
      masked: `…${String(i.identifier).slice(-4)}`,
      cat: pfmCategoryOf({ biller_name: i.biller_name, name: i.item_name ?? i.biller_name, biller_code: i.biller_code, item_code: i.item_code }),
      fixed: i.amount_ngn == null ? null : Math.round(Number(i.amount_ngn)),
      billerCode: i.biller_code, itemCode: i.item_code, billerName: i.biller_name, itemName: i.item_name ?? "", // public catalogue codes, used to show the fee
    })),
  };
}

// ───────────────────────── someone pays ─────────────────────────

export async function startPayLinkPayment(slug: string, body: any, ip: string): Promise<{ ok: true; url: string; requestId: string } | Fail> {
  if (!(await payLinkReady())) return { ok: false, status: 503, error: NOT_READY };
  if (!SLUG_RE.test(String(slug))) return { ok: false, status: 404, error: "This link wasn't found." };
  const email = normaliseEmail(body?.email);
  if (!email) return { ok: false, status: 400, error: "Enter a valid email address for your receipt." };
  const payerName = cleanText(body?.name, 40) || null;

  const { data: l } = await db().from("pay_links").select("*").eq("slug", slug).maybeSingle();
  if (!l) return { ok: false, status: 404, error: "This link wasn't found." };
  if (!l.active) return { ok: false, status: 410, error: `${l.owner_name} has paused this link.` };
  const itemId = String(body?.itemId ?? "");
  if (!UUID_RE.test(itemId)) return { ok: false, status: 400, error: "Choose what you'd like to pay for." };
  const { data: it } = await db().from("pay_link_items").select("*").eq("id", itemId).eq("link_id", l.id).maybeSingle();
  if (!it) return { ok: false, status: 400, error: "Choose what you'd like to pay for." };

  const country = getCountry("NG");
  const minNgn = country.minDomestic ?? country.minLocal;
  const maxNgn = ngnMaxOrder(country.maxLocal);
  const amount = it.amount_ngn != null ? Math.round(Number(it.amount_ngn)) : Math.round(Number(body?.amount));
  if (!Number.isFinite(amount) || amount < minNgn || amount > maxNgn) return { ok: false, status: 400, error: `Enter an amount between ${pfmMoney(minNgn)} and ${pfmMoney(maxNgn)}.` };

  // A link that is being hammered with unfinished payments slows down for everyone.
  const since = new Date(Date.now() - 3600_000).toISOString();
  const { count } = await db().from("pay_requests").select("id", { count: "exact", head: true }).eq("link_id", l.id).in("status", ["open", "pending_payment"]).gte("created_at", since);
  if ((count ?? 0) >= OPEN_PER_HOUR) return { ok: false, status: 429, error: "Lots of people are paying this link right now. Please try again in a few minutes." };

  const r = await createPayRequest({
    receiverName: l.owner_name, receiverEmail: l.owner_email ?? undefined, note: l.note ?? undefined,
    items: [{ billerCode: it.biller_code, itemCode: it.item_code, billerName: it.biller_name, itemName: it.item_name ?? "", identifier: it.identifier, identifierLabel: it.identifier_label ?? "Account number", amount }],
  }, ip);
  if (!r.ok) return { ok: false, status: r.status, error: r.error };
  await db().from("pay_requests").update({ link_id: l.id }).eq("id", r.id);
  const p = await startPayRequestPayment(r.id, { email, name: payerName }, ip);
  if (!p.ok) {
    await cancelPayRequest(r.id, r.key).catch(() => undefined); // nothing was charged; don't leave it lying around
    return { ok: false, status: p.status, error: p.error };
  }
  await db().from("pay_links").update({ last_paid_at: new Date().toISOString() }).eq("id", l.id);
  if (l.owner_chat) {
    // The owner's Telegram chat is told when this is paid and delivered (the sweep in lib/tg/links.ts).
    await db().from("tg_links").insert({ chat_id: l.owner_chat, kind: "bill", ref: r.id, key: r.key }).then(undefined, () => undefined);
  }
  return { ok: true, url: p.url, requestId: r.id };
}

// ───────────────────────── the owner looks after it ─────────────────────────

export type OwnerLink = { slug: string; ownerName: string; active: boolean; note: string | null; items: { label: string; title: string; masked: string; fixed: number | null }[]; payments: { name: string | null; amount: number; status: string; at: string }[] };

async function ownerView(l: any): Promise<OwnerLink> {
  const [{ data: its }, { data: reqs }] = await Promise.all([
    db().from("pay_link_items").select("*").eq("link_id", l.id).order("row_no", { ascending: true }),
    db().from("pay_requests").select("payer_name,amount_ngn,status,created_at,paid_at").eq("link_id", l.id).in("status", ["paid", "settled", "needs_review"]).order("created_at", { ascending: false }).limit(15),
  ]);
  return {
    slug: l.slug, ownerName: l.owner_name, active: !!l.active, note: l.note ?? null,
    items: ((its ?? []) as any[]).map((i) => ({ label: i.label, title: pfmTitle(i.biller_name, i.item_name), masked: maskIdentifier(i.identifier), fixed: i.amount_ngn == null ? null : Math.round(Number(i.amount_ngn)) })),
    payments: ((reqs ?? []) as any[]).map((r) => ({ name: r.payer_name ?? null, amount: Math.round(Number(r.amount_ngn)), status: r.status, at: r.paid_at ?? r.created_at })),
  };
}

async function bySlugKey(slug: string, key: string) {
  if (!SLUG_RE.test(String(slug)) || !UUID_RE.test(String(key))) return null;
  const { data: l } = await db().from("pay_links").select("*").eq("slug", slug).maybeSingle();
  return l && safeEqual(String(key).toLowerCase(), String(l.owner_key).toLowerCase()) ? l : null;
}

export async function getOwnerLink(slug: string, key: string): Promise<OwnerLink | null> {
  const l = await bySlugKey(slug, key);
  return l ? ownerView(l) : null;
}
export async function setLinkActive(slug: string, key: string, active: boolean): Promise<boolean> {
  const l = await bySlugKey(slug, key);
  if (!l) return false;
  await db().from("pay_links").update({ active }).eq("id", l.id);
  return true;
}
export async function deleteLink(slug: string, key: string): Promise<boolean> {
  const l = await bySlugKey(slug, key);
  if (!l) return false;
  await db().from("pay_links").delete().eq("id", l.id);
  return true;
}

// The same, for the Telegram chat that owns a link.
export type ChatLink = { slug: string; ownerName: string; active: boolean; items: number; lastPaidAt: string | null };
export async function listChatLinks(chatId: number): Promise<ChatLink[]> {
  const { data } = await db().from("pay_links").select("*").eq("owner_chat", chatId).order("created_at", { ascending: true }).limit(10);
  const out: ChatLink[] = [];
  for (const l of (data ?? []) as any[]) {
    const { count } = await db().from("pay_link_items").select("id", { count: "exact", head: true }).eq("link_id", l.id);
    out.push({ slug: l.slug, ownerName: l.owner_name, active: !!l.active, items: count ?? 0, lastPaidAt: l.last_paid_at ?? null });
  }
  return out;
}
export async function chatOwnerView(chatId: number, slug: string): Promise<OwnerLink | null> {
  if (!SLUG_RE.test(slug)) return null;
  const { data: l } = await db().from("pay_links").select("*").eq("slug", slug).eq("owner_chat", chatId).maybeSingle();
  return l ? ownerView(l) : null;
}
export async function setChatLinkActive(chatId: number, slug: string, active: boolean): Promise<boolean> {
  if (!SLUG_RE.test(slug)) return false;
  const { data } = await db().from("pay_links").update({ active }).eq("slug", slug).eq("owner_chat", chatId).select("id");
  return !!data?.length;
}
export async function deleteChatLink(chatId: number, slug: string): Promise<boolean> {
  if (!SLUG_RE.test(slug)) return false;
  const { data } = await db().from("pay_links").delete().eq("slug", slug).eq("owner_chat", chatId).select("id");
  return !!data?.length;
}

export const payLinkUrl = (slug: string, app = (process.env.NEXT_PUBLIC_APP_URL ?? "https://www.nolgic.com")) => `${app.replace(/\/+$/, "")}/for/${slug}`;

/** The message the owner forwards on WhatsApp. */
export function payLinkShareText(ownerName: string, link: string, note?: string | null): string {
  return [`Hi! You can pay my light, TV, airtime or data bills here, any time, in naira:`, link, note ? `\n"${note}"` : "", `\n— ${ownerName}`].filter(Boolean).join("\n");
}
