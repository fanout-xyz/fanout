"use client";

import { m, useInView, useReducedMotion } from "motion/react";
import { useRef } from "react";
import { cn } from "@/lib/utils";
import { FeeTable } from "./fee-table";
import { DAYS, FANOUT_RESULT_CENTS, FEE_AT, SENT_CENTS, WIRE_FEES, WIRE_RESULT_CENTS, afterFees } from "./fees";
import { RaceLane } from "./race-lane";
import { useRace } from "./use-race";

const EASE_OUT = [0.2, 0.8, 0.2, 1] as const;

export function RaceSection() {
  const ref = useRef<HTMLElement>(null);
  const reduced = useReducedMotion() ?? false;
  const inView = useInView(ref, { once: true, amount: 0.3 });
  const race = useRace(inView, reduced);

  const wireAmount = race.wireDone ? WIRE_RESULT_CENTS : afterFees(race.feesApplied);
  const fanoutAmount = race.fanoutDone ? FANOUT_RESULT_CENTS : SENT_CENTS;

  return (
    <section
      ref={ref}
      data-theme="dark"
      aria-labelledby="race-title"
      className="border-y border-band-dark-border bg-band-dark py-20 text-cream lg:py-28"
    >
      <div className="mx-auto w-full max-w-[1280px] px-6">
        <p className="text-[13px] font-bold tracking-[0.12em] text-mint uppercase">Why it matters</p>
        <h2
          id="race-title"
          className="mt-4 max-w-[16ch] font-display text-[clamp(40px,6vw,64px)] leading-[1.05] tracking-[-0.03em] text-balance"
        >
          Five business days, or one block.
        </h2>

        <div className="mt-14 flex flex-col gap-12 lg:mt-20">
          <RaceLane
            label="Bank wire"
            progress={race.wire}
            done={race.wireDone}
            fromCents={SENT_CENTS}
            amountCents={wireAmount}
            reduced={reduced}
            above={WIRE_FEES.map((fee, i) =>
              i < race.feesApplied ? (
                <m.span
                  key={fee.label}
                  className={cn(
                    "absolute rounded-full bg-tangerine px-2.5 py-1.5 text-[13px] leading-none font-semibold whitespace-nowrap text-on-tangerine",
                    // Near the start, anchor left so the chip doesn't hang off the track.
                    FEE_AT[i] < 0.2 ? "-translate-x-4" : "-translate-x-1/2",
                    // Narrow screens: alternate chips onto a second row so neighbours can't collide.
                    i % 2 ? "bottom-9 md:bottom-1" : "bottom-1",
                  )}
                  style={{ left: `${FEE_AT[i] * 100}%` }}
                  initial={reduced ? false : { y: 10, opacity: 0, rotate: 0 }}
                  animate={{ y: 0, opacity: 1, rotate: i % 2 ? 3 : -3 }}
                  transition={{ duration: 0.22, ease: EASE_OUT }}
                >
                  {fee.label}
                </m.span>
              ) : null,
            )}
            below={DAYS.map((day, i) => (
              <span
                key={day}
                className="absolute -translate-x-1/2 text-[13px] font-medium text-cream/60"
                style={{ left: `${(i + 0.5) * 20}%` }}
              >
                {day}
              </span>
            ))}
          />

          <RaceLane
            label="Fanout"
            progress={race.fanout}
            done={race.fanoutDone}
            fromCents={SENT_CENTS}
            amountCents={fanoutAmount}
            reduced={reduced}
            endBadge={
              <m.span
                key="settled"
                className="absolute top-1/2 right-9 flex -translate-y-1/2 items-center gap-1.5 rounded-full bg-mint-surface px-2.5 py-1.5 text-[13px] leading-none font-semibold text-on-mint"
                initial={reduced ? false : { opacity: 0, x: 8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.22, ease: EASE_OUT }}
              >
                <svg viewBox="0 0 16 16" className="size-3 text-success" aria-hidden>
                  <path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Settled
              </m.span>
            }
          />
        </div>

        <div className="mt-10 flex flex-wrap items-center justify-between gap-4">
          <p className="text-[13px] text-cream/60">Illustrative example. Real fees vary by bank and corridor.</p>
          {race.finished && !reduced && (
            <button
              type="button"
              onClick={race.replay}
              className="rounded-sm text-sm font-bold text-cream underline underline-offset-4 outline-none hover:text-cream/80 focus-visible:ring-2 focus-visible:ring-cobalt-on-dark focus-visible:ring-offset-2 focus-visible:ring-offset-ink"
            >
              Replay
            </button>
          )}
        </div>

        <FeeTable />
      </div>
    </section>
  );
}
