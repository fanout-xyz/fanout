import type { Metadata } from "next";
import { VerifyView } from "@/components/passport/verify-view";
import { CARD_SIZES, cardQuery, cardSummary, parseShareCard } from "@/lib/payee/passport-share";

/**
 * Link previews (X, WhatsApp, iMessage) can't see the fragment, so the share link carries a
 * preview of the card in its query: only the fields the payee chose to show. The page itself
 * always draws the card from the signed passport in the fragment.
 */
export async function generateMetadata({ searchParams }: PageProps<"/verify">): Promise<Metadata> {
  const q = await searchParams;
  const card = parseShareCard({ get: (k) => (typeof q[k] === "string" ? (q[k] as string) : null) });
  const title = "Earnings Passport · Fanout";
  const description = card ? cardSummary(card) : "Earnings checked against real payouts on Fanout.";
  const image = `/api/passport/card${card ? `?${cardQuery(card)}` : ""}`;
  return {
    title,
    description,
    robots: { index: false, follow: false },
    openGraph: {
      title,
      description,
      type: "website",
      images: [{ url: image, ...CARD_SIZES.landscape, alt: card ? cardSummary(card) : "Fanout Earnings Passport" }],
    },
    twitter: { card: "summary_large_image", title, description, images: [image] },
  };
}

export default function VerifyPage() {
  return <VerifyView />;
}
