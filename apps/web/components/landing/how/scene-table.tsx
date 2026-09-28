"use client";

import { m } from "motion/react";
import { StatusChip } from "@/components/status-chip";
import { formatCents } from "@/lib/money";
import { cn } from "@/lib/utils";
import { SAMPLE_ROWS } from "./steps";

const EASE_OUT = [0.2, 0.8, 0.2, 1] as const;

type Props = {
  /** Rows shown so far (for the cascade). */
  visible: number;
  /** Rows whose status reads "Claimed" (step 3); the rest read "Sent". */
  claimed?: number;
  showStatus?: boolean;
  reduced: boolean;
  large?: boolean;
};

export function SceneTable({ visible, claimed = 0, showStatus = false, reduced, large = false }: Props) {
  const cols = showStatus ? "grid-cols-[1fr_auto_5.25rem]" : "grid-cols-[1fr_auto]";
  return (
    <div className="overflow-hidden rounded-md border border-line">
      <div className={cn("grid gap-3 border-b border-line bg-card-raised px-4 py-2 font-semibold text-muted dark:bg-surface", large ? "text-sm" : "text-xs", cols)}>
        <span>Payee</span>
        <span className="text-right">Amount</span>
        {showStatus && <span className="text-right">Status</span>}
      </div>
      <ul>
        {SAMPLE_ROWS.map((row, i) => {
          const status = i < claimed ? "claimed" : "sent";
          return (
            <m.li
              key={row.name}
              className={cn("grid items-center gap-3 border-b border-line px-4 last:border-b-0", large ? "h-12 text-[15px]" : "h-11 text-sm", cols)}
              initial={reduced ? false : { opacity: 0, y: 8 }}
              animate={i < visible ? { opacity: 1, y: 0 } : { opacity: 0, y: 8 }}
              transition={{ duration: 0.2, ease: EASE_OUT }}
            >
              <span className="flex min-w-0 items-center gap-2 font-semibold text-foreground">
                <span aria-hidden>{row.flag}</span>
                <span className="truncate">{row.name}</span>
              </span>
              <span className="text-right font-bold text-foreground tabular-nums">{formatCents(row.cents)}</span>
              {showStatus && (
                <span className="flex justify-end [perspective:400px]">
                  {/* Keyed by status so each change remounts and flips in. */}
                  <m.span
                    key={status}
                    className="inline-block"
                    initial={reduced || status === "sent" ? false : { rotateX: 90 }}
                    animate={{ rotateX: 0 }}
                    transition={{ duration: 0.22, ease: EASE_OUT }}
                  >
                    <StatusChip status={status} />
                  </m.span>
                </span>
              )}
            </m.li>
          );
        })}
      </ul>
    </div>
  );
}
