"use client";

import { useEffect, useState } from "react";
import { Spinner } from "@/components/tx-progress";

/**
 * Mocked sanctions/KYC screening step (real screening is out of scope for the
 * hackathon). Always passes after a short delay, and says it's simulated.
 */
export function ScreeningCheck({ count, onPassed }: { count: number; onPassed: () => void }) {
  const [passed, setPassed] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => {
      setPassed(true);
      onPassed();
    }, 900);
    return () => clearTimeout(t);
  }, [onPassed]);

  return (
    <div className="flex items-center gap-3" role="status">
      {passed ? (
        <span className="flex size-6 items-center justify-center rounded-full bg-mint-surface text-success" aria-hidden>
          <svg viewBox="0 0 16 16" className="size-3.5">
            <path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      ) : (
        <Spinner className="size-5 text-primary" />
      )}
      <div>
        <p className="text-sm font-bold">{passed ? "Screening passed" : `Screening ${count} ${count === 1 ? "person" : "people"}…`}</p>
        <p className="text-xs text-muted">Demo: sanctions screening is simulated.</p>
      </div>
    </div>
  );
}
