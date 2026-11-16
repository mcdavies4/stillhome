// A short, looping picture of what Nolgic does: the name on the meter is checked first, then the token arrives.
// Purely illustrative. Every number and name here is an example, and the card says so.
// Motion is CSS only, and globals.css turns it off for people who ask for reduced motion.
export default function VerifyDemo() {
  return (
    <div className="vd relative w-full max-w-[30rem] rounded-2xl border border-line bg-panel shadow-card p-5 sm:p-6" aria-hidden="true">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-haze">Example</span>
        <span className="text-xs text-haze font-mono">IKEDC prepaid</span>
      </div>

      <div className="mt-4">
        <div className="text-xs text-haze">Meter number</div>
        <div className="vd-meter mt-1 font-mono text-xl sm:text-2xl tracking-wider">0123 4567 8901</div>
      </div>

      <div className="relative mt-5 h-[4.5rem]">
        <div className="vd-check absolute inset-0 flex items-start gap-3">
          <span className="mt-0.5 w-6 h-6 shrink-0 rounded-full bg-ok/15 text-ok flex items-center justify-center">
            <svg width="14" height="14" viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </span>
          <div>
            <div className="font-display font-bold text-[17px]">Sample Customer</div>
            <div className="text-sm text-haze">Name confirmed before you pay</div>
          </div>
        </div>
        <div className="vd-token absolute inset-0">
          <div className="text-xs text-haze">Token, emailed and shown to you</div>
          <div className="mt-1 font-mono text-lg sm:text-xl tracking-[0.12em] text-tungsten">1234 5678 9012 3456</div>
          <div className="text-xs text-haze mt-1">Delivered in seconds</div>
        </div>
      </div>

      <div className="mt-4 h-1.5 rounded-full bg-sunk overflow-hidden">
        <div className="vd-bar h-full rounded-full bg-cta" />
      </div>
    </div>
  );
}
