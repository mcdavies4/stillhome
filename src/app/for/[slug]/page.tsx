import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getPublicLink, payLinkReady } from "@/lib/paylink";
import PayClient from "./PayClient";

export const dynamic = "force-dynamic";

// A private link between people: never in search results. The title is what WhatsApp shows in the preview.
export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const base: Metadata = { robots: { index: false, follow: false }, alternates: { canonical: null } };
  try {
    if (process.env.NEXT_PUBLIC_PAYFORME_ENABLED === "1") {
      const v = await Promise.race([getPublicLink(params.slug), new Promise<null>((r) => setTimeout(() => r(null), 2500))]);
      if (v && v.active) return { ...base, title: `Pay ${v.ownerName}'s bills`, description: "Choose what to pay and how much. Light, TV, airtime or data, paid in naira and delivered in seconds." };
    }
  } catch { /* plain title */ }
  return { ...base, title: "Pay a bill for a friend" };
}

export default async function Page({ params }: { params: { slug: string } }) {
  if (process.env.NEXT_PUBLIC_PAYFORME_ENABLED !== "1") notFound();
  if (!(await payLinkReady().catch(() => false))) notFound();
  const link = await getPublicLink(params.slug).catch(() => null);
  if (!link) notFound();
  if (!link.active) {
    return (
      <main id="content" className="max-w-xl mx-auto px-5 py-20 text-center">
        <h1 className="font-display font-extrabold text-3xl tracking-tight">{link.ownerName} has paused this link.</h1>
        <p className="text-haze mt-4 leading-relaxed">Nothing was charged. You can pay your own bills any time.</p>
        <Link href="/#pay" className="mt-8 inline-flex items-center h-12 px-6 rounded-xl bg-cta text-oncta font-display font-bold">Pay a bill</Link>
      </main>
    );
  }
  return <PayClient link={link} />;
}
