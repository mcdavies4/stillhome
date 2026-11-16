// src/lib/order-status-mail.ts
// Plain emails to a naira customer when their payment is refunded or still being checked.
// Web customers otherwise hear nothing when a vend fails or an order is held: the success receipt
// is the only email they ever get. Never throws into the payment pipeline (sendMail never throws).

import { sendMail, shell, button, naira, esc, appUrl } from "@/lib/mailer";

type StatusOrder = {
  id: string;
  email?: string | null;
  biller_name: string | null;
  amount_ngn: number | string;
  service_fee_local?: number | string | null;
  currency?: string | null;
};

// Only naira orders. UK (GBP) orders keep their own emails.
const isNaira = (o: StatusOrder) => (o.currency ?? "NGN").toUpperCase() === "NGN";

function frame(o: StatusOrder, kind: "refunded" | "checking" | "refund_delayed") {
  const total = Number(o.amount_ngn) + Number(o.service_fee_local ?? 0);
  const ref = o.id.slice(0, 8);
  const item = o.biller_name || "your order";
  const copy = {
    refunded: {
      subject: `Nolgic refund — ${item} ${naira(total)}`,
      title: "Sorry, your payment has been refunded",
      body: `<p>We're sorry. We couldn't complete your <strong>${esc(item)}</strong> (order ${ref}). The bill provider we work with did not confirm the payment on their side, so the order could not go through. That is a problem we should have handled better, and we know it is frustrating when you have paid for something you needed.</p>
             <p>We've refunded <strong>${naira(total)}</strong> in full. Refunds can take a few working days to show on your statement. You don't need to do anything else.</p>
             <p>If you still need this bill paid, you can place the order again, and reply to this email if you'd like help with it.</p>
             ${button(`${appUrl()}/order/${o.id}`, "View your order")}`,
      text: `We're sorry. We couldn't complete your ${item} (order ${ref}). The bill provider we work with did not confirm the payment on their side, so the order could not go through. That is a problem we should have handled better.\n\nWe've refunded ${naira(total)} in full. Refunds can take a few working days to show on your statement. You don't need to do anything else.\n\nIf you still need this bill paid, you can place the order again, and reply to this email if you'd like help with it.`,
    },
    checking: {
      subject: `Nolgic — we're checking your ${item} order`,
      title: "We've received your payment",
      body: `<p>Your payment for <strong>${esc(item)}</strong> (order ${ref}) came through. We're confirming delivery now.</p>
             <p>You'll get either your confirmation or a full refund by email. Your money is safe.</p>
             ${button(`${appUrl()}/order/${o.id}`, "Check your order")}`,
      text: `We've received your payment for ${item} (order ${ref}). We're confirming delivery now. You'll get either your confirmation or a full refund by email.`,
    },
    refund_delayed: {
      subject: `Nolgic — your ${item} refund is being sorted`,
      title: "We're sorting out your refund",
      body: `<p>We couldn't complete <strong>${esc(item)}</strong> (order ${ref}), and the automatic refund didn't go through.</p>
             <p>We've been alerted and will refund you in full. If you don't hear from us within one working day, reply to this email with your order number.</p>`,
      text: `We couldn't complete ${item} (order ${ref}) and the automatic refund didn't go through. We've been alerted and will refund you in full. If you don't hear from us within one working day, reply with your order number.`,
    },
  }[kind];
  return {
    subject: copy.subject,
    html: shell({ title: copy.title, bodyHtml: copy.body }),
    text: copy.text,
  };
}

export async function sendOrderRefundEmail(o: StatusOrder): Promise<boolean> {
  if (!o.email || !isNaira(o)) return false;
  return sendMail(o.email, frame(o, "refunded"));
}

export async function sendOrderCheckingEmail(o: StatusOrder): Promise<boolean> {
  if (!o.email || !isNaira(o)) return false;
  return sendMail(o.email, frame(o, "checking"));
}

export async function sendOrderRefundDelayedEmail(o: StatusOrder): Promise<boolean> {
  if (!o.email || !isNaira(o)) return false;
  return sendMail(o.email, frame(o, "refund_delayed"));
}
