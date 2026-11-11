// The ways to pay a bill together, shown on the home page as small tickets so people see what each one is for.
// Each card only appears when its own switch is on in Vercel (a feature that isn't open never shows):
//   NEXT_PUBLIC_PAYFORME_ENABLED  Ask someone to pay, giveaways
//   NEXT_PUBLIC_BILLSLINK_ENABLED bills links (also needs supabase/migrations/0031_bills_link.sql)
// The quick "pay a bill now" card at the top of the page is a separate section and is not touched by this one.

const PFM = process.env.NEXT_PUBLIC_PAYFORME_ENABLED === "1";
const BILLS = PFM && process.env.NEXT_PUBLIC_BILLSLINK_ENABLED === "1";
const EXAMS = process.env.NEXT_PUBLIC_EXAMS_ENABLED === "1";
const BULK = process.env.NEXT_PUBLIC_BULK_ENABLED === "1";

const I = {
  link: (<><path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /><path d="M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></>),
  send: (<path d="M4 12l16-8-6 16-3-7-7-1z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />),
  people: (<><circle cx="9" cy="8" r="3" fill="none" stroke="currentColor" strokeWidth="2" /><circle cx="17" cy="9.5" r="2.4" fill="none" stroke="currentColor" strokeWidth="2" /><path d="M3.5 19c0-3 2.5-5 5.5-5s5.5 2 5.5 5M15.5 14.3c3 0 5 1.6 5 4.2" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></>),
  exam: (<><path d="M3 9l9-4.5L21 9l-9 4.5L3 9z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /><path d="M7 11v4.5c0 1.4 2.2 2.5 5 2.5s5-1.1 5-2.5V11M21 9v5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></>),
  gift: (<><rect x="3.5" y="8.5" width="17" height="4" rx="1" fill="none" stroke="currentColor" strokeWidth="2" /><path d="M5 12.5V20h14v-7.5M12 8.5V20M12 8.5C10 8.5 8 7.5 8 6a2 2 0 013-1.7c.7.5 1 1.7 1 4.2zM12 8.5c2 0 4-1 4-2.5a2 2 0 00-3-1.7c-.7.5-1 1.7-1 4.2z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /></>),
  bulk: (<><rect x="3" y="7" width="9" height="14" rx="2" fill="none" stroke="currentColor" strokeWidth="2" /><rect x="12" y="3" width="9" height="14" rx="2" fill="none" stroke="currentColor" strokeWidth="2" /></>),
};

const Chip = ({ icon, tone = "cta" }: { icon: JSX.Element; tone?: "cta" | "sunk" }) => (
  <span className={`w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 ${tone === "cta" ? "bg-cta text-oncta" : "bg-sunk text-tungsten"}`}>
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">{icon}</svg>
  </span>
);

const Action = ({ href, label, primary, onCta }: { href: string; label: string; primary?: boolean; onCta?: boolean }) => (
  <a href={href}
    className={primary
      ? (onCta ? "h-11 px-5 inline-flex items-center rounded-xl bg-night text-paper font-display font-bold hover:opacity-90" : "h-11 px-5 inline-flex items-center rounded-xl bg-cta text-oncta font-display font-bold hover:brightness-105")
      : (onCta ? "h-11 px-4 inline-flex items-center rounded-xl border border-oncta/30 font-semibold hover:bg-oncta/10" : "h-11 px-4 inline-flex items-center rounded-xl border border-paper/25 font-semibold hover:bg-sunk")}>
    {label}
  </a>
);

const Example = () => <span className="text-[11px] text-haze">Example</span>;

/** The strip above the hero headline: the newest thing, one tap away. */
export function NewStrip() {
  if (!PFM) return null;
  const href = BILLS ? "/for" : "/giveaway/link";
  return (
    <a href={href} data-testid="new-strip"
      className="inline-flex max-w-full items-center gap-2 rounded-2xl sm:rounded-full border border-tungsten/40 bg-cta/10 pl-1.5 pr-3 py-1.5 text-sm leading-snug hover:bg-cta/20 mb-5">
      <span className="shrink-0 rounded-full bg-cta text-oncta text-[11px] font-display font-bold px-2 py-0.5">New</span>
      {BILLS
        ? <span><span className="font-semibold">Bills links:</span> one link your family can pay any time</span>
        : <span><span className="font-semibold">Giveaway links:</span> share one link, everyone picks their own bill</span>}
      <span aria-hidden="true" className="shrink-0">→</span>
    </a>
  );
}

export default function FeatureShowcase() {
  const small = [
    EXAMS && { href: "/exams", title: "JAMB and WAEC PINs", text: "Buy a PIN in seconds, or let a parent or sponsor pay for it.", icon: I.exam },
    BULK && { href: "/bulk", title: "Bulk airtime", text: "Top up many numbers in one go, for staff or events.", icon: I.bulk },
  ].filter(Boolean) as { href: string; title: string; text: string; icon: JSX.Element }[];

  return (
    <section id="more" className="scroll-mt-20" aria-labelledby="more-title">
      <div className="max-w-6xl mx-auto px-5 pb-16 sm:pb-24">
        <p className="text-sm font-semibold text-tungsten">More ways to pay</p>
        <h2 id="more-title" className="font-display font-bold text-3xl md:text-[2.6rem] leading-[1.08] tracking-tight max-w-3xl mt-2">
          Get your bills paid by the people who look out for you, or pay for someone you look out for.
        </h2>
        <p className="text-haze text-lg leading-relaxed max-w-2xl mt-3">Everything is paid in naira and delivered in seconds. If a delivery fails, the person who paid is refunded automatically.</p>

        {/* ── the standing link: the big one ── */}
        {BILLS && (
          <article className="mt-10 rounded-3xl bg-cta text-oncta shadow-card p-6 sm:p-8 grid gap-8 lg:grid-cols-[1fr_24rem] items-center" data-testid="feature-bills">
            <div>
              <div className="flex items-center gap-3">
                <span className="w-11 h-11 rounded-2xl bg-night text-tungsten flex items-center justify-center"><svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">{I.link}</svg></span>
                <span className="rounded-full bg-night text-paper text-xs font-display font-bold px-2.5 py-1">New</span>
              </div>
              <h3 className="font-display font-extrabold text-3xl sm:text-4xl leading-tight tracking-tight mt-5">Your bills link</h3>
              <p className="text-lg leading-relaxed mt-2 max-w-xl">One permanent link for your light, TV, airtime and data. Send it once to the family and friends who help out, and they can pay any bill on it, any time, from their phone.</p>
              <ol className="mt-5 space-y-2 text-[15px]">
                {["Add your meter, smartcard or number once", "Share your link on WhatsApp", "They pay what they like, it is delivered to you"].map((s, n) => (
                  <li key={s} className="flex items-center gap-2.5">
                    <span className="shrink-0 w-6 h-6 rounded-full bg-night text-paper text-xs font-display font-bold flex items-center justify-center num">{n + 1}</span>{s}
                  </li>
                ))}
              </ol>
              <p className="mt-5 text-[15px] leading-relaxed"><span className="font-semibold">Best for:</span> anyone whose family helps with the bills. People who pay see only your name and the last four digits.</p>
              <div className="mt-6 flex flex-wrap gap-2">
                <Action href="/for/new" label="Make my link" primary onCta />
                <Action href="/for" label="How it works" onCta />
              </div>
            </div>
            {/* what the family sees */}
            <div aria-hidden="true" className="rounded-3xl bg-panel text-paper p-5 shadow-card">
              <div className="flex items-center justify-between"><span className="text-sm text-haze">What your family sees</span><Example /></div>
              <div className="mt-3 rounded-xl bg-sunk px-3 py-2 text-sm font-mono">nolgic.com/for/ada</div>
              <p className="font-display font-bold text-xl mt-4">Pay Ada&rsquo;s bills</p>
              <p className="text-sm text-haze mt-0.5">&ldquo;Thank you for always looking out for me&rdquo;</p>
              <ul className="mt-3 space-y-2">
                <li className="rounded-xl border-2 border-tungsten bg-cta/10 p-3"><span className="font-semibold">⚡ Mum&rsquo;s light</span><span className="block text-sm text-haze">Ikeja Electric · …6789</span></li>
                <li className="rounded-xl border border-line p-3"><span className="font-semibold">📱 My line</span><span className="block text-sm text-haze">MTN Airtime · …4567</span></li>
              </ul>
              <div className="flex gap-1.5 mt-3">{["₦1,000", "₦2,000", "₦5,000"].map((a, n) => <span key={a} className={`px-3 h-8 rounded-full border text-sm num inline-flex items-center ${n === 2 ? "border-tungsten bg-cta/15 font-semibold" : "border-line text-haze"}`}>{a}</span>)}</div>
            </div>
          </article>
        )}

        {/* ── tickets: one-off request, giveaway, gift ── */}
        <div className="mt-5 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {PFM && (
            <article className="rounded-3xl border border-line bg-panel shadow-card overflow-hidden flex flex-col" data-testid="feature-ask">
              <div className="p-5 sm:p-6 pb-7 flex-1">
                <div className="flex items-center gap-3"><Chip icon={I.send} /><h3 className="font-display font-bold text-2xl leading-tight">Ask someone to pay</h3></div>
                <p className="text-haze leading-relaxed mt-3">Light about to go? List what you need, send one link on WhatsApp, and a friend or relative pays it in naira. Your tokens arrive in seconds.</p>
                <div aria-hidden="true" className="mt-4 rounded-2xl bg-sunk p-3.5 text-sm">
                  <div className="flex items-center justify-between"><span className="text-haze">Ada is asking you to pay</span><Example /></div>
                  <div className="mt-2 flex justify-between"><span>⚡ Light</span><span className="num">₦5,000</span></div>
                  <div className="flex justify-between"><span>📱 Airtime</span><span className="num">₦1,000</span></div>
                  <div className="flex justify-between text-haze"><span>Service fee</span><span className="num">₦110</span></div>
                  <div className="mt-2 pt-2 border-t border-dashed border-line flex justify-between font-semibold"><span>You pay</span><span className="num">₦6,110</span></div>
                </div>
              </div>
              <div className="tear" />
              <div className="p-5 sm:p-6 pt-5 lg:min-h-[13rem]">
                <p className="text-[15px] leading-relaxed"><span className="font-semibold">Best for:</span> a bill you need paid today.</p>
                <div className="mt-4"><Action href="/ask" label="Make a request" primary /></div>
              </div>
            </article>
          )}

          {PFM && (
            <article className="rounded-3xl border border-line bg-panel shadow-card overflow-hidden flex flex-col" data-testid="feature-give">
              <div className="p-5 sm:p-6 pb-7 flex-1">
                <div className="flex items-center gap-3"><Chip icon={I.people} /><h3 className="font-display font-bold text-2xl leading-tight">Run a giveaway</h3></div>
                <p className="text-haze leading-relaxed mt-3">Pay once for many people. Share one link and each person picks their own bill, or add their numbers yourself. Everyone is delivered separately.</p>
                <div aria-hidden="true" className="mt-4 rounded-2xl border-2 border-dashed border-tungsten/60 bg-cta/10 p-3.5">
                  <div className="flex items-center justify-between"><span className="text-sm text-haze">A gift from Emeka</span><Example /></div>
                  <p className="font-display font-extrabold text-4xl leading-none mt-2 num text-tungsten">₦2,000</p>
                  <p className="text-sm mt-1.5">of light, airtime, data or TV. You choose.</p>
                  <p className="text-xs text-haze mt-2">Link stays open for 7, 14 or 30 days</p>
                </div>
              </div>
              <div className="tear" />
              <div className="p-5 sm:p-6 pt-5 lg:min-h-[13rem]">
                <p className="text-[15px] leading-relaxed"><span className="font-semibold">Best for:</span> birthdays, churches, events and brands.</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Action href="/giveaway/link" label="Send a link, let them choose" primary />
                  <Action href="/giveaway" label="I have their numbers" />
                </div>
              </div>
            </article>
          )}

          <article className="rounded-3xl border border-line bg-panel shadow-card overflow-hidden flex flex-col" data-testid="feature-gift">
            <div className="p-5 sm:p-6 pb-7 flex-1">
              <div className="flex items-center gap-3"><Chip icon={I.gift} /><h3 className="font-display font-bold text-2xl leading-tight">Send a gift</h3></div>
              <p className="text-haze leading-relaxed mt-3">Pay someone&rsquo;s light, airtime, data or TV before they ask, with your own message.</p>
              <div aria-hidden="true" className="mt-4 rounded-2xl bg-sunk p-3.5 text-sm">
                <div className="flex items-center justify-between"><span className="text-haze">For Mum</span><Example /></div>
                <p className="mt-2 font-display font-bold text-xl">⚡ ₦3,000 of light</p>
                <p className="mt-2 border-l-2 border-tungsten pl-3 text-haze">&ldquo;Happy birthday, Mum 💛&rdquo;</p>
              </div>
            </div>
            <div className="tear" />
            <div className="p-5 sm:p-6 pt-5 lg:min-h-[13rem]">
              <p className="text-[15px] leading-relaxed"><span className="font-semibold">Best for:</span> birthdays, thank-yous and surprises.</p>
              <div className="mt-4"><Action href="/gift" label="Send a gift" primary /></div>
            </div>
          </article>
        </div>

        {small.length > 0 && (
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {small.map((x) => (
              <a key={x.href} href={x.href} className="flex gap-3.5 items-center rounded-2xl border border-line bg-panel p-4 hover:border-paper/40">
                <Chip icon={x.icon} tone="sunk" />
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
