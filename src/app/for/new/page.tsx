import Link from "next/link";
import { notFound } from "next/navigation";
import { payLinkReady } from "@/lib/paylink";
import NewLink from "./NewLink";

export const dynamic = "force-dynamic";

export default async function Page() {
  if (process.env.NEXT_PUBLIC_PAYFORME_ENABLED !== "1") notFound();
  const ready = await payLinkReady().catch(() => false);
  if (!ready) {
    return (
      <main id="content" className="max-w-xl mx-auto px-5 py-20 text-center">
        <h1 className="font-display font-extrabold text-3xl sm:text-4xl tracking-tight">Bills links are opening soon.</h1>
        <Link href="/#pay" className="mt-8 inline-flex items-center h-12 px-6 rounded-xl bg-cta text-oncta font-display font-bold">Pay a bill</Link>
      </main>
    );
  }
  return <NewLink />;
}
