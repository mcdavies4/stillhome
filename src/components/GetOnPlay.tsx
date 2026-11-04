import { playUrl } from "@/lib/app-links";

// A plain "Get it on Google Play" button. Our own drawing (a play triangle), not Google's badge artwork.
// Works in server and client components. `place` tells the Play Console which button brought the install.

const PlayMark = ({ size = 18 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className="shrink-0">
    <path d="M6 3.6v16.8c0 .6.65.95 1.15.62l13-8.4a.74.74 0 000-1.24l-13-8.4A.74.74 0 006 3.6z" fill="currentColor" />
  </svg>
);

export default function GetOnPlay({ place, variant = "solid", className = "" }: { place: string; variant?: "solid" | "link"; className?: string }) {
  if (variant === "link") {
    return (
      <a href={playUrl(place)} target="_blank" rel="noopener" className={`hover:text-paper ${className}`}>
        Android app on Google Play
      </a>
    );
  }
  return (
    <a
      href={playUrl(place)}
      target="_blank"
      rel="noopener"
      className={`inline-flex items-center gap-3 h-12 pl-4 pr-5 rounded-xl bg-paper text-night hover:brightness-110 active:brightness-95 ${className}`}
    >
      <PlayMark size={20} />
      <span className="leading-tight text-left">
        <span className="block text-[11px] font-medium opacity-80">Get it on</span>
        <span className="block font-display font-bold text-[16px] -mt-0.5">Google Play</span>
      </span>
    </a>
  );
}
