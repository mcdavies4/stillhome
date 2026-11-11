import Link from "next/link";
import { notFound } from "next/navigation";
import { payLinkReady } from "@/lib/paylink";
import { telegramUrl } from "@/lib/app-links";

export const dynamic = "force-dynamic";

// Built on Pay for Me, so it is hidden with it (NEXT_PUBLIC_PAYFORME_ENABLED) and waits for 0031_bills_link.sql.
export default async function Page() {
  if (process.env.NEXT_PUBLIC_PAYFORME_ENABLED !== "1") notFound();
  const ready = await payLinkReady().catch(() => false);
  if (!ready) {
    return (
      <main id="content" className="max-w-xl mx-auto px-5 py-20 text-center">
        <h1 className="font-display font-extrabold text-3xl sm:text-4xl tracking-tight">Bills links are opening soon.</h1>
        <p className="text-haze mt-4 leading-relaxed">We&rsquo;re finishing the last checks. You can still pay your own bills in the meantime.</p>
        <Link href="/#pay" className="mt-8 inline-flex items-center h-12 px-6 rounded-xl bg-cta text-oncta font-display font-bold">Pay a bill</Link>
      </main>
    );
  }
  const tg = telegramUrl("for");
  return (
    <main id="content" className="max-w-xl mx-auto px-5 pt-12 pb-24">
      <h1 className="font-display font-extrabold text-3xl sm:text-4xl leading-tight tracking-tight">Get your bills paid, without asking every time.</h1>
      <p className="mt-3 text-haze text-lg leading-relaxed">Keep one link for your light, TV, airtime and data. Send it to your family, your friends or anyone who looks out for you. They open it, choose what to pay and how much, and pay in naira. Nolgic delivers it straight to you.</p>

      <ol className="mt-8 space-y-4">
        {[
          ["Set it up once", "Add your meter, smartcard or phone number. We check the name with the provider so nobody pays into a wrong number."],
          ["Share your link", "Send it on WhatsApp or anywhere. Anyone can pay, with no account and nothing to download."],
          ["It arrives", "Your token or top-up is delivered in seconds. You get told who paid. If anything fails, the person who paid is refunded automatically."],
        ].map(([t, d]) => (
          <li key={t} className="rounded-2xl border border-line p-4">
            <p className="font-display font-bold">{t}</p>
            <p className="text-haze text-sm leading-relaxed mt-1">{d}</p>
          </li>
        ))}
      </ol>

      <div className="mt-8 rounded-2xl border border-line p-5">
        <p className="font-display font-bold">Your privacy</p>
        <p className="text-haze text-sm leading-relaxed mt-1.5">People see only the name you choose and the last four digits of your meter or number. Never the full number, and never the name on the account. You can pause or delete your link at any time.</p>
      </div>

      <div className="mt-8 flex flex-wrap gap-3">
        <Link href="/for/new" className="h-12 px-6 inline-flex items-center rounded-xl bg-cta text-oncta font-display font-bold hover:brightness-105" data-testid="make">Make my link</Link>
        {tg && <a href={tg} target="_blank" rel="noopener noreferrer" className="h-12 px-6 inline-flex items-center rounded-xl border border-paper/25 font-semibold hover:bg-sunk">Make it in Telegram</a>}
      </div>
    </main>
  );
}
