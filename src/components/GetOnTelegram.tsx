import { telegramUrl } from "@/lib/app-links";

// "Buy on Telegram" button. Our own drawing (a paper plane), not Telegram's logo artwork.
// Shows nothing until NEXT_PUBLIC_TELEGRAM_BOT_USERNAME is set. Works in server and client components.

const PlaneMark = ({ size = 18 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className="shrink-0">
    <path d="M21.4 3.3a.8.8 0 00-.8-.1L2.9 10.1c-.7.3-.7 1.3 0 1.5l4.4 1.5 1.7 5.3c.2.6 1 .8 1.4.3l2.4-2.5 4.1 3c.5.4 1.2.1 1.4-.5L21.9 4.2a.8.8 0 00-.5-.9zM9.2 12.6l8.3-5.1-6.4 6.5-.3 3-1.6-4.4z" fill="currentColor" />
  </svg>
);

export default function GetOnTelegram({ place, variant = "solid", className = "" }: { place: string; variant?: "solid" | "link"; className?: string }) {
  const href = telegramUrl(place);
  if (!href) return null;
  if (variant === "link") {
    return (
      <a href={href} target="_blank" rel="noopener" className={`hover:text-paper ${className}`}>
        Buy on Telegram
      </a>
    );
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener"
      className={`inline-flex items-center gap-3 h-12 pl-4 pr-5 rounded-xl border border-line text-paper hover:bg-panel active:brightness-95 ${className}`}
    >
      <PlaneMark size={20} />
      <span className="leading-tight text-left">
        <span className="block text-[11px] font-medium opacity-80">Pay bills in chat</span>
        <span className="block font-display font-bold text-[16px] -mt-0.5">Nolgic on Telegram</span>
      </span>
    </a>
  );
}
