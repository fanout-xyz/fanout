"use client";

import { useState } from "react";
import { formatEther } from "viem";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/lib/auth/provider";
import { config } from "@/lib/config";
import { useAccountFunds } from "@/lib/fanout/queries";
import { formatUsd } from "@/lib/money";

const LOW_MON = 10n ** 16n; // 0.01 MON: roughly enough for a deposit and a payout

/**
 * The platform's own account on Monad: AUSD available to deposit and MON for network fees.
 * Dashboard side, so the address and "MON" are fine to show (guidelines §8).
 */
export function FundingCard() {
  const address = useAuth().user?.address;
  const funds = useAccountFunds();
  const [copied, setCopied] = useState(false);

  async function copy() {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // The address is visible and selectable anyway.
    }
  }

  const lowMon = funds.data && funds.data.mon < LOW_MON;

  return (
    <section aria-labelledby="funding-title" className="rounded-lg border border-line bg-surface p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 id="funding-title" className="text-sm font-semibold text-muted">
            Your account on Monad testnet
          </h2>
          <p className="mt-1 truncate font-mono text-sm" title={address}>
            {address}
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={() => void copy()}>
          {copied ? "Copied" : "Copy address"}
        </Button>
      </div>

      <dl className="mt-5 grid gap-4 sm:grid-cols-2">
        <div>
          <dt className="text-sm text-muted">AUSD ready to deposit</dt>
          <dd className="mt-1 text-xl font-bold tabular-nums">
            {funds.isPending ? <Skeleton className="h-7 w-28" /> : funds.data ? formatUsd(funds.data.ausd) : "–"}
          </dd>
        </div>
        <div>
          <dt className="text-sm text-muted">MON for network fees</dt>
          <dd className="mt-1 text-xl font-bold tabular-nums">
            {funds.isPending ? <Skeleton className="h-7 w-28" /> : funds.data ? `${Number(formatEther(funds.data.mon)).toFixed(4)} MON` : "–"}
          </dd>
        </div>
      </dl>

      {funds.isError && (
        <p role="alert" className="mt-4 text-sm text-danger">
          Couldn&apos;t read your account from Monad.{" "}
          <button className="font-semibold underline" onClick={() => void funds.refetch()}>
            Retry
          </button>
        </p>
      )}
      {lowMon && (
        <p className="mt-4 rounded-md bg-warning/10 px-4 py-3 text-sm text-warning">
          You need a little MON to pay network fees for deposits and payouts. Copy your address and get test MON from the{" "}
          <a href={config.monFaucetUrl} target="_blank" rel="noreferrer" className="font-semibold underline">
            Monad faucet
          </a>
          .
        </p>
      )}
      {funds.data && funds.data.ausd === 0n && (
        <p className="mt-3 text-sm text-muted">
          To deposit, send testnet AUSD to this address first. Deposits move it into your payout balance.
        </p>
      )}
    </section>
  );
}
