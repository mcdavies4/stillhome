import type { Metadata } from "next";
export const metadata: Metadata = { title: "Tell us what happened", robots: { index: false, follow: false }, alternates: { canonical: null } };
export default function Layout({ children }: { children: React.ReactNode }) { return children; }
