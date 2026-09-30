"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { LocalAmount } from "@/components/payee/local-amount";
import { useAuth } from "@/lib/auth/provider";
import { usePayeeBalance } from "@/lib/fanout/queries";
import { formatUsd, toCents } from "@/lib/money";
import { HistoryList } from "./history-list";
import { PayeeAuthGate } from "./payee-auth-gate";
import { SendFlow } from "./send-flow";

export function WalletView() {
  return (
    <PayeeAuthGate>
      <Wallet />
    </PayeeAuthGate>
  );
}

function Wallet() {
  const { user, logout } = useAuth();
  const balance = usePayeeBalance();
  const [sending, setSending] = useState(false);

  if (sending && balance.data !== undefined) {
    return <SendFlow balance={balance.data} onClose={() => setSending(false)} />;
  }

  return (
    <div className="flex flex-col gap-8 px-5 pt-4 pb-10">
      <section aria-labelledby="balance-label" className="rounded-xl border border-line bg-surface px-6 py-8 text-center">
        <h1 id="balance-label" className="text-base font-semibold text-muted">
          Your balance
        </h1>
        {balance.isPending ? (
          <Skeleton className="mx-auto mt-3 h-16 w-56" />
        ) : balance.isError ? (
          <div className="mt-3 flex flex-col items-center gap-3" role="alert">
            <p className="text-danger">Couldn&apos;t load your balance.</p>
            <Button variant="secondary" size="sm" onClick={() => void balance.refetch()}>
              Retry
            </Button>
          </div>
        ) : (
          <>
            <p className="mt-2 font-display text-[clamp(48px,14vw,64px)] leading-none tracking-[-0.03em] tabular-nums">
              {formatUsd(balance.data)}
            </p>
            {balance.data > 0n && <LocalAmount cents={toCents(balance.data)} className="mt-3" />}
          </>
        )}
        <p className="mt-3 text-sm text-muted">Held in US dollars</p>
      </section>

      <div className="flex flex-col gap-3">
        <Button
          size="lg"
          className="h-14 w-full"
          onClick={() => setSending(true)}
          disabled={!balance.data || balance.data === 0n}
        >
          Send money
        </Button>
        {balance.data === 0n && <p className="text-center text-sm text-muted">Nothing to send yet.</p>}
        <p className="text-center text-sm text-muted">Cash-out to local banks is on the roadmap.</p>
      </div>

      <HistoryList />

      <p className="text-center text-sm text-muted">
        Signed in as {user?.email ?? "you"}.{" "}
        <button
          type="button"
          onClick={() => void logout()}
          className="rounded-sm font-semibold text-foreground underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Sign out
        </button>
      </p>
    </div>
  );
}
