"use client";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useTreasuryBalance } from "@/lib/fanout/queries";
import { formatUsd } from "@/lib/money";
import { CrossChainDialog } from "./cross-chain-dialog";
import { DepositDialog } from "./deposit-dialog";
import { TestDollars } from "./test-dollars";

export function BalanceCard() {
  const balance = useTreasuryBalance();

  return (
    <section aria-labelledby="balance-title" className="rounded-lg border border-line bg-surface p-6 lg:p-8">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <h2 id="balance-title" className="text-sm font-semibold text-muted">
            Payout balance
          </h2>
          {balance.isPending ? (
            <Skeleton className="mt-3 h-14 w-64" />
          ) : balance.isError ? (
            <div className="mt-3 flex items-center gap-3" role="alert">
              <p className="text-danger">Couldn&apos;t load your balance.</p>
              <Button variant="secondary" size="sm" onClick={() => void balance.refetch()}>
                Retry
              </Button>
            </div>
          ) : (
            <p className="mt-2 font-display text-[clamp(40px,5vw,56px)] leading-none tracking-[-0.03em] tabular-nums">
              {formatUsd(balance.data)}
            </p>
          )}
          <p className="mt-3 text-sm text-muted">Available to pay out</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <CrossChainDialog />
          <DepositDialog />
        </div>
      </div>
      <TestDollars />
    </section>
  );
}
