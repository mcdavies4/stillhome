import type { Metadata } from "next";
import { payForMeEnabled, pfmMoney } from "@/lib/payforme-shared";

// A private link between two people: never in search results. The title and description are what WhatsApp shows
// in the preview, so they name who is asking and for how much (and nothing else).
export async function generateMetadata({ params }: { params: { id: string } }): Promise<Metadata> {
  const base: Metadata = { robots: { index: false, follow: false }, alternates: { canonical: null } };
  try {
    if (payForMeEnabled()) {
      // Loaded here, not at the top, so that a problem with the database can only ever cost the preview its nice title.
      const { getPayRequestView } = await import("@/lib/payforme");
      // And never let a slow database hold the page up: after 2.5 seconds the preview just gets the plain title.
      const v = await Promise.race([getPayRequestView(params.id, null), new Promise<null>((r) => setTimeout(() => r(null), 2500))]);
      if (v && v.status === "open") {
        return {
          ...base,
          title: `${v.receiverName} is asking you to pay ${pfmMoney(v.total)}`,
          description: "See exactly what it is, then pay by card from anywhere. Light, TV, airtime and data, delivered in seconds.",
        };
      }
    }
  } catch { /* fall through to the plain title */ }
  return { ...base, title: "Pay for a friend", description: "Help pay a few bills on Nolgic. See exactly what it is before you pay." };
}
export default function Layout({ children }: { children: React.ReactNode }) { return children; }
