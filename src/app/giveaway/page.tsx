import Link from "next/link";
import { notFound } from "next/navigation";
import AskClient from "@/app/ask/AskClient";
import { payForMeReady } from "@/lib/payforme";

export const dynamic = "force-dynamic";

// Built on Pay for Me: the same list, checks, payment and per-item delivery, paid by the person who made the list.
// It is hidden with it (NEXT_PUBLIC_PAYFORME_ENABLED) and waits for the same database setup (0023_pay_for_me.sql).
export default async function Page() {
  if (process.env.NEXT_PUBLIC_PAYFORME_ENABLED !== "1") notFound();
  const ready = await payForMeReady().catch(() => false);
  if (!ready) {
    return (
      <main id="content" className="max-w-xl mx-auto px-5 py-20 text-center">
        <h1 className="font-display font-extrabold text-3xl sm:text-4xl tracking-tight">Giveaways are opening soon.</h1>
        <p className="text-haze mt-4 leading-relaxed">We&rsquo;re finishing the last checks. You can still send a gift to one person in the meantime.</p>
        <Link href="/gift" className="mt-8 inline-flex items-center h-12 px-6 rounded-xl bg-cta text-oncta font-display font-bold">Send a gift</Link>
      </main>
    );
  }
  return <AskClient mode="giveaway" />;
}
