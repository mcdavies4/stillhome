// src/lib/payforme-email.ts
// Two plain emails when a Pay for Me request is finished: one to the person who paid, one to the person who asked.

import { appUrl, button, esc, naira, sendMail, shell } from "@/lib/mailer";
import { pfmTitle, type PfmItemState } from "@/lib/payforme-shared";

export type PfmLine = {
  billerName: string;
  itemName: string | null;
  identifier: string;
  customerName: string | null;
  amount: number;
  fee: number;
  state: PfmItemState;
  token: string | null;
  wantsToken: boolean;
};

const STATE_TEXT: Record<PfmItemState, string> = {
  delivered: "Delivered",
  refunded: "Could not be delivered, refunded",
  checking: "We're checking this one",
  working: "In progress",
  waiting: "Waiting",
};

const what = (l: PfmLine) => pfmTitle(l.billerName, l.itemName);

function rows(lines: PfmLine[], withTokens: boolean): { html: string; text: string } {
  const html = lines.map((l) => `
    <tr><td style="padding:10px 0;border-top:1px solid #e6e6e6">
      <b>${esc(what(l))}</b> · ${naira(l.amount)}<br>
      <span style="color:#555">${esc(l.identifier)}${l.customerName ? ` · ${esc(l.customerName)}` : ""}</span><br>
      <span style="color:${l.state === "delivered" ? "#1a7f4b" : l.state === "refunded" ? "#b3261e" : "#8a6d00"}">${STATE_TEXT[l.state]}</span>
      ${withTokens && l.state === "delivered" && l.token ? `<br><span style="font-family:monospace;font-size:16px;letter-spacing:1px">Token: <b>${esc(l.token)}</b></span>` : ""}
      ${withTokens && l.state === "delivered" && !l.token && l.wantsToken ? `<br><span style="color:#555">The token is on its way. It will appear on the page within a few minutes.</span>` : ""}
      ${l.state === "refunded" ? `<br><span style="color:#555">${naira(l.amount + l.fee)} is being returned to the card that paid.</span>` : ""}
    </td></tr>`).join("");
  const text = lines.map((l) =>
    `- ${what(l)} (${naira(l.amount)}), ${l.identifier}${l.customerName ? ` ${l.customerName}` : ""}: ${STATE_TEXT[l.state]}` +
    (withTokens && l.state === "delivered" && l.token ? `\n  Token: ${l.token}` : "")
  ).join("\n");
  return { html: `<table style="width:100%;border-collapse:collapse;margin:14px 0">${html}</table>`, text };
}

/** To the person who paid. */
export async function sendPayerSummary(req: Record<string, any>, lines: PfmLine[]): Promise<boolean> {
  if (!req.payer_email) return false;
  const link = `${appUrl()}/r/${req.id}`;
  const delivered = lines.filter((l) => l.state === "delivered").length;
  const r = rows(lines, true);
  const allGood = delivered === lines.length;
  const subject = allGood ? `Done: you paid for ${req.receiver_name}` : `Your payment for ${req.receiver_name}: ${delivered} of ${lines.length} delivered`;
  const html = shell({
    title: allGood ? "It's done" : "Most of it is done",
    bodyHtml: `<p>Thank you. Here is what your payment of <b>${naira(Number(req.amount_ngn) + Number(req.fee_ngn))}</b> bought for <b>${esc(req.receiver_name)}</b>:</p>${r.html}
      <p style="color:#555">Anything that could not be delivered has been refunded to your card automatically. A refund can take a few days to show.</p>${button(link, "See the request")}`,
    footerHtml: "Questions? Just reply to this email.",
  });
  const text = `Thank you. Here is what your payment of ${naira(Number(req.amount_ngn) + Number(req.fee_ngn))} bought for ${req.receiver_name}:\n\n${r.text}\n\nAnything that could not be delivered has been refunded to your card.\n${link}`;
  return sendMail(req.payer_email, { subject, html, text });
}

/** To the person who asked (only if they gave an email). Carries the tokens and the private link. */
export async function sendReceiverSummary(req: Record<string, any>, lines: PfmLine[]): Promise<boolean> {
  if (!req.receiver_email) return false;
  const link = `${appUrl()}/r/${req.id}?k=${req.receiver_key}`;
  const who = req.payer_name ? String(req.payer_name).split(" ")[0] : "Someone";
  const r = rows(lines, true);
  const subject = `${who} paid for you on Nolgic`;
  const html = shell({
    title: `${esc(who)} paid for you`,
    bodyHtml: `<p>${esc(who)} has paid <b>${naira(Number(req.amount_ngn))}</b> of bills for you. Here is where each one stands:</p>${r.html}
      <p style="color:#555">Keep this email. It is the safe place for your tokens.</p>${button(link, "Open your tokens")}`,
    footerHtml: "Don't share the button in this email: it opens your tokens.",
  });
  const text = `${who} has paid ${naira(Number(req.amount_ngn))} of bills for you:\n\n${r.text}\n\nOpen your tokens (private link): ${link}`;
  return sendMail(req.receiver_email, { subject, html, text });
}
