"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useMockSimulateClaims } from "@/lib/fanout/queries";

/** Pause between simulated claim rounds, and the most people claiming in one round. */
const ROUND_MS = 1_200;
const MAX_PER_ROUND = 6;

/**
 * Demo mode only: claims a few waiting payments at a time, as if payees were opening their links,
 * until everyone has claimed or it's stopped. Lets you watch the claim counter fill up.
 */
export function SimulateClaimsButton({ batchId, waiting }: { batchId: string; waiting: number }) {
  const simulate = useMockSimulateClaims(batchId);
  const [running, setRunning] = useState(false);
  const { mutateAsync } = simulate;

  useEffect(() => {
    if (!running) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const round = async () => {
      try {
        const claimed = await mutateAsync(1 + Math.floor(Math.random() * MAX_PER_ROUND));
        if (cancelled) return;
        if (claimed === 0) return setRunning(false);
        timer = setTimeout(() => void round(), ROUND_MS);
      } catch {
        if (!cancelled) setRunning(false);
      }
    };
    void round();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [running, mutateAsync]);

  if (waiting === 0 && !running) return null;
  return (
    <>
      <Button variant="ghost" size="sm" aria-pressed={running} onClick={() => setRunning((r) => !r)}>
        {running ? "Stop simulating" : "Simulate people claiming"}
      </Button>
      {simulate.isError && !running && <span className="text-danger">{simulate.error.message}</span>}
    </>
  );
}
