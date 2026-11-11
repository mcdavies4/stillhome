import type { Metadata } from "next";
// The owner's private page. The secret is in the address, so keep it out of search results and out of Referer headers.
export const metadata: Metadata = { title: "Your bills link", robots: { index: false, follow: false }, referrer: "no-referrer", alternates: { canonical: null } };
export default function Layout({ children }: { children: React.ReactNode }) { return children; }
