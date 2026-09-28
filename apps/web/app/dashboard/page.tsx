import Link from "next/link";
import { BalanceCard } from "@/components/dashboard/balance-card";
import { PayoutsTable } from "@/components/dashboard/payouts-table";
import { Button } from "@/components/ui/button";

export default function DashboardPage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="font-display text-[32px] leading-tight tracking-[-0.02em]">Overview</h1>
        <Button asChild>
          <Link href="/dashboard/payouts/new">New payout</Link>
        </Button>
      </div>
      <BalanceCard />
      <PayoutsTable />
    </div>
  );
}
