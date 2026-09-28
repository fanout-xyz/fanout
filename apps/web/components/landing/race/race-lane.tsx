"use client";

import { AnimatePresence, m, useTransform, type MotionValue } from "motion/react";
import type { ReactNode } from "react";
import { useTweenNumber } from "@/hooks/use-tween-number";
import { formatCents } from "@/lib/money";

type Props = {
  label: string;
  progress: MotionValue<number>;
  done: boolean;
  fromCents: number;
  amountCents: number;
  reduced: boolean;
  /** Above the track (fee chips). */
  above?: ReactNode;
  /** Below the track (day labels). */
  below?: ReactNode;
  /** Shown at the end of the track when done. */
  endBadge?: ReactNode;
};

export function RaceLane({ label, progress, done, fromCents, amountCents, reduced, above, below, endBadge }: Props) {
  // The runner is a full-width strip slid in from the left, dot at its right edge: transform-only.
  const x = useTransform(progress, (p) => `${(p - 1) * 100}%`);
  const shown = useTweenNumber(amountCents, { durationMs: 600, instant: reduced });

  return (
    <div className="grid gap-x-8 gap-y-3 md:grid-cols-[minmax(0,1fr)_10rem] md:items-end">
      <div>
        <p className="mb-3 text-sm font-bold text-cream">{label}</p>
        <div className={above ? "relative h-17 md:h-9" : "relative h-9"}>{above}</div>
        <div className="relative h-10 overflow-hidden rounded-lg bg-ink-raised">
          <m.div className="absolute inset-y-0 left-0 w-full" style={{ x }}>
            <div className="absolute inset-y-0 left-0 right-5 rounded-l-lg bg-cream/[0.06]" />
            <span className="absolute top-1/2 right-2 size-5 -translate-y-1/2 rounded-full bg-cream" />
          </m.div>
          <AnimatePresence>{done && endBadge}</AnimatePresence>
        </div>
        <div className="relative mt-2 h-5">{below}</div>
      </div>
      <div className="flex items-baseline justify-between gap-3 md:block md:pb-7 md:text-right">
        <p className="text-xs text-cream/60 md:mb-1">
          {formatCents(fromCents)} sent <span aria-hidden>→</span>
        </p>
        <p className="font-display text-3xl tracking-[-0.02em] text-cream tabular-nums">{formatCents(shown)}</p>
      </div>
    </div>
  );
}
