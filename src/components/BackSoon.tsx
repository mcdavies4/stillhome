import { BACK_SOON_MESSAGE } from "@/lib/back-soon";

// Shown instead of a red error when new orders are briefly paused (bills wallet being topped up).
// Deliberately calm: no alarm colour, says nothing was charged, and tells people to simply try again.
export const isBackSoon = (message: string | null | undefined) => message === BACK_SOON_MESSAGE;

export default function BackSoon({ className = "mt-4" }: { className?: string }) {
  return (
    <div role="status" className={`${className} rounded-xl border border-line bg-sunk p-4 flex gap-3`}>
      <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" className="shrink-0 mt-0.5 text-tungsten">
        <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2" />
        <path d="M12 7v5l3 2" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <div>
        <p className="font-semibold">We&rsquo;re restocking. Back in a few minutes.</p>
        <p className="text-haze text-sm leading-relaxed mt-1">Nothing has been charged. Please try again shortly.</p>
      </div>
    </div>
  );
}
