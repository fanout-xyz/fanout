import type { Metadata } from "next";
import { BatchDetail } from "@/components/payouts/batch-detail";

export async function generateMetadata({ params }: PageProps<"/dashboard/payouts/[id]">): Promise<Metadata> {
  const { id } = await params;
  return { title: `Payout #${id} · Fanout` };
}

export default async function PayoutPage({ params }: PageProps<"/dashboard/payouts/[id]">) {
  const { id } = await params;
  return <BatchDetail id={id} />;
}
