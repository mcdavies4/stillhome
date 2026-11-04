import type { Metadata } from "next";
// A private order page: never indexed, never shown as a duplicate of /bulk.
export const metadata: Metadata = { title: "Your bulk order", robots: { index: false, follow: false }, alternates: { canonical: null } };
export default function Layout({ children }: { children: React.ReactNode }) { return children; }
