import type { Metadata } from "next";
export const metadata: Metadata = { title: "Make your bills link", robots: { index: false, follow: false }, alternates: { canonical: "/for/new" } };
export default function Layout({ children }: { children: React.ReactNode }) { return children; }
