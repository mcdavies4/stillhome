// src/lib/payforme-collect.ts
// Giveaway links ("let them choose"), server side.
//
//   1. The giver makes a link: their name and email, a message, the most each person can choose (budget), what they
//      may choose (light, TV, airtime, data) and how many people. Nothing is charged.
//   2. Each person opens the link, picks their bill, enters their own meter / smartcard / phone number. It is checked
//      with the provider (the name on the meter) exactly like checkout. Nothing is charged.
//   3. The giver watches the list fill up, removes anyone they don't recognise, then closes the link. The list
//      becomes an ordinary Pay for Me giveaway (every item is checked with the provider AGAIN) and the giver pays
//      once. From there it is the existing giveaway: per-item delivery, per-item refunds, same safety rules.
//   4. Each person sees their own delivery (and their token) on the same link, on the device they joined from.
//
// Nolgic never holds money for people who haven't chosen: nobody pays until the list is final.
//
// Life of a link (pay_collects.status): open -> closing -> converted
//                                         \-> cancelled (by the giver)   \-> expired (7, 14 or 30 days, nobody closed it)

import { supabaseAdmin } from "@/lib/supabase";
import { checkPurchase, validateCustomer, FlwError } from "@/lib/bills";
import { getCountry } from "@/lib/countries";
import { cap, normaliseEmail, safeEqual, UUID_RE } from "@/lib/security";
import { ngnServiceFee, ngnMaxOrder, feeKindOf, type FeeKind } from "@/lib/ngn-fee";
import { ngnPayProvider, flwPayConfigured } from "@/lib/flwpay";
import { paystackConfigured } from "@/lib/paystack";
import { expectsToken, tryRecoverToken } from "@/lib/fulfilment";
import { appUrl, button, esc, naira, sendMail, shell } from "@/lib/mailer";
import { waRecipient } from "@/lib/gift";
import { checkExamItem, createPayRequest, isMissingSchema, payForMeReady, syncPayRequest } from "@/lib/payforme";
import {
  PFC_CATEGORIES, PFC_DAY_CHOICES, PFC_MAX_PEOPLE, PFC_VALID_DAYS, PFM_NOTE_MAX, itemStateOf, pfmIsExam, maskIdentifier, pfcChoiceText, pfmCategoryOf, pfmMoney, pfmNoValidate,
  type PfcEntryState, type PfcEntryView, type PfcStatus, type PfcView, type PfmCategory,
} from "@/lib/payforme-shared";

type Row = Record<string, any>;
export type Fail = { ok: false; status: number; error: string };

const db = () => supabaseAdmin();
const MAX_TOTAL = () => { const v = Number(process.env.PFM_MAX_TOTAL_NGN ?? 100000); return Number.isFinite(v) && v > 0 ? v : 100000; };
const CLOSING_STALE_MS = 2 * 60_000; // a close that crashed half way can be tried again after this
const NOT_READY_MSG = "Giveaway links aren't open yet. Please check back soon.";
const FEE_KINDS: FeeKind[] = ["electricity", "tv", "airtime_data"];

// ───────────────────────── 0. is the database set up? ─────────────────────────
let readyCache: { ok: boolean; at: number } | null = null;

export async function collectReady(): Promise<boolean> {
  if (readyCache && Date.now() - readyCache.at < (readyCache.ok ? 5 * 60_000 : 15_000)) return readyCache.ok;
  let ok = false;
  try {
    if (await payForMeReady()) {
      const [a, b] = await Promise.all([
        db().from("pay_collects").select("id").limit(1),
        db().from("pay_collect_entries").select("id").limit(1),
      ]);
      ok = !a.error && !b.error;
      if (!ok) console.error("[pfc] NOT READY: run supabase/migrations/0025_giveaway_links.sql in the Supabase SQL editor.", a.error?.message ?? "", b.error?.message ?? "");
    }
  } catch (e: any) {
    console.error("[pfc] readiness check failed", e?.message ?? e);
  }
  readyCache = { ok, at: Date.now() };
  return ok;
}

const railReady = () => (ngnPayProvider() === "flutterwave" ? flwPayConfigured() : paystackConfigured());
const worstFee = (amount: number) => Math.max(...FEE_KINDS.map((k) => ngnServiceFee(amount, k)));

