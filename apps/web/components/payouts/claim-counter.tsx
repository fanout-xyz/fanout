"use client";

import { useEffect, useState } from "react";
import type { ClaimProgress } from "@/lib/claim-progress";
import { formatUsd } from "@/lib/money";

const percent = new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 0 });

/**
 * "N of M claimed" with a progress bar and the dollars claimed so far. The payout page keeps
 * refreshing while anyone is still waiting (useBatch), so this moves on its own as people claim.
 * New claims nudge the number in and show a brief "+k"; both stay still under reduced motion.
 */
export function ClaimCounter({ progress }: { progress: ClaimProgress }) {
  const { people, claimed, returned, waiting, claimedAmount, totalAmount, claimedShare, returnedShare, settled } = progress;
  const delta = useClaimDelta(claimed);

  return (
    <section aria-labelledby="claim-counter-title" className="rounded-lg border border-line bg-surface p-5 sm:p-6">
      <h2 id="claim-counter-title" className="sr-only">
        Claim progress
      </h2>
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
        <p className="flex items-baseline gap-3" aria-live="polite" aria-atomic="true">
          <span className="relative inline-flex overflow-hidden">
            <span
              key={claimed}
              className="font-display text-[56px] leading-none tracking-[-0.03em] tabular-nums animate-in fade-in-0 slide-in-from-bottom-3 duration-300 ease-out motion-reduce:animate-none sm:text-[64px]"
            >
              {claimed}
            </span>
          </span>
          <span className="text-lg font-semibold text-muted">
            of {people} claimed
          </span>
          {delta && (
            <span
              key={delta.id}
              aria-hidden="true"
              className="self-center rounded-full bg-mint-surface px-2.5 py-0.5 text-sm font-bold text-on-mint tabular-nums animate-in fade-in-0 zoom-in-95 duration-200 motion-reduce:animate-none"
            >
              +{delta.n}
            </span>
          )}
        </p>
        <div className="text-left sm:text-right">
          <p className="font-display text-[28px] leading-none tracking-[-0.02em] tabular-nums">{formatUsd(claimedAmount)}</p>
          <p className="mt-2 text-sm text-muted">claimed of {formatUsd(totalAmount)}</p>
        </div>
      </div>

      <div
        role="progressbar"
        aria-label="People who claimed"
        aria-valuemin={0}
        aria-valuemax={people}
        aria-valuenow={claimed}
        aria-valuetext={`${claimed} of ${people} claimed`}
        className="mt-5 flex h-3 w-full overflow-hidden rounded-full bg-line dark:bg-card-raised"
      >
        <div
          className="h-full bg-success transition-[width] duration-500 ease-[cubic-bezier(0.2,0.8,0.2,1)] motion-reduce:transition-none"
          style={{ width: `${claimedShare * 100}%` }}
        />
        <div
          className="h-full bg-tangerine transition-[width] duration-500 ease-[cubic-bezier(0.2,0.8,0.2,1)] motion-reduce:transition-none"
          style={{ width: `${returnedShare * 100}%` }}
        />
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-x-6 gap-y-2 text-sm text-muted">
        <LiveNote settled={settled} claimed={claimed} returned={returned} />
        <span className="tabular-nums">
          {percent.format(claimedShare)} claimed
          {waiting > 0 && ` · ${waiting} waiting`}
          {returned > 0 && ` · ${returned} returned`}
        </span>
      </div>
    </section>
  );
}

function LiveNote({ settled, claimed, returned }: { settled: boolean; claimed: number; returned: number }) {
  if (settled) {
    return <span>{returned === 0 ? "Everyone has claimed." : `Finished: ${claimed} claimed, ${returned} returned to your balance.`}</span>;
  }
  return (
    <span className="inline-flex items-center gap-2">
      <span className="relative flex size-2" aria-hidden="true">
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-60 motion-reduce:animate-none" />
        <span className="relative inline-flex size-2 rounded-full bg-success" />
      </span>
      Updates live as people claim
    </span>
  );
}

/** How many claims arrived in the latest refresh, shown for a moment. Ignores the first load. */
function useClaimDelta(claimed: number) {
  const [prev, setPrev] = useState(claimed);
  const [delta, setDelta] = useState<{ n: number; id: number } | null>(null);
  if (claimed !== prev) {
    setPrev(claimed);
    setDelta(claimed > prev ? { n: claimed - prev, id: claimed } : null);
  }
  useEffect(() => {
    if (!delta) return;
    const t = setTimeout(() => setDelta(null), 2_500);
    return () => clearTimeout(t);
  }, [delta]);
  return delta;
}
