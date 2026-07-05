import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "StillHome — pay light, DSTV & airtime for family in Nigeria, from the UK",
  description:
    "Buy electricity tokens, DSTV, GOTV, airtime and data for family in Nigeria from the UK. See the account name before you pay. Instant delivery, WhatsApp receipts.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
