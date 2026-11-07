import type { Metadata } from "next";
import { notFound } from "next/navigation";

export const metadata: Metadata = {
  title: "A giveaway for you: choose your light, airtime, data or TV",
  description: "Pick what you want and enter your number. Nothing for you to pay.",
  robots: { index: false, follow: false },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  if (process.env.NEXT_PUBLIC_PAYFORME_ENABLED !== "1") notFound();
  return children;
}