// ───────────────────────── 1. the giver makes a link ─────────────────────────

export async function createCollect(raw: any, ip: string): Promise<{ ok: true; id: string; key: string } | Fail> {
  if (!(await collectReady())) return { ok: false, status: 503, error: NOT_READY_MSG };
  if (!railReady()) return { ok: false, status: 503, error: "This isn't available yet. Please check back soon." };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, status: 400, error: "Invalid request" };

  const makerName = cap(raw.makerName, 60).replace(/\s+/g, " ");
  if (makerName.length < 2) return { ok: false, status: 400, error: "Enter your name, so people know who the gift is from." };
  const makerEmail = normaliseEmail(raw.makerEmail);
  if (!makerEmail) return { ok: false, status: 400, error: "Enter your email. Your private link, receipt and tokens are sent there." };
  const note = cap(raw.note, PFM_NOTE_MAX).replace(/\s+/g, " ") || null;

  const country = getCountry("NG");
  const minNgn = country.minDomestic ?? country.minLocal;
  const maxNgn = ngnMaxOrder(country.maxLocal);
  const budget = Math.round(Number(raw.budget));
  if (!Number.isFinite(budget) || budget < minNgn || budget > maxNgn) {
    return { ok: false, status: 400, error: `Each person can get between ${pfmMoney(minNgn)} and ${pfmMoney(maxNgn)}.` };
  }

  const categories = Array.isArray(raw.categories)
    ? PFC_CATEGORIES.filter((c) => (raw.categories as unknown[]).includes(c))
    : [];
  if (!categories.length) return { ok: false, status: 400, error: "Pick at least one thing people can choose." };

  const maxPeople = Math.round(Number(raw.maxPeople));
  if (!Number.isFinite(maxPeople) || maxPeople < 1 || maxPeople > PFC_MAX_PEOPLE) {
    return { ok: false, status: 400, error: `A giveaway link can have 1 to ${PFC_MAX_PEOPLE} people.` };
  }
  // Even if everyone takes the full amount, one payment must stay under the per-request cap.
  const perHead = budget + worstFee(budget);
  if (perHead * maxPeople > MAX_TOTAL()) {
    const fits = Math.max(1, Math.floor(MAX_TOTAL() / perHead));
    return { ok: false, status: 400, error: `That could come to more than ${pfmMoney(MAX_TOTAL())} in one payment. At ${pfmMoney(budget)} each, the most is ${fits} ${fits === 1 ? "person" : "people"}.` };
  }

  // How long it stays open: 7 (default), 14 or 30 days.
  const days = PFC_DAY_CHOICES.includes(Number(raw.validDays)) ? Number(raw.validDays) : PFC_VALID_DAYS;

  const { data, error } = await db().from("pay_collects").insert({
    maker_name: makerName, maker_email: makerEmail, note, budget_ngn: budget, categories, max_people: maxPeople, status: "open", ip,
    expires_at: new Date(Date.now() + days * 86400_000).toISOString(),
  }).select("id,maker_key").single();
  if (error || !data) {
    console.error("[pfc] create failed", error?.message);
    if (isMissingSchema(error)) { readyCache = { ok: false, at: Date.now() }; return { ok: false, status: 503, error: NOT_READY_MSG }; }
    return { ok: false, status: 500, error: "Something went wrong. Please try again." };
  }

  try { await sendMakerLinkEmail({ id: data.id, key: data.maker_key, makerName, makerEmail, budget, categories, maxPeople }); }
  catch (e) { console.error("[pfc] link email failed", e); }

  return { ok: true, id: data.id, key: data.maker_key };
}

