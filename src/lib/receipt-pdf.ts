// src/lib/receipt-pdf.ts
// A one-page PDF receipt for a finished order. Built with pdf-lib (already a dependency).
// Plain Helvetica text only, so every character is one the standard font can draw (no ₦ symbol: "NGN" is written instead).
// The meter / smartcard / phone number is masked to its last four digits, because receipts get forwarded.

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

export interface ReceiptOrder {
  id: string;
  status: string;
  biller_name: string;
  identifier: string;
  identifier_label?: string | null;
  customer_name?: string | null;
  amount_ngn: number;
  service_fee_local?: number | null;
  flw_token?: string | null;
  flw_reference?: string | null;
  created_at: string;
}

const money = (n: number) => `NGN ${Math.round(Number(n) || 0).toLocaleString("en-NG")}`;
const mask = (s: string) => (s.length <= 4 ? s : "*".repeat(s.length - 4) + s.slice(-4));
const STATUS_TEXT: Record<string, string> = {
  fulfilled: "Delivered",
  failed_refunded: "Not delivered. Refunded in full.",
  refunded: "Refunded in full",
};

export async function buildReceiptPdf(o: ReceiptOrder): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([420, 595]);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const ink = rgb(0.08, 0.09, 0.17);
  const mute = rgb(0.4, 0.42, 0.5);
  let y = 540;

  const line = (label: string, value: string, f = font, size = 10) => {
    page.drawText(label, { x: 40, y, size: 10, font, color: mute });
    page.drawText(value, { x: 180, y, size, font: f, color: ink, maxWidth: 220 });
    y -= 22;
  };

  page.drawText("Nolgic", { x: 40, y, size: 22, font: bold, color: ink });
  y -= 18;
  page.drawText("Receipt", { x: 40, y, size: 11, font, color: mute });
  y -= 36;

  line("Order", o.id.slice(0, 8).toUpperCase());
  line("Date", new Date(o.created_at).toUTCString().replace(" GMT", " UTC"));
  line("Service", o.biller_name);
  line(o.identifier_label || "Number", mask(o.identifier));
  if (o.customer_name) line("Account name", o.customer_name);
  y -= 8;
  line("Amount", money(o.amount_ngn));
  line("Service fee", money(o.service_fee_local ?? 0));
  line("Total", money(Number(o.amount_ngn) + Number(o.service_fee_local ?? 0)), bold);
  y -= 8;
  line("Status", STATUS_TEXT[o.status] ?? o.status);
  if (o.flw_token) line("Token", o.flw_token.replace(/\s+/g, "").replace(/(.{4})/g, "$1 ").trim());
  if (o.flw_reference) line("Reference", o.flw_reference, font, 8);

  y -= 30;
  const note = [
    "Nolgic is operated by The 36th Solutions Ltd, Abuja, Nigeria (RC 9440452).",
    "Questions about this order: nolgichq@gmail.com. Quote the order number above.",
  ];
  for (const t of note) {
    page.drawText(t, { x: 40, y, size: 8.5, font, color: mute, maxWidth: 340 });
    y -= 13;
  }
  return doc.save();
}
