import type { Metadata } from "next";
import AdminNavGate from "@/components/AdminNavGate";
export const metadata: Metadata = { title: "Admin", robots: { index: false, follow: false }, alternates: { canonical: null } };
export default function Layout({ children }: { children: React.ReactNode }) {
  return (<><AdminNavGate />{children}</>);
}