async function sendMakerLinkEmail(p: { id: string; key: string; makerName: string; makerEmail: string; budget: number; categories: PfmCategory[]; maxPeople: number }) {
  const share = `${appUrl()}/c/${p.id}`;
  const mine = `${appUrl()}/c/${p.id}?k=${p.key}`;
  const html = shell({
    title: "Your giveaway link is ready",
    bodyHtml: `<p>Up to <b>${naira(p.budget)}</b> of ${esc(pfcChoiceText(p.categories))} each, for up to <b>${p.maxPeople}</b> ${p.maxPeople === 1 ? "person" : "people"}.</p>
      <p><b>Share this link</b> with the people you're giving to:<br><a href="${share}">${share}</a></p>
      <p><b>Your private page</b> is where you see who has joined, remove anyone you don't know, and pay once for everyone. Nothing is charged until you do.</p>
      ${button(mine, "Open my giveaway")}`,
    footerHtml: "Don't share the button in this email: it lets whoever has it manage and close your giveaway.",
  });
  const text = `Your giveaway link is ready.\n\nShare this link: ${share}\n\nYour private page (don't share it): ${mine}\n\nNothing is charged until you close the list and pay.`;
  await sendMail(p.makerEmail, { subject: "Your Nolgic giveaway link", html, text });
}

// ───────────────────────── 2. a person joins ─────────────────────────

const safeMsg = (e: any, fallback: string) => {
  const m = String(e?.message ?? "");
  return (e instanceof FlwError || e?.name === "FlwError") && m && !/^(Flutterwave|VTpass|Paybeta) /i.test(m) ? m : fallback;
};

const JOIN_ERRORS: Record<string, { status: number; error: string }> = {
  PFC_NOT_FOUND: { status: 404, error: "This giveaway wasn't found." },
  PFC_CLOSED: { status: 409, error: "This giveaway is closed. You can't join it any more." },
  PFC_CATEGORY: { status: 400, error: "That isn't one of the things on offer in this giveaway." },
  PFC_BUDGET: { status: 400, error: "That's more than this giveaway allows. Pick a smaller amount or plan." },
  PFC_FULL: { status: 409, error: "Sorry, this giveaway is full." },
  PFC_DUPLICATE: { status: 409, error: "That number is already in this giveaway." },
};

