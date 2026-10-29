import type { Metadata } from "next";
import "./globals.css";
import ThemeToggle from "@/components/ThemeToggle";
import Logo from "@/components/Logo";

const BASE = process.env.NEXT_PUBLIC_APP_URL ?? "https://stillhome-ten.vercel.app";

export const metadata: Metadata = {
  metadataBase: new URL(BASE),
  title: {
    default: "Nolgic — pay light, DSTV, airtime & data in Nigeria, in naira",
    template: "%s — Nolgic",
  },
  description:
    "Buy electricity tokens, DSTV, GOTV, airtime and data in Nigeria. See the account name before you pay. Delivered in seconds, with an automatic refund if delivery fails.",
  keywords: [
    "buy electricity token Nigeria",
    "pay NEPA bill online",
    "pay prepaid meter online Nigeria",
    "DSTV subscription payment Nigeria",
    "pay GOTV online",
    "buy MTN airtime online",
    "buy data bundle Nigeria",
    "pay bills with bank transfer Nigeria",
  ],
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    url: BASE,
    siteName: "Nolgic",
    title: "Nolgic — light, TV, airtime and data, paid in seconds.",
    description:
      "Pay light, TV, airtime and data in Nigeria. Name-check before you pay, delivered in seconds.",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "Nolgic — pay bills in Nigeria" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Nolgic — pay light, DSTV, airtime & data in Nigeria",
    description:
      "Name-check before you pay. Delivered in seconds. Automatic refund if delivery fails.",
    images: ["/og.png"],
  },
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/favicon.ico", sizes: "any" },
      { url: "/favicon-32.png", type: "image/png", sizes: "32x32" },
      { url: "/favicon-16.png", type: "image/png", sizes: "16x16" },
    ],
    apple: "/apple-touch-icon.png",
  },
  manifest: "/site.webmanifest",
};

const themeInit = `
try {
  var t = localStorage.getItem("nolgic-theme");
  if (t === "dark") document.documentElement.classList.add("dark");
} catch (e) {}
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
      </head>
      <body>
        <nav className="sticky top-0 z-50 bg-night/85 backdrop-blur border-b border-line">
          <div className="max-w-5xl mx-auto px-5 h-16 flex items-center justify-between">
            <a href="/" className="flex items-center gap-2.5" aria-label="Nolgic home">
              <Logo />
            </a>
            <div className="flex items-center gap-2 sm:gap-5 text-sm">
              <a href="/#how" className="text-haze hover:text-paper hidden sm:block">
                How it works
              </a>
              <a href="/#faq" className="text-haze hover:text-paper hidden sm:block">
                FAQ
              </a>
              <a href="/legal" className="text-haze hover:text-paper hidden sm:block">
                Terms
              </a>
              <ThemeToggle />
              <a
                href="/#pay"
                className="px-4 py-2 rounded-lg bg-tungsten text-white dark:text-night font-display font-bold hover:brightness-110"
              >
                Pay a bill
              </a>
            </div>
          </div>
        </nav>
        {children}
      </body>
    </html>
  );
}
