import Link from "next/link";
import { notFound } from "next/navigation";
import { payForMeReady } from "@/lib/payforme";
import { collectReady } from "@/lib/payforme-collect";
import LinkCreate from "./LinkCreate";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Giveaway link: let each person choose their light, airtime, data or TV",
  description: "Share one link. Each person picks what they want and enters their own number. You check the list and pay once for everyone.",
  alternates: { canonical: "/giveaway/link" },
};

// Switched on and off with Pay for Me (NEXT_PUBLIC_PAYFORME_ENABLED). Needs 0023 and 0025 in the database.
export default async function Page() {
  if (process.env.NEXT_PUBLIC_PAYFORME_ENABLED !== "1") notFound();
  const ready = (await payForMeReady().catch(() => false)) && (await collectReady().catch(() => false));
  if (!ready) {
    return (
      <main id="content" className="max-w-xl mx-auto px-5 py-20 text-center">
        <h1 className="font-display font-extrabold text-3xl sm:text-4xl tracking-tight">Giveaway links are opening soon.</h1>
        <p className="text-haze mt-4 leading-relaxed">If you already have everyone&rsquo;s numbers, you can run a giveaway now.</p>
        <Link href="/giveaway" className="mt-8 inline-flex items-center h-12 px-6 rounded-xl bg-cta text-oncta font-display font-bold">Run a giveaway</Link>
      </main>
    );
  }
  return <LinkCreate />;
}