export async function joinCollect(id: string, raw: any, ip: string): Promise<{ ok: true; entryKey: string } | Fail> {
  if (!UUID_RE.test(id)) return { ok: false, status: 404, error: "This giveaway wasn't found." };
  if (!(await collectReady())) return { ok: false, status: 503, error: NOT_READY_MSG };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, status: 400, error: "Invalid request" };

  const { data: c } = await db().from("pay_collects").select("*").eq("id", id).maybeSingle();
  const col = c as Row | null;
  if (!col) return { ok: false, status: 404, error: "This giveaway wasn't found." };
  if (col.status !== "open" || new Date(col.expires_at).getTime() < Date.now()) return { ok: false, ...JOIN_ERRORS.PFC_CLOSED };

  const who = cap(raw.who, 30).replace(/[\u0000-\u001f\u007f<>]/g, " ").replace(/\s+/g, " ").trim();
  if (who.length < 2) return { ok: false, status: 400, error: "Enter your name, so they know it's you." };
  let email: string | null = null;
  if (raw.email) {
    email = normaliseEmail(raw.email);
    if (!email) return { ok: false, status: 400, error: "That email address doesn't look right." };
  }
  let whatsapp: string | null = null;
  if (raw.whatsapp) {
    whatsapp = waRecipient(String(raw.whatsapp));
    if (!whatsapp) return { ok: false, status: 400, error: "That WhatsApp number doesn't look like a Nigerian mobile number." };
  }

  const d = {
    billerCode: cap(raw.billerCode, 64), itemCode: cap(raw.itemCode, 64), billerName: cap(raw.billerName, 120), itemName: cap(raw.itemName, 120),
    identifier: cap(raw.identifier, 64).replace(/\s+/g, ""), identifierLabel: cap(raw.identifierLabel, 60) || "Account number", amount: Math.round(Number(raw.amount)),
  };
  if (!d.billerCode || !d.itemCode || !d.billerName || !d.identifier) return { ok: false, status: 400, error: "Pick what you want and enter your number." };

  const country = getCountry("NG");
  const minNgn = country.minDomestic ?? country.minLocal;
  const budget = Number(col.budget_ngn);
  if (!Number.isFinite(d.amount) || d.amount < minNgn) return { ok: false, status: 400, error: `The smallest amount is ${pfmMoney(minNgn)}.` };
  if (d.amount > budget) return { ok: false, status: 400, error: `The most you can choose in this giveaway is ${pfmMoney(budget)}.` };

  // The same checks as checkout: the plan exists at this price, and the meter / smartcard has a real name on it.
  let customerName: string | null = null;
  let fee: number;
  let category: PfmCategory | null;
  if (pfmIsExam(d.billerCode)) {
    // Exam PINs: price and name from Paybeta's own list, the profile code / phone number checked for shape.
    if (!(col.categories as string[]).includes("exam")) return { ok: false, ...JOIN_ERRORS.PFC_CATEGORY };
    try {
      const ex = await checkExamItem(d);
      if (!ex.ok) return { ok: false, status: 400, error: ex.error };
      d.billerName = ex.billerName; d.itemName = ex.itemName; d.identifierLabel = ex.identifierLabel;
      fee = ex.fee; category = "exam";
    } catch (e: any) {
      return { ok: false, status: 400, error: "Exam PINs are temporarily unavailable. Please try again in a few minutes." };
    }
  } else try {
    const purchase = await checkPurchase(d.billerCode, d.itemCode, d.amount);
    if (!purchase.ok) return { ok: false, status: 400, error: purchase.error };
    // Decide what kind of bill this is from the provider's own record when we have it, never only from the browser.
    const it = purchase.item;
    category = pfmCategoryOf(it ? { biller_name: it.biller_name, name: it.name, short_name: it.short_name ?? "", is_airtime: !!it.is_airtime, biller_code: it.biller_code, item_code: it.item_code }
      : { biller_name: d.billerName, name: d.itemName, biller_code: d.billerCode, item_code: d.itemCode });
    // Not on offer in this giveaway: stop before asking the provider anything.
    if (!category || !(col.categories as string[]).includes(category)) return { ok: false, ...JOIN_ERRORS.PFC_CATEGORY };
    try {
      const v = await validateCustomer(d.itemCode, d.billerCode, d.identifier);
      customerName = v.name ?? null;
      // Many electricity companies have a smallest purchase per meter. Catch it now, not as a failed vend after payment.
      const min = Number(v.minimum ?? 0);
      if (Number.isFinite(min) && min > d.amount) {
        return { ok: false, status: 400, error: min > budget
          ? `This meter's smallest top-up is ${pfmMoney(min)}, which is more than this giveaway allows (${pfmMoney(budget)}).`
          : `This meter's smallest top-up is ${pfmMoney(min)}. Choose ${pfmMoney(min)} or more.` };
      }
    } catch (e) {
      if (!pfmNoValidate({ biller_name: d.billerName, name: d.itemName, item_code: d.itemCode, is_airtime: it?.is_airtime })) throw e;
    }
    fee = ngnServiceFee(d.amount, feeKindOf(it ? it : { biller_code: d.billerCode, item_code: d.itemCode, biller_name: d.billerName }));
  } catch (e: any) {
    return { ok: false, status: 400, error: safeMsg(e, "We couldn't check that number. Check it and try again.") };
  }
  if (!category) return { ok: false, ...JOIN_ERRORS.PFC_CATEGORY };
  // Airtime and data go to a phone: use it for WhatsApp too unless they gave another number.
  if (!whatsapp && (category === "airtime" || category === "data" || category === "exam")) whatsapp = waRecipient(d.identifier); // a JAMB profile code is never a phone, so it stays empty

  const { data: rows, error } = await db().rpc("pfc_add_entry", {
    p_collect: id, p_max_total: MAX_TOTAL(),
    p_who: who, p_whatsapp: whatsapp, p_category: category,
    p_biller_code: d.billerCode, p_item_code: d.itemCode, p_biller_name: d.billerName, p_item_name: d.itemName || null,
    p_identifier: d.identifier, p_identifier_label: d.identifierLabel, p_customer_name: customerName,
    p_amount: d.amount, p_fee: fee, p_ip: ip,
  });
  if (error) {
    const code = Object.keys(JOIN_ERRORS).find((k) => String(error.message ?? "").includes(k));
    if (code) return { ok: false, ...JOIN_ERRORS[code] };
    if (String(error.code) === "23505") return { ok: false, ...JOIN_ERRORS.PFC_DUPLICATE };
    console.error("[pfc] join failed", error.message);
    if (isMissingSchema(error)) { readyCache = { ok: false, at: Date.now() }; return { ok: false, status: 503, error: NOT_READY_MSG }; }
    return { ok: false, status: 500, error: "Something went wrong. Please try again." };
  }
  const row = Array.isArray(rows) ? rows[0] : rows;
  if (!row?.entry_key) return { ok: false, status: 500, error: "Something went wrong. Please try again." };
  if (email) await db().from("pay_collect_entries").update({ email }).eq("id", row.entry_id);
  return { ok: true, entryKey: String(row.entry_key) };
}

