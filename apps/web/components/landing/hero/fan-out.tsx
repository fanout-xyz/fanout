"use client";

import { domAnimation, LazyMotion, useInView, useReducedMotion } from "motion/react";
import { useRef } from "react";
import { useCountUp } from "@/hooks/use-count-up";
import { useFanOutLoop } from "@/hooks/use-fan-out-loop";
import { useStageScale } from "@/hooks/use-stage-scale";
import { Coin } from "./coin";
import { LANDINGS, STAGE, waveOf } from "./fan-layout";
import { DEMO_PAYEES, formatCents } from "./payees";
import { PayoutCard } from "./payout-card";

const TOTAL = DEMO_PAYEES.length;

/**
 * Hero signature moment: one coin releases three waves of payout cards along curved
 * paths; people then claim at random moments. Real DOM text, transform/opacity only.
 * The square box is sized in CSS, so nothing shifts when the animation mounts.
 */
export function FanOut() {
  const boxRef = useRef<HTMLDivElement>(null);
  const scale = useStageScale(boxRef, STAGE);
  const reduced = useReducedMotion() ?? false;
  const inView = useInView(boxRef, { amount: 0.3 });
  const loop = useFanOutLoop(TOTAL, scale !== null && inView && !reduced);

  const claimed = reduced ? DEMO_PAYEES.map(() => true) : loop.claimed;
  const claimedCount = claimed.filter(Boolean).length;
  const claimedCents = DEMO_PAYEES.reduce((sum, p, i) => sum + (claimed[i] ? p.cents : 0), 0);
  const shownCents = useCountUp(claimedCents, { durationMs: 700, instant: reduced });

  return (
    <LazyMotion features={domAnimation} strict>
      <figure className="mx-auto flex w-full max-w-[560px] flex-col items-center lg:max-w-[min(560px,calc(100svh-12rem))]">
        <div
          ref={boxRef}
          role="img"
          aria-label="Animation: one deposit splits into twelve payouts to people in different countries, and each one gets claimed."
          className="relative aspect-square w-full"
        >
          {scale !== null && (
            <div
              aria-hidden
              className="absolute top-0 left-0"
              style={{ width: STAGE, height: STAGE, transform: `scale(${scale})`, transformOrigin: "0 0" }}
            >
              {LANDINGS.map((land, i) => (
                <PayoutCard
                  key={DEMO_PAYEES[i].name}
                  payee={DEMO_PAYEES[i]}
                  land={land}
                  order={Math.floor(i / 3)}
                  released={loop.waves > waveOf(i)}
                  claimed={claimed[i]}
                  resetting={loop.resetting}
                  reduced={reduced}
                />
              ))}
              <Coin pulseKey={`${loop.cycle}-${loop.waves}`} reduced={reduced} />
            </div>
          )}
        </div>
        <figcaption className="mt-4 flex flex-col items-center gap-1">
          <span aria-hidden className="text-sm font-semibold text-foreground tabular-nums">
            {claimedCount} of {TOTAL} claimed · {formatCents(Math.round(shownCents))}
          </span>
          <span className="text-xs tracking-[0.01em] text-muted">Illustrative example</span>
        </figcaption>
      </figure>
    </LazyMotion>
  );
}
