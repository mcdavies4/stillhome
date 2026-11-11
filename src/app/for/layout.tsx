import type { Metadata } from "next";
export const metadata: Metadata = {
  title: "Get your bills paid by friends and family",
  description: "Keep one link for your light, TV, airtime and data. Anyone you send it to can pay in naira, and Nolgic delivers it to you.",
  alternates: { canonical: "/for" },
};
export default function Layout({ children }: { children: React.ReactNode }) { return children; }