// ───────────────────────── 3. the giver manages the list ─────────────────────────

async function ownCollect(id: string, key: string): Promise<Row | null> {
  if (!UUID_RE.test(id) || !key) return null;
  const { data } = await db().from("pay_collects").select("*").eq("id", id).maybeSingle();
  if (!data || !safeEqual(String(key).toLowerCase(), String(data.maker_key).toLowerCase())) return null;
  return data as Row;
}

export async function removeEntry(id: string, key: string, entryId: string): Promise<{ ok: true } | Fail> {
  const col = await ownCollect(id, key);
  if (!col) return { ok: false, status: 404, error: "Not found" };
  if (col.status !== "open") return { ok: false, status: 409, error: "The list is closed, so it can't be changed any more." };
  if (!UUID_RE.test(entryId)) return { ok: false, status: 400, error: "Not found" };
  await db().from("pay_collect_entries").update({ status: "removed" }).eq("id", entryId).eq("collect_id", id).eq("status", "active");
  return { ok: true };
}

export async function cancelCollect(id: string, key: string): Promise<{ ok: true } | Fail> {
  const col = await ownCollect(id, key);
  if (!col) return { ok: false, status: 404, error: "Not found" };
  const { data } = await db().from("pay_collects").update({ status: "cancelled", updated_at: new Date().toISOString() })
    .eq("id", id).eq("status", "open").select("id").maybeSingle();
  return data ? { ok: true } : { ok: false, status: 409, error: col.status === "cancelled" ? "Already cancelled." : "The list is already closed." };
}

export type CloseResult = { ok: true; requestId: string; requestKey: string; total: number; names: string[]; phones: (string | null)[]; note: string | null; makerName: string; makerEmail: string };

/**
 * Close the list and turn it into an ordinary giveaway, ready to pay. Every item is checked with the provider again
 * (a meter can change hands, a plan's price can move). If one fails, nothing is closed and the giver is told who.
 */
