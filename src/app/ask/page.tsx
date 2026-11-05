import Link from "next/link";
import { notFound } from "next/navigation";
import AskClient from "./AskClient";
import { payForMeReady } from "@/lib/payforme";

export const dynamic = "force-dynamic";

// Hidden until NEXT_PUBLIC_PAYFORME_ENABLED=1 (then redeploy). Even when it is on, the form only opens once the
// database is set up (supabase/migrations/0023_pay_for_me.sql); until then people see a calm "opening soon".
export default async function Page() {
  if (process.env.NEXT_PUBLIC_PAYFORME_ENABLED !== "1") notFound();
  const ready = await payForMeReady().catch(() => false);
  if (!ready) {
    return (
      <main id="content" className="max-w-xl mx-auto px-5 py-20 text-center">
        <h1 className="font-display font-extrabold text-3xl sm:text-4xl tracking-tight">Ask someone to pay is opening soon.</h1>
        <p className="text-haze mt-4 leading-relaxed">We&rsquo;re finishing the last checks. You can still pay your own bills in the meantime.</p>
        <Link href="/#pay" className="mt-8 inline-flex items-center h-12 px-6 rounded-xl bg-cta text-oncta font-display font-bold">Pay a bill</Link>
      </main>
    );
  }
  return <AskClient />;
}
