import type { Metadata } from "next";
export const metadata: Metadata = {
  title: "Find your order",
  description: "Lost your meter token or receipt? Enter the email you paid with and we will email your recent Nolgic orders.",
  alternates: { canonical: "/find-order" },
};
export default function Layout({ children }: { children: React.ReactNode }) { return children; }
