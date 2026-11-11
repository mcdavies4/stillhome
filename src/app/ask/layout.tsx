import type { Metadata } from "next";
export const metadata: Metadata = {
  title: "Ask someone to pay",
  description: "Need light, DStv, airtime or data paid for? Make a list, send one link, and a friend or relative pays it in naira.",
  alternates: { canonical: "/ask" },
};
export default function Layout({ children }: { children: React.ReactNode }) { return children; }
