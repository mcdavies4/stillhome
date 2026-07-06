import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Nolgic — pay light, DSTV & airtime for family in Nigeria, from the UK",
  description:
    "Buy electricity tokens, DSTV, GOTV, airtime and data for family in Nigeria from the UK. See the account name before you pay. Instant delivery, WhatsApp receipts.",
  icons: { icon: "/favicon.svg" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <nav className="sticky top-0 z-50 bg-night/85 backdrop-blur border-b border-line">
          <div className="max-w-5xl mx-auto px-5 h-16 flex items-center justify-between">
            <a href="/" className="flex items-center gap-2.5" aria-label="Nolgic home">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/logo.svg" alt="Nolgic" className="h-7 w-auto" />
            </a>
            <div className="flex items-center gap-2 sm:gap-5 text-sm">
              <a href="/#how" className="text-haze hover:text-paper hidden sm:block">
                How it works
              </a>
              <a href="/legal" className="text-haze hover:text-paper hidden sm:block">
                Terms
              </a>
              <a
                href="/#pay"
                className="px-4 py-2 rounded-lg bg-tungsten text-night font-display font-bold hover:brightness-110"
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