export async function closeCollect(id: string, key: string, ip: string): Promise<CloseResult | Fail> {
  const col = await ownCollect(id, key);
  if (!col) return { ok: false, status: 404, error: "Not found" };

  // Already closed: hand back the giveaway it became (a second tap, or a different device).
  if (col.status === "converted" && col.request_id) return converted(col);
  if (col.status === "cancelled") return { ok: false, status: 409, error: "You cancelled this giveaway." };
  if (col.status === "expired" || (col.status === "open" && new Date(col.expires_at).getTime() < Date.now())) {
    return { ok: false, status: 409, error: "This giveaway link has expired. Make a new one." };
  }

  // Claim it (open -> closing). A close that crashed half way more than 2 minutes ago may be claimed again.
  // Two plain claims, not one or(...): PostgREST re-applies an or() filter to the row it returns from an update,
  // so a claim written with or() changes the row but always comes back empty.
  const stale = new Date(Date.now() - CLOSING_STALE_MS).toISOString();
  const claimOpen = await db().from("pay_collects").update({ status: "closing", updated_at: new Date().toISOString(), error: null })
    .eq("id", id).eq("status", "open").select("*").maybeSingle();
  let claimed = claimOpen.data as Row | null;
  if (!claimed) {
    const claimStale = await db().from("pay_collects").update({ status: "closing", updated_at: new Date().toISOString(), error: null })
      .eq("id", id).eq("status", "closing").lt("updated_at", stale).select("*").maybeSingle();
    claimed = claimStale.data as Row | null;
  }
  if (!claimed) return { ok: false, status: 409, error: "This is already being closed. Wait a moment and refresh." };

  const reopen = async (why: string) => {
    await db().from("pay_collects").update({ status: "open", error: why.slice(0, 300), updated_at: new Date().toISOString() }).eq("id", id).eq("status", "closing");
  };

  const { data: es } = await db().from("pay_collect_entries").select("*").eq("collect_id", id).eq("status", "active").order("created_at", { ascending: true });
  const entries = (es ?? []) as Row[];
  if (!entries.length) { await reopen("nobody joined"); return { ok: false, status: 400, error: "Nobody has joined yet. Share your link first." }; }

  const made = await createPayRequest({
    receiverName: claimed.maker_name, receiverEmail: claimed.maker_email, note: claimed.note ?? undefined, giveaway: true,
    items: entries.map((e) => ({
      billerCode: e.biller_code, itemCode: e.item_code, billerName: e.biller_name, itemName: e.item_name ?? "",
      identifier: e.identifier, identifierLabel: e.identifier_label ?? "Account number", amount: Number(e.amount_ngn),
    })),
  }, ip);
  if (!made.ok) {
    // "Item 3: ..." -> "Ada: ..." so the giver knows whom to remove.
    const m = /^Item (\d+):\s*([\s\S]*)$/.exec(made.error);
    const who = m ? entries[Number(m[1]) - 1]?.who : null;
    const error = who ? `${who}'s choice didn't pass the check: ${m![2]} Remove ${who} and close again.` : made.error;
    await reopen(error);
    return { ok: false, status: made.status, error };
  }

  // Remember which row of the giveaway is whose, so each person can see their own delivery.
  await Promise.all(entries.map((e, i) => db().from("pay_collect_entries").update({ request_row: i + 1 }).eq("id", e.id)));
  const { data: done } = await db().from("pay_collects").update({ status: "converted", request_id: made.id, closed_at: new Date().toISOString(), updated_at: new Date().toISOString(), error: null })
    .eq("id", id).eq("status", "closing").select("*").maybeSingle();
  if (!done) {
    // Someone else finished the close at the same moment. Ours is an unpaid, unused request: withdraw it so it can't be paid twice.
    await db().from("pay_requests").update({ status: "cancelled", updated_at: new Date().toISOString(), error: "duplicate close of a giveaway link" }).eq("id", made.id).eq("status", "open");
    const { data: now } = await db().from("pay_collects").select("*").eq("id", id).maybeSingle();
    return now?.status === "converted" && now.request_id ? converted(now as Row) : { ok: false, status: 409, error: "Something changed. Refresh the page." };
  }
  return converted(done as Row);
}

async function converted(col: Row): Promise<CloseResult | Fail> {
  const [{ data: req }, { data: es }] = await Promise.all([
    db().from("pay_requests").select("id,receiver_key,amount_ngn,fee_ngn").eq("id", col.request_id).maybeSingle(),
    db().from("pay_collect_entries").select("who,whatsapp,request_row").eq("collect_id", col.id).not("request_row", "is", null).order("request_row", { ascending: true }),
  ]);
  if (!req) return { ok: false, status: 500, error: "Something went wrong. Please try again." };
  const rows = (es ?? []) as Row[];
  return {
    ok: true, requestId: req.id, requestKey: String(req.receiver_key), total: Number(req.amount_ngn) + Number(req.fee_ngn),
    names: rows.map((r) => String(r.who ?? "")), phones: rows.map((r) => (r.whatsapp ? String(r.whatsapp) : null)),
    note: col.note ?? null, makerName: col.maker_name, makerEmail: col.maker_email,
  };
}

// ───────────────────────── 4. what the page shows ─────────────────────────

function statusOf(col: Row, count: number): PfcStatus {
  if (col.status === "cancelled") return "cancelled";
  if (col.status === "converted" || col.status === "closing") return "closed";
  if (col.status === "expired" || new Date(col.expires_at).getTime() < Date.now()) return "expired";
  return count >= Number(col.max_people) ? "full" : "open";
}

