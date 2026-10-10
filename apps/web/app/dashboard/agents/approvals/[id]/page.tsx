import type { Metadata } from "next";
import { ApprovalView } from "@/components/agents/approval-view";

export const metadata: Metadata = { title: "Approve a payout · Fanout" };

export default async function ApprovalPage({ params }: PageProps<"/dashboard/agents/approvals/[id]">) {
  const { id } = await params;
  return <ApprovalView id={id} />;
}
