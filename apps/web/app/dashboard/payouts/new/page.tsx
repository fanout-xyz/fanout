import type { Metadata } from "next";
import { NewPayoutFlow } from "@/components/payouts/new-payout-flow";

export const metadata: Metadata = { title: "New payout · Fanout" };

export default function NewPayoutPage() {
  return <NewPayoutFlow />;
}
