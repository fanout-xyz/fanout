"use client";

import { m } from "motion/react";
import { PetalsMark } from "@/components/brand/petals-mark";
import { StatusChip } from "@/components/status-chip";
import { useTicker } from "@/hooks/use-ticker";
import { useTweenNumber } from "@/hooks/use-tween-number";
import { formatCents } from "@/lib/money";
import { SceneTable } from "./scene-table";
import { SAMPLE_PAYEES, SAMPLE_ROWS, SAMPLE_TOTAL_CENTS } from "./steps";

const EASE_OUT = [0.2, 0.8, 0.2, 1] as const;
type SceneProps = { play: boolean; reduced: boolean };

export function FundScene({ play, reduced }: SceneProps) {
  const cents = useTweenNumber(play || reduced ? SAMPLE_TOTAL_CENTS : 0, { durationMs: 900, instant: reduced });
  return (
    <div className="flex h-full flex-col justify-center gap-5">
      <div className="rounded-lg border border-line bg-cream p-6">
        <p className="text-sm font-semibold text-muted">Payout balance</p>
        <p className="mt-2 font-display text-[clamp(36px,5vw,52px)] leading-none tracking-[-0.03em] text-ink tabular-nums">
          {formatCents(cents)}
        </p>
      </div>
      <m.span
        className="inline-flex w-fit items-center gap-1.5 self-start rounded-full bg-mint px-3 py-1.5 text-sm font-bold text-ink"
        initial={reduced ? false : { opacity: 0, x: -12 }}
        animate={play || reduced ? { opacity: 1, x: 0 } : { opacity: 0, x: -12 }}
        transition={{ duration: 0.22, ease: EASE_OUT, delay: reduced ? 0 : 0.95 }}
      >
        <Check /> Deposit received
      </m.span>
    </div>
  );
}

export function UploadScene({ play, reduced }: SceneProps) {
  const rows = useTicker(play, SAMPLE_ROWS.length, { intervalMs: 90, delayMs: 500, instant: reduced });
  const done = rows === SAMPLE_ROWS.length;
  const total = useTweenNumber(done ? SAMPLE_TOTAL_CENTS : 0, { durationMs: 800, instant: reduced });
  return (
    <div className="flex h-full flex-col gap-4">
      <m.div
        className="flex items-center gap-3"
        initial={reduced ? false : { opacity: 0, y: -24 }}
        animate={play || reduced ? { opacity: 1, y: 0 } : { opacity: 0, y: -24 }}
        transition={{ type: "spring", stiffness: 260, damping: 22 }}
      >
        <CsvIcon />
        <div>
          <p className="text-sm font-bold text-ink">march-payouts.csv</p>
          <p className="text-xs text-muted">email, amount, note</p>
        </div>
      </m.div>
      <SceneTable visible={rows} reduced={reduced} />
      <div className="mt-auto flex items-baseline justify-between gap-3 text-sm">
        <span className="text-muted">Showing 5 of {SAMPLE_PAYEES}</span>
        <span className="font-bold text-ink tabular-nums">
          {SAMPLE_PAYEES} payees · {formatCents(total)}
        </span>
      </div>
    </div>
  );
}

export function PaidScene({ play, reduced }: SceneProps) {
  const claimed = useTicker(play, SAMPLE_ROWS.length, { intervalMs: 520, delayMs: 400, instant: reduced });
  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <m.span
            key={reduced ? "static" : claimed}
            className="flex size-10 items-center justify-center rounded-full bg-cobalt"
            initial={{ scale: 1 }}
            animate={reduced || claimed === 0 ? undefined : { scale: [1, 1.14, 1] }}
            transition={{ duration: 0.35, ease: EASE_OUT }}
          >
            <PetalsMark size={22} color="var(--color-cream)" cutColor="var(--color-cobalt)" />
          </m.span>
          <p className="text-sm font-bold text-ink">Payout sent</p>
        </div>
        <StatusChip status={claimed === SAMPLE_ROWS.length ? "claimed" : "sent"} />
      </div>
      <SceneTable visible={SAMPLE_ROWS.length} claimed={claimed} showStatus reduced={reduced} />
      <p className="mt-auto text-sm text-muted tabular-nums">
        <span className="font-bold text-ink">{claimed} of {SAMPLE_ROWS.length} claimed</span> · showing 5 of {SAMPLE_PAYEES}
      </p>
    </div>
  );
}

export const SCENES = [FundScene, UploadScene, PaidScene] as const;

function Check() {
  return (
    <svg viewBox="0 0 16 16" className="size-3.5 text-success" aria-hidden>
      <path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CsvIcon() {
  return (
    <svg viewBox="0 0 40 48" className="h-12 w-10" aria-hidden>
      <path d="M6 2h20l12 12v28a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V6a4 4 0 0 1 4-4z" fill="var(--color-surface)" stroke="var(--color-line)" strokeWidth="2" />
      <path d="M26 2v8a4 4 0 0 0 4 4h8" fill="none" stroke="var(--color-line)" strokeWidth="2" />
      <rect x="7" y="26" width="26" height="12" rx="4" fill="var(--color-cobalt)" />
      <text x="20" y="35" textAnchor="middle" fontSize="8" fontWeight="700" fill="var(--color-cream)" fontFamily="var(--font-sans)">
        CSV
      </text>
    </svg>
  );
}
