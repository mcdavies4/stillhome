import type { Metadata } from "next";
import "./globals.css";
import ThemeToggle from "@/components/ThemeToggle";
import Logo from "@/components/Logo";

const BASE = process.env.NEXT_PUBLIC_APP_URL ?? "https://stillhome-ten.vercel.app";

export const metadata: Metadata = {
  metadataBase: new URL(BASE),
  title: {
    default: "Nolgic — pay light, DSTV & airtime for family in Nigeria, from the UK",
    template: "%s — Nolgic",
  },
  description:
    "Buy electricity tokens, DSTV, GOTV, airtime and data for family in Nigeria from the UK. See the account name before you pay. Delivered in seconds, receipt on WhatsApp.",
  keywords: [
    "pay NEPA bill from UK",
    "pay electricity bill in Nigeria from abroad",
    "buy electricity token Nigeria from UK",
    "DSTV payment from UK",
    "pay GOTV from abroad",
    "buy MTN airtime from UK",
    "recharge Nigerian phone from UK",
    "send data to Nigeria",
    "Nigeria bill payment UK diaspora",
  ],
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    url: BASE,
    siteName: "Nolgic",
    title: "Nolgic — 3,000 miles away. Still home.",
    description:
      "Pay light, DSTV, airtime and data for family in Nigeria — from your card in pounds. Name-check before you pay, WhatsApp receipt after.",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "Nolgic — pay bills for family in Nigeria from the UK" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Nolgic — pay light, DSTV & airtime for family in Nigeria, from the UK",
    description:
      "Name-check before you pay. Delivered in seconds. Receipt on their WhatsApp.",
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
