import type { Metadata } from "next";
export const metadata: Metadata = {
  title: "Run a giveaway: light, airtime, data or TV for many people",
  description: "Pick what each person gets, pay once, and every person is delivered separately. Send each winner their token or confirmation on WhatsApp.",
  alternates: { canonical: "/giveaway" },
};
export default function Layout({ children }: { children: React.ReactNode }) { return children; }
