"use client";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { usePayeeHistory } from "@/lib/fanout/queries";
import { formatUsd } from "@/lib/money";
import { shortAddress } from "@/lib/send-validation";
import { cn } from "@/lib/utils";

const when = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export function HistoryList() {
  const history = usePayeeHistory();

  return (
    <section aria-labelledby="history-title" className="flex flex-col gap-3">
      <h2 id="history-title" className="text-lg font-bold tracking-[-0.01em]">
        Activity
      </h2>
      {history.isPending ? (
        <div className="flex flex-col gap-2" aria-busy="true" aria-label="Loading activity">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-16 w-full rounded-md" />
          ))}
        </div>
      ) : history.isError ? (
        <div className="flex items-center justify-between gap-3 rounded-md bg-danger/10 px-4 py-3" role="alert">
          <p className="text-sm font-semibold text-danger">Couldn&apos;t load your activity.</p>
          <Button variant="secondary" size="sm" onClick={() => void history.refetch()}>
            Retry
          </Button>
        </div>
      ) : history.data.length === 0 ? (
        <p className="rounded-md border border-line bg-surface px-4 py-6 text-center text-muted">Nothing here yet.</p>
      ) : (
        <ul className="overflow-hidden rounded-lg border border-line bg-surface">
          {history.data.map((item) => {
            const received = item.kind === "received";
            return (
              <li key={`${item.txHash}-${item.kind}`} className="flex items-center gap-3 border-b border-line px-4 py-3 last:border-b-0">
                <span
                  className={cn(
                    "flex size-10 shrink-0 items-center justify-center rounded-full",
                    received ? "bg-mint-surface text-success" : "bg-card-raised text-foreground",
                  )}
                  aria-hidden
                >
                  <Arrow down={received} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{received ? "Payment received" : `Sent to ${shortAddress(item.counterparty)}`}</p>
                  <p className="text-sm text-muted tabular-nums">{when.format(item.timestamp)}</p>
                </div>
                <p className={cn("font-bold tabular-nums", received ? "text-success" : "text-foreground")}>
                  <span className="sr-only">{received ? "Received " : "Sent "}</span>
                  {received ? "+" : "−"}
                  {formatUsd(item.amount)}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function Arrow({ down }: { down: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className={cn("size-5", !down && "rotate-180")} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 5v14M6 13l6 6 6-6" />
    </svg>
  );
}
