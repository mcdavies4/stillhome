import Link from "next/link";
import GiftAsk from "./GiftAsk";
import { GIFTS, type GiftKey } from "@/lib/gift";

export const metadata = {
  title: "Send light, airtime, data or TV as a gift",
  description: "Surprise someone with paid-up light, airtime, data or TV, before they have to ask. See the name on the meter first, add a message, send it on WhatsApp.",
  alternates: { canonical: "/gift" },
};

const ORDER: GiftKey[] = ["electricity", "airtime", "data", "cable"];

const ICONS: Record<GiftKey, JSX.Element> = {
  electricity: <path d="M13 2L5 13.5h6L10 22l9-12.5h-6z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />,
  airtime: (<><rect x="7" y="2.5" width="10" height="19" rx="2.5" fill="none" stroke="currentColor" strokeWidth="2" /><path d="M11 18.5h2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></>),
  data: (<><path d="M4 9.5a12 12 0 0116 0M7 13a7.5 7.5 0 0110 0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /><circle cx="12" cy="17.5" r="1.4" fill="currentColor" /></>),
  cable: (<><rect x="3" y="5" width="18" height="12" rx="2" fill="none" stroke="currentColor" strokeWidth="2" /><path d="M8 21h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></>),
};

const STEPS = [
  { title: "Get their meter or number", text: "Ask them, or tap the button below and we write the message for you. A bill from last month has the meter number on it too." },
  { title: "Check the name, then pay", text: "We look the meter or decoder up and show who it belongs to before any money moves. Pay by card, bank transfer or USSD." },
  { title: "Send it on WhatsApp", text: "Add a line of your own. The token and your message are ready to send in one tap, from your own WhatsApp." },
];

export default function GiftPage() {
  return (
    <main id="content" className="max-w-3xl mx-auto px-5 pt-10 sm:pt-16 pb-20">
      <h1 className="font-display font-extrabold text-[2.5rem] sm:text-6xl leading-[1.03] tracking-tight max-w-[14ch]">Send light before they ask.</h1>
      <p className="text-haze mt-5 text-lg leading-relaxed max-w-[34rem]">
        Pay for someone&rsquo;s electricity, airtime, data or TV and let them find it already done. You see the name on the meter first, add your own message, and tell them on WhatsApp.
      </p>

      <div className="mt-9 grid gap-3 sm:grid-cols-2">
        {ORDER.map((k) => (
          <Link key={k} href={`/?gift=${k}#pay`} className="group flex gap-3.5 items-start rounded-2xl border border-line bg-panel shadow-card p-4 sm:p-5 hover:border-paper/40" data-testid={`gift-${k}`}>
            <span className="shrink-0 w-11 h-11 rounded-2xl bg-cta text-oncta flex items-center justify-center">
              <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">{ICONS[k]}</svg>
            </span>
            <span>
              <span className="block font-display font-bold text-lg leading-snug">{GIFTS[k].title}</span>
              <span className="block text-haze text-[15px] leading-relaxed mt-0.5">{GIFTS[k].line}</span>
            </span>
          </Link>
        ))}
      </div>

      <h2 className="font-display font-bold text-2xl mt-14">How a gift works</h2>
      <ol className="mt-5 grid gap-5">
        {STEPS.map((s, i) => (
          <li key={s.title} className="flex gap-3.5">
            <span className="mt-0.5 shrink-0 w-7 h-7 rounded-full bg-cta text-oncta font-display font-bold text-sm flex items-center justify-center" aria-hidden="true">{i + 1}</span>
            <span>
              <span className="block font-display font-bold text-[17px] leading-snug">{s.title}</span>
              <span className="block text-haze text-[15px] leading-relaxed mt-0.5">{s.text}</span>
            </span>
          </li>
        ))}
      </ol>

      {process.env.NEXT_PUBLIC_PAYFORME_ENABLED === "1" && (
        <Link href="/giveaway" className="mt-3 flex gap-3.5 items-start rounded-2xl border border-line bg-panel shadow-card p-4 sm:p-5 hover:border-paper/40" data-testid="gift-giveaway">
          <span className="shrink-0 w-11 h-11 rounded-2xl bg-cta text-oncta flex items-center justify-center">
            <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3" fill="none" stroke="currentColor" strokeWidth="2" /><circle cx="17" cy="9.5" r="2.4" fill="none" stroke="currentColor" strokeWidth="2" /><path d="M3.5 19c0-3 2.5-5 5.5-5s5.5 2 5.5 5M15.5 14.3c3 0 5 1.6 5 4.2" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
          </span>
          <span>
            <span className="block font-display font-bold text-lg leading-snug">Giving to several people?</span>
            <span className="block text-haze text-[15px] leading-relaxed mt-0.5">Run a giveaway: pay once, and each person is delivered separately.</span>
          </span>
        </Link>
      )}

      <div className="mt-12"><GiftAsk /></div>

      <p className="text-haze text-sm leading-relaxed mt-10">
        If delivery fails you are refunded in full, automatically. Once a token or top-up is delivered it cannot be moved to another meter or number, so check the name before you pay. Nolgic sells the product; it does not send money to anyone.
      </p>
    </main>
  );
}
