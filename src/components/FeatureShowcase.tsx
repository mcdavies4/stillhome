// The things Nolgic does beyond paying one bill, shown big on the home page so people actually notice them.
// Each card only appears when its own switch is on in Vercel (a feature that isn't open never shows).

const PFM = process.env.NEXT_PUBLIC_PAYFORME_ENABLED === "1";
const EXAMS = process.env.NEXT_PUBLIC_EXAMS_ENABLED === "1";
const BULK = process.env.NEXT_PUBLIC_BULK_ENABLED === "1";

type Card = {
  key: string;
  eyebrow: string;
  title: string;
  text: string;
  steps: string[];
  actions: { href: string; label: string; primary?: boolean }[];
  icon: JSX.Element;
  fresh?: boolean;
};

const I = {
  link: (<><path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /><path d="M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></>),
  people: (<><circle cx="9" cy="8" r="3" fill="none" stroke="currentColor" strokeWidth="2" /><circle cx="17" cy="9.5" r="2.4" fill="none" stroke="currentColor" strokeWidth="2" /><path d="M3.5 19c0-3 2.5-5 5.5-5s5.5 2 5.5 5M15.5 14.3c3 0 5 1.6 5 4.2" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></>),
  exam: (<><path d="M3 9l9-4.5L21 9l-9 4.5L3 9z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /><path d="M7 11v4.5c0 1.4 2.2 2.5 5 2.5s5-1.1 5-2.5V11M21 9v5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></>),
  gift: (<><rect x="3.5" y="8.5" width="17" height="4" rx="1" fill="none" stroke="currentColor" strokeWidth="2" /><path d="M5 12.5V20h14v-7.5M12 8.5V20M12 8.5C10 8.5 8 7.5 8 6a2 2 0 013-1.7c.7.5 1 1.7 1 4.2zM12 8.5c2 0 4-1 4-2.5a2 2 0 00-3-1.7c-.7.5-1 1.7-1 4.2z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /></>),
  bulk: (<><rect x="3" y="7" width="9" height="14" rx="2" fill="none" stroke="currentColor" strokeWidth="2" /><rect x="12" y="3" width="9" height="14" rx="2" fill="none" stroke="currentColor" strokeWidth="2" /></>),
};

const CARDS: Card[] = [
  PFM && {
    key: "ask", eyebrow: "For family abroad", fresh: true,
    title: "Ask someone to pay",
    text: "List what you need (light, TV, airtime, data" + (EXAMS ? ", exam PINs" : "") + "), send one link on WhatsApp, and a relative anywhere pays by card. Your tokens land in seconds.",
    steps: ["Make your list", "Send one link", "They pay, you get your tokens"],
    actions: [{ href: "/ask", label: "Make my link", primary: true }],
    icon: I.link,
  },
  PFM && {
    key: "give", eyebrow: "For hosts, churches, brands and birthdays", fresh: true,
    title: "Run a giveaway",
    text: "Gift many people at once and pay once. Don't have everyone's numbers? Share one link: each person picks their own bill and enters their own number, you check the list, then pay.",
    steps: ["Share one link", "Everyone picks theirs", "You pay once, each is delivered"],
    actions: [{ href: "/giveaway/link", label: "Send a link, let them choose", primary: true }, { href: "/giveaway", label: "I have their numbers" }],
    icon: I.people,
  },
  EXAMS && {
    key: "exams", eyebrow: "For students and parents", fresh: true,
    title: "JAMB and WAEC PINs",
    text: "Buy exam PINs in seconds, or let a parent or sponsor pay from anywhere. Schools and sponsors can cover a whole class with one giveaway link.",
    steps: ["Pick the PIN", "Enter the profile code or phone", "PIN arrives in seconds"],
    actions: [{ href: "/exams", label: "Buy a PIN", primary: true }, ...(PFM ? [{ href: "/ask", label: "Ask a parent to pay" }] : [])],
    icon: I.exam,
  },
].filter(Boolean) as Card[];

const SMALL = [
  { href: "/gift", title: "Send a gift", text: "Pay their light or TV before they ask, with your own message.", icon: I.gift },
  BULK && { href: "/bulk", title: "Bulk airtime", text: "Top up many numbers in one go, for staff or events.", icon: I.bulk },
].filter(Boolean) as { href: string; title: string; text: string; icon: JSX.Element }[];

/** The strip above the hero headline: the newest thing, one tap away. */
export function NewStrip() {
  if (!PFM) return null;
  return (
    <a href="/giveaway/link" data-testid="new-strip"
      className="inline-flex max-w-full items-center gap-2 rounded-2xl sm:rounded-full border border-tungsten/40 bg-cta/10 pl-1.5 pr-3 py-1.5 text-sm leading-snug hover:bg-cta/20 mb-5">
      <span className="shrink-0 rounded-full bg-cta text-oncta text-[11px] font-display font-bold uppercase tracking-wide px-2 py-0.5">New</span>
      <span><span className="font-semibold">Giveaway links:</span> share one link, everyone picks their own bill</span>
      <span aria-hidden="true" className="shrink-0">→</span>
    </a>
  );
}

export default function FeatureShowcase() {
  if (!CARDS.length && !SMALL.length) return null;
  return (
    <section id="more" className="scroll-mt-20" aria-labelledby="more-title">
      <div className="max-w-6xl mx-auto px-5 pb-16 sm:pb-24">
        <p className="text-sm font-semibold text-tungsten uppercase tracking-wide">More than paying a bill</p>
        <h2 id="more-title" className="font-display font-bold text-3xl md:text-[2.6rem] leading-[1.08] tracking-tight max-w-3xl mt-2">
          Pay for the people you care about, even when you&rsquo;re far away.
        </h2>

        {CARDS.length > 0 && (
          <div className={`mt-10 grid gap-4 ${CARDS.length >= 3 ? "lg:grid-cols-3" : CARDS.length === 2 ? "md:grid-cols-2" : ""}`}>
            {CARDS.map((c) => (
              <article key={c.key} className="relative flex flex-col rounded-3xl border border-line bg-panel shadow-card p-5 sm:p-6" data-testid={`feature-${c.key}`}>
                <div className="flex items-start justify-between gap-3">
                  <span className="w-12 h-12 rounded-2xl bg-cta text-oncta flex items-center justify-center">
                    <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">{c.icon}</svg>
                  </span>
                  {c.fresh && <span className="rounded-full bg-ok/15 text-ok text-xs font-display font-bold uppercase tracking-wide px-2.5 py-1">New</span>}
                </div>
                <p className="text-sm text-haze mt-4">{c.eyebrow}</p>
                <h3 className="font-display font-bold text-2xl leading-tight mt-1">{c.title}</h3>
                <p className="text-haze leading-relaxed mt-2">{c.text}</p>
                <ol className="mt-4 space-y-2">
                  {c.steps.map((s, n) => (
                    <li key={s} className="flex items-center gap-2.5 text-[15px]">
                      <span className="shrink-0 w-6 h-6 rounded-full bg-sunk text-paper text-xs font-display font-bold flex items-center justify-center num">{n + 1}</span>
                      {s}
                    </li>
                  ))}
                </ol>
                <div className="mt-auto pt-5 flex flex-wrap gap-2">
                  {c.actions.map((a) => (
                    <a key={a.href + a.label} href={a.href}
                      className={a.primary
                        ? "h-11 px-5 inline-flex items-center rounded-xl bg-cta text-oncta font-display font-bold hover:brightness-105"
                        : "h-11 px-4 inline-flex items-center rounded-xl border border-paper/25 font-semibold hover:bg-sunk"}>
                      {a.label}
                    </a>
                  ))}
                </div>
              </article>
            ))}
          </div>
        )}

        {SMALL.length > 0 && (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {SMALL.map((x) => (
              <a key={x.href} href={x.href} className="flex gap-3.5 items-center rounded-2xl border border-line bg-panel p-4 hover:border-paper/40">
                <span className="shrink-0 w-11 h-11 rounded-2xl bg-sunk text-tungsten flex items-center justify-center">
                  <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">{x.icon}</svg>
                </span>
                <span>
                  <span className="block font-display font-bold text-lg leading-snug">{x.title}</span>
                  <span className="block text-haze text-[15px] leading-relaxed mt-0.5">{x.text}</span>
                </span>
                <span aria-hidden="true" className="ml-auto text-haze">→</span>
              </a>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
