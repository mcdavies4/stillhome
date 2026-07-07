// Nolgic logo: inline bulb mark + live-text wordmark.
// Inherits theme colors automatically (tungsten mark, paper text).
export default function Logo({ size = "md" }: { size?: "md" | "sm" }) {
  const dims = size === "md" ? { svg: 26, text: "text-2xl" } : { svg: 20, text: "text-lg" };
  return (
    <span className="inline-flex items-center gap-2 select-none">
      <svg
        width={dims.svg}
        height={dims.svg}
        viewBox="0 0 64 64"
        fill="none"
        aria-hidden="true"
        className="text-tungsten"
      >
        <circle cx="32" cy="32" r="15" stroke="currentColor" strokeWidth="7.5" />
        <path
          d="M25 32 q3.5 -5 7 0 t7 0"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
        />
      </svg>
      <span className={`font-display font-extrabold ${dims.text} text-paper tracking-tight leading-none`}>
        nolgic
      </span>
    </span>
  );
}
