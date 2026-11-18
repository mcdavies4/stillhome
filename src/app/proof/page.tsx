// /proof — public delivery numbers. Counts of real, non-test orders only. Nothing is estimated.
import type { Metadata } from "next";
import Link from "next/link";
import { supabaseAdmin } from "@/lib/supabase";

export const metadata: Metadata = {
  title: "Proof: delivery numbers | Nolgic",
  description: "How many bill payments Nolgic has delivered, and how many failed payments were refunded automatically.",
  alternates: { canonical: "/proof" },
};
export const dynamic = "force-dynamic";

const count = async (filter: (q: any) => any) => {
  try {
    const q = supabaseAdmin().from("orders").select("id", { count: "exact", head: true }).eq("is_test", false);
    const { count: n, error } = await filter(q);
    return error ? null : (n ?? 0);
  } catch {
    return null;
  }
};

export default async function ProofPage() {
  const since30 = new Date(Date.now() - 30 * 24 * 3600_000).toISOString();
  const [delivered, delivered30, refunded] = await Promise.all([
    count((q) => q.eq("status", "fulfilled")),
    count((q) => q.eq("status", "fulfilled").gte("created_at", since30)),
    count((q) => q.in("status", ["failed_refunded", "refunded"])),
  ]);
  const fmt = (n: number | null) => (n === null ? "—" : n.toLocaleString("en-NG"));

  return (
    <main id="content" className="max-w-3xl mx-auto px-5 pt-10 pb-24">
      <h1 className="font-display font-bold text-3xl">Proof: delivery numbers</h1>
      <p className="mt-3 text-haze leading-relaxed">
        These are counts from our order records. Test orders are left out. We don&rsquo;t round them up or estimate them.
      </p>

      <div className="mt-8 grid grid-cols-1 sm:grid-cols-3 gap-3">
        {[
          ["Bills delivered, all time", fmt(delivered)],
          ["Bills delivered, last 30 days", fmt(delivered30)],
          ["Failed payments refunded automatically", fmt(refunded)],
        ].map(([k, v]) => (
          <div key={k} className="rounded-2xl border border-line bg-panel p-5">
            <div className="text-sm text-haze">{k}</div>
            <div className="font-display font-bold text-3xl mt-2">{v}</div>
          </div>
        ))}
      </div>

      <h2 className="font-display font-bold text-xl mt-10">How to check one yourself</h2>
      <p className="mt-2 text-haze leading-relaxed">
        Every paid order has its own page, with the token or delivery reference when it&rsquo;s available. Use <Link href="/find-order" className="underline underline-offset-4">find an order</Link> with the email you paid with.
      </p>
    </main>
  );
}
