// src/lib/payforme-collect-notify.ts
// When a giveaway that came from a giveaway link is finished, email each person who left an email address:
// what they got, their token / PIN if it is ready, and a private link to their own page (where a token that
// arrives a few minutes later shows up by itself). Sent once, from the step that settles the giveaway.

import { supabaseAdmin } from "@/lib/supabase";
import { appUrl, button, esc, naira, sendMail, shell } from "@/lib/mailer";
import { expectsToken, tryRecoverToken } from "@/lib/fulfilment";
import { isExamBiller } from "@/lib/exams-shared";
import { itemStateOf, pfmTitle } from "@/lib/payforme-shared";

type Row = Record<string, any>;

export async function notifyCollectJoiners(requestId: string): Promise<number> {
  const d = supabaseAdmin();
  const { data: col } = await d.from("pay_collects").select("id,maker_name").eq("request_id", requestId).maybeSingle();
  if (!col) return 0; // an ordinary giveaway or request, not a giveaway link

  const { data: es } = await d.from("pay_collect_entries").select("*").eq("collect_id", col.id).eq("status", "active").not("request_row", "is", null).not("email", "is", null);
  const entries = (es ?? []) as Row[];
  if (!entries.length) return 0;

  const { data: items } = await d.from("pay_request_items").select("row_no,order_id").eq("request_id", requestId);
  const orderOf = new Map(((items ?? []) as Row[]).map((i) => [Number(i.row_no), i.order_id] as const));
  const ids = Array.from(orderOf.values()).filter(Boolean);
  const { data: os } = ids.length ? await d.from("orders").select("*").in("id", ids) : { data: [] as Row[] };
  const orders = new Map(((os ?? []) as Row[]).map((o) => [o.id, o] as const));

  let sent = 0;
  for (const e of entries) {
    const o = orders.get(orderOf.get(Number(e.request_row)));
    const state = itemStateOf(o?.status);
    let token: string | null = o?.flw_token ?? null;
    if (o && o.status === "fulfilled" && !token && expectsToken(o)) token = await tryRecoverToken(d, o).catch(() => null);
    const ok = await sendMail(String(e.email), joinerMail({
      maker: col.maker_name, who: e.who, what: pfmTitle(e.biller_name, e.item_name), identifier: e.identifier, amount: Number(e.amount_ngn),
      state, token, wantsToken: !!o && expectsToken(o), exam: isExamBiller(e.biller_name),
      link: `${appUrl()}/c/${col.id}?e=${e.entry_key}`,
    })).catch(() => false);
    if (ok) sent++;
  }
  return sent;
}

export function joinerMail(p: { maker: string; who: string; what: string; identifier: string; amount: number; state: string; token: string | null; wantsToken: boolean; exam: boolean; link: string }) {
  const tokenWord = p.exam ? "PIN" : "token";
  const delivered = p.state === "delivered";
  const subject = delivered ? `${p.maker} paid for your ${p.exam ? "exam PIN" : "bill"} on Nolgic` : p.state === "refunded" ? `About your gift from ${p.maker}` : `Your gift from ${p.maker} is being finished`;
  const status = delivered
    ? (p.token ? `Here is your ${tokenWord}:` : p.wantsToken ? `Your ${tokenWord} is on its way. Open your page below: it shows there as soon as it lands.` : "It has been delivered.")
    : p.state === "refunded" ? `We couldn't deliver it, so the money went back to ${p.maker}.`
    : "It needs a final check on our side. Open your page below: it updates by itself.";
  const html = shell({
    title: delivered ? `${esc(p.maker)} paid for yours` : `Your gift from ${esc(p.maker)}`,
    bodyHtml: `<p>Hi ${esc(p.who)},</p><p><b>${esc(p.what)}</b> · ${naira(p.amount)}<br><span style="color:#555">${esc(p.identifier)}</span></p>
      <p>${status}</p>
      ${p.token ? `<p style="font-family:monospace;font-size:20px;letter-spacing:1px"><b>${esc(p.token)}</b></p>` : ""}
      ${button(p.link, `Open your ${p.token ? tokenWord : "page"}`)}`,
    footerHtml: `This link is only for you: it shows your ${tokenWord}.`,
  });
  const text = `Hi ${p.who},\n\n${p.what} (${naira(p.amount)}), ${p.identifier}\n${status}${p.token ? `\n\n${p.token}` : ""}\n\nYour page: ${p.link}`;
  return { subject, html, text };
}
