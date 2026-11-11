import type { MetadataRoute } from "next";

const BASE = process.env.NEXT_PUBLIC_APP_URL ?? "https://stillhome-ten.vercel.app";

export default function sitemap(): MetadataRoute.Sitemap {
  const pages: MetadataRoute.Sitemap = [
    { url: `${BASE}/`, lastModified: new Date(), changeFrequency: "weekly", priority: 1 },
  ];
  if (process.env.NEXT_PUBLIC_BULK_ENABLED === "1") pages.push({ url: `${BASE}/bulk`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.6 });
  if (process.env.NEXT_PUBLIC_EXAMS_ENABLED === "1") pages.push({ url: `${BASE}/exams`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.6 });
  if (process.env.NEXT_PUBLIC_PAYFORME_ENABLED === "1") pages.push({ url: `${BASE}/ask`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.6 }, { url: `${BASE}/for`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.6 }, { url: `${BASE}/giveaway`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.6 }, { url: `${BASE}/giveaway/link`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.5 });
  pages.push(
    { url: `${BASE}/gift`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.6 },
    { url: `${BASE}/proof`, lastModified: new Date(), changeFrequency: "weekly", priority: 0.5 },
    { url: `${BASE}/find-order`, lastModified: new Date(), changeFrequency: "yearly", priority: 0.3 },
    { url: `${BASE}/legal`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.3 },
  );
  return pages;
}
