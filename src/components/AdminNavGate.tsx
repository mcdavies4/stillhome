"use client";

import { usePathname } from "next/navigation";
import AdminNav from "./AdminNav";

// Shows the admin menu on every admin page except Partners, which has its own dark console and draws the menu itself.
export default function AdminNavGate() {
  const path = usePathname() ?? "";
  if (path.startsWith("/admin/partners")) return null;
  return <AdminNav />;
}
