import Link from "next/link";
import { getProof, type ProofWindow } from "@/lib/proof";

export const metadata = {
  title: "Proof: how many orders we delivered",
  description: "Live numbers from Nolgic's own order records: orders delivered, failed orders refunded, and anything we are still fixing by hand.",
  alternates: { canonical: "/proof" },
};
export const dynamic = "force-dynamic";

const naira = (n: number) => `₦${Math.round(n).toLocaleString("en-NG")}`;
const num = (n: number) => n.toLocaleString("en-NG");
const when = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Africa/Lagos" });
const time = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Lagos" });

function Tile({ big, label }: { big: string; label: string }) {
  return (
    <div className="rounded-2xl border border-line bg-sunk p-4">
      <p className="num font-display font-extrabold text-2xl sm:text-3xl leading-none">{big}</p>
      <p className="text-haze text-sm mt-2 leading-snug">{label}</p>
    </div>
  );
}

function Block({ title, w }: { title: string; w: ProofWindow }) {
  return (
    <section className="mt-10" aria-label={title}>
      <h2 className="font-display font-bold text-xl">{title}</h2>
      {w.resolved === 0 && w.inProgress === 0 ? (
        <p className="text-haze mt-2">No paid orders in this period yet.</p>
      ) : (
        <>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <Tile big={num(w.delivered)} label={`orders delivered, worth ${naira(w.deliveredNgn)} of bills and airtime`} />
            <Tile big={w.ratePct === null ? "–" : `${w.ratePct}%`} label={`of finished paid orders were delivered (${num(w.delivered)} of ${num(w.resolved)})`} />
            <Tile big={num(w.refunded)} label="could not be delivered and were refunded in full" />
            <Tile big={num(w.inProgress)} label="paid and still being delivered or checked" />
          </div>
          {w.byHand > 0 && (
            <p className="mt-3 text-sm leading-relaxed"><strong>{num(w.byHand)}</strong> failed {w.byHand === 1 ? "order's" : "orders'"} automatic refund did not go through. We are refunding {w.byHand === 1 ? "it" : "them"} by hand and have been told about {w.byHand === 1 ? "it" : "each one"}. They are counted as not delivered.</p>
          )}
        </>
      )}
    </section>
  );
}

export default async function Proof() {
  const p = await getProof();
  return (
    <main id="content" className="max-w-xl mx-auto px-5 pt-12 pb-24 leading-relaxed">
      <h1 className="font-display font-extrabold text-3xl sm:text-4xl leading-tight tracking-tight">Did it arrive? Here are the numbers.</h1>
      <p className="text-haze text-lg mt-3">These come straight from our own order records. We do not edit them. Every figure counts real paid orders only, never tests and never checkouts that were not paid.</p>

      {!p ? (
        <p className="mt-8 text-haze" role="status">We can&rsquo;t load the numbers right now. Please try again in a few minutes.</p>
      ) : (
        <>
          <Block title="Last 30 days" w={p.last30} />
          <Block title={p.firstOrderAt ? `Since we started (${when(p.firstOrderAt)})` : "Since we started"} w={p.all} />

          {p.bulk && (
            <section className="mt-10" aria-label="Bulk airtime">
              <h2 className="font-display font-bold text-xl">Bulk airtime</h2>
              <p className="text-haze mt-2">{num(p.bulk.batches)} {p.bulk.batches === 1 ? "batch" : "batches"} finished: <span className="num text-paper font-semibold">{num(p.bulk.numbersDelivered)}</span> numbers received airtime{p.bulk.numbersFailed > 0 ? `, and the ${num(p.bulk.numbersFailed)} that did not were refunded` : ""}.</p>
            </section>
          )}

          <section className="mt-10">
            <h2 className="font-display font-bold text-xl">What we do when something fails</h2>
            <ul className="mt-2 space-y-2 text-haze list-disc pl-5">
              <li>We only take a payment as paid after the payment company confirms it to us directly.</li>
              <li>If the bill can&rsquo;t be delivered, the payment goes back to you in full, automatically. You get an email either way.</li>
              <li>If we are not sure what happened, we check it by hand. We never guess and never deliver twice.</li>
              <li>If your bank debited you but the payment never reached us, your bank reverses it, usually within 24 hours.</li>
            </ul>
            <p className="text-haze text-sm mt-4">Refunds take a few business days to show in your bank. Full terms are in our <Link href="/legal" className="underline">refund policy</Link>. Missing something? <Link href="/find-order" className="underline">Find your order</Link>.</p>
          </section>

          <p className="text-haze text-xs mt-10">Updated {time(p.generatedAt)} (Nigerian time). Refreshes every 5 minutes.</p>
        </>
      )}
    </main>
  );
}
