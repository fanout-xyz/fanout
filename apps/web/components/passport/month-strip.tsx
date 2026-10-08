"use client";

import { useState } from "react";
import { formatCents } from "@/lib/money";
import { monthLabel } from "@/lib/payee/passport";
import type { MonthTotal } from "@/lib/payee/passport-stats";
import { cn } from "@/lib/utils";

const INITIALS = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];
const LEVELS = ["bg-primary/25", "bg-primary/45", "bg-primary/70", "bg-primary"] as const;

/** Paid months shade by how they compare with the best month: four steps, so it reads at a glance. */
function level(cents: number, max: number): number {
  if (cents <= 0 || max <= 0) return -1;
  return Math.min(3, Math.floor((cents / max) * 4 - 1e-9));
}

/**
 * Month by month, one row per year, like a wall calendar. Tap a month to read its total.
 * Months before the first payout or still to come are drawn as dots, not as empty months.
 */
export function MonthStrip({ months, reduced }: { months: MonthTotal[]; reduced: boolean }) {
  const byMonth = new Map(months.map((m) => [m.month, m]));
  const max = Math.max(0, ...months.map((m) => m.cents));
  const years = [...new Set(months.map((m) => Number(m.month.slice(0, 4))))].sort((a, b) => b - a);
  const latestPaid = [...months].reverse().find((m) => m.payouts > 0)?.month ?? null;
  const [picked, setPicked] = useState<string | null>(latestPaid);
  const current = picked ? byMonth.get(picked) : undefined;

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-[auto_repeat(12,minmax(0,1fr))] items-center gap-x-1.5 gap-y-2">
        <span />
        {INITIALS.map((l, i) => (
          <span key={i} aria-hidden className="text-center text-[11px] font-semibold text-muted">
            {l}
          </span>
        ))}
        {years.map((year, row) => (
          <Row key={year} year={year} row={row} byMonth={byMonth} max={max} picked={picked} onPick={setPicked} reduced={reduced} />
        ))}
      </div>
      <p className="flex h-6 items-baseline justify-between gap-3 text-sm" aria-live="polite">
        {current ? (
          <>
            <span className="font-semibold">{monthLabel(current.month)}</span>
            <span className="text-muted tabular-nums">
              {current.payouts === 0 ? (
                "No payouts"
              ) : (
                <>
                  <span className="font-bold text-foreground">{formatCents(current.cents)}</span> · {current.payouts}{" "}
                  {current.payouts === 1 ? "payout" : "payouts"}
                </>
              )}
            </span>
          </>
        ) : (
          <span className="text-muted">Tap a month to see what came in.</span>
        )}
      </p>
    </div>
  );
}

function Row({
  year,
  row,
  byMonth,
  max,
  picked,
  onPick,
  reduced,
}: {
  year: number;
  row: number;
  byMonth: Map<string, MonthTotal>;
  max: number;
  picked: string | null;
  onPick: (m: string) => void;
  reduced: boolean;
}) {
  return (
    <>
      <span className="pr-1 text-xs font-bold text-muted tabular-nums">{year}</span>
      {INITIALS.map((_, i) => {
        const month = `${year}-${String(i + 1).padStart(2, "0")}`;
        const m = byMonth.get(month);
        const delay = reduced ? undefined : { animationDelay: `${row * 60 + i * 22}ms` };
        if (!m) {
          return (
            <span key={month} aria-hidden className="flex aspect-square items-center justify-center">
              <span className="size-1 rounded-full bg-line" />
            </span>
          );
        }
        const lvl = level(m.cents, max);
        const selected = picked === month;
        return (
          <button
            key={month}
            type="button"
            onClick={() => onPick(month)}
            aria-pressed={selected}
            aria-label={`${monthLabel(month)}: ${m.payouts ? `${formatCents(m.cents)} from ${m.payouts} ${m.payouts === 1 ? "payout" : "payouts"}` : "no payouts"}`}
            style={delay}
            className={cn(
              "aspect-square rounded-[6px] outline-none",
              "transition-transform duration-150 ease-out active:scale-90",
              "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-surface",
              "motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-75 motion-safe:fill-mode-both motion-safe:duration-300",
              lvl < 0 ? "border border-dashed border-line" : LEVELS[lvl],
              selected && "ring-2 ring-foreground ring-offset-2 ring-offset-surface",
            )}
          />
        );
      })}
    </>
  );
}