/** Public view by default. `k` (the giver's key) adds the list; `e` (a joiner's key) adds that person's own delivery. */
export async function getCollectView(id: string, k?: string | null, e?: string | null): Promise<PfcView | null> {
  if (!UUID_RE.test(id)) return null;
  const d = db();
  const { data: c } = await d.from("pay_collects").select("*").eq("id", id).maybeSingle();
  const col = c as Row | null;
  if (!col) return null;
  if (col.status === "open" && new Date(col.expires_at).getTime() < Date.now()) {
    await d.from("pay_collects").update({ status: "expired", updated_at: new Date().toISOString() }).eq("id", id).eq("status", "open");
    col.status = "expired";
  }
  const owner = !!k && safeEqual(String(k).toLowerCase(), String(col.maker_key).toLowerCase());

  const { data: es } = await d.from("pay_collect_entries").select("*").eq("collect_id", id).eq("status", "active").order("created_at", { ascending: true });
  const entries = (es ?? []) as Row[];

  const view: PfcView = {
    id: col.id, makerName: col.maker_name, note: col.note ?? null, budget: Number(col.budget_ngn),
    categories: (col.categories ?? []) as PfmCategory[], maxPeople: Number(col.max_people), count: entries.length,
    status: statusOf(col, entries.length), expiresAt: col.expires_at, owner,
  };

  if (owner) {
    view.entries = entries.map((x): PfcEntryView => ({
      id: x.id, who: x.who, whatsapp: x.whatsapp ?? null, category: (x.category ?? null) as PfmCategory | null,
      billerName: x.biller_name, itemName: x.item_name ?? null, identifier: x.identifier, label: x.identifier_label || "Account number",
      customerName: x.customer_name ?? null, amount: Number(x.amount_ngn), fee: Number(x.fee_ngn), at: x.created_at,
    }));
    view.amount = entries.reduce((s, x) => s + Number(x.amount_ngn), 0);
    view.fee = entries.reduce((s, x) => s + Number(x.fee_ngn), 0);
    view.makerEmail = col.maker_email;
    view.requestId = col.request_id ?? null;
    if (col.request_id) {
      const { data: req } = await d.from("pay_requests").select("receiver_key").eq("id", col.request_id).maybeSingle();
      view.requestKey = req ? String(req.receiver_key) : null;
    }
  }

  if (e && UUID_RE.test(e)) view.mine = await joinerView(col, e);
  return view;
}

async function joinerView(col: Row, entryKey: string): Promise<PfcView["mine"]> {
  const d = db();
  const { data: x } = await d.from("pay_collect_entries").select("*").eq("collect_id", col.id).eq("entry_key", entryKey).maybeSingle();
  const en = x as Row | null;
  if (!en) return null;
  const base = {
    who: en.who, billerName: en.biller_name, itemName: en.item_name ?? null, identifier: maskIdentifier(en.identifier),
    label: en.identifier_label || "Account number", customerName: en.customer_name ?? null, amount: Number(en.amount_ngn),
    token: null as string | null, wantsToken: false,
  };
  if (en.status === "removed") return { ...base, state: "removed" };
  if (col.status !== "converted" || !col.request_id || !en.request_row) {
    return { ...base, state: col.status === "cancelled" || col.status === "expired" ? "not_paid" : "joined" };
  }

  // The giveaway exists. Keep it moving (the giver may have closed their page), then read this person's item.
  try { await syncPayRequest(col.request_id); } catch { /* the giver's page and the daily sweep also finish it */ }
  const { data: req } = await d.from("pay_requests").select("status").eq("id", col.request_id).maybeSingle();
  if (!req || req.status === "open" || req.status === "pending_payment") return { ...base, state: "waiting_payment" };
  if (req.status === "cancelled" || req.status === "expired") return { ...base, state: "not_paid" };

  const { data: item } = await d.from("pay_request_items").select("order_id").eq("request_id", col.request_id).eq("row_no", en.request_row).maybeSingle();
  if (!item?.order_id) return { ...base, state: "working" };
  const { data: o } = await d.from("orders").select("*").eq("id", item.order_id).maybeSingle();
  const state: PfcEntryState = itemStateOf(o?.status);
  let token: string | null = null;
  const wantsToken = o ? expectsToken(o) : false;
  if (o && o.status === "fulfilled") {
    token = o.flw_token ?? null;
    if (!token && wantsToken) token = await tryRecoverToken(d, o);
  }
  return { ...base, state, token, wantsToken };
}

/** Daily: expire links nobody closed. (Called from the reconcile cron.) */
export async function sweepCollects(): Promise<void> {
  const now = new Date().toISOString();
  await db().from("pay_collects").update({ status: "expired", updated_at: now }).eq("status", "open").lt("expires_at", now);
}
