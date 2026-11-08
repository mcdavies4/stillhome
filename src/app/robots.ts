import type { MetadataRoute } from "next";

const BASE = process.env.NEXT_PUBLIC_APP_URL ?? "https://stillhome-ten.vercel.app";

export default function robots(): MetadataRoute.Robots {
  return {
    // Private pages (one per order, reminder or feedback link) and the admin are never indexed.
    rules: [{ userAgent: "*", allow: "/", disallow: ["/order/", "/bulk/", "/exams/", "/reminders/", "/feedback/", "/r/", "/api/", "/admin"] }],
    sitemap: `${BASE}/sitemap.xml`,
  };
}
