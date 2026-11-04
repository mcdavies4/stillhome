import type { Metadata } from "next";
export const metadata: Metadata = {
  title: "Bulk airtime",
  description: "Send airtime to many Nigerian phone numbers in one payment. MTN, Airtel, Glo and 9mobile. Pay in naira.",
  alternates: { canonical: "/bulk" },
};
export default function Layout({ children }: { children: React.ReactNode }) { return children; }
