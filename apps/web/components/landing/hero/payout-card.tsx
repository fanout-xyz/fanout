"use client";

import { m, type Transition } from "motion/react";
import { CARD } from "./fan-layout";
import { curveKeyframes } from "./curve";
import { formatCents, type DemoPayee } from "./payees";

const EASE_OUT = [0.2, 0.8, 0.2, 1] as const;
const SPRING = { type: "spring", stiffness: 260, damping: 22 } as const;
const FLIGHT_S = 0.8;
const STAGGER_S = 0.05;

type Props = {
  payee: DemoPayee;
  /** Landing spot relative to the stage centre. */
  land: { x: number; y: number; rot: number };
  /** Position within its wave, for the stagger. */
  order: number;
  released: boolean;
  claimed: boolean;
  resetting: boolean;
  reduced: boolean;
};

export function PayoutCard({ payee, land, order, released, claimed, resetting, reduced }: Props) {
  // Offsets are relative to the landing spot, so (-land) is the coin's centre.
  const home = { x: -land.x, y: -land.y };
  const path = curveKeyframes(home); // 15 points, cheap enough to recompute
  const startTilt = land.x > 0 ? -18 : 18;

  let animate;
  let transition: Transition;
  if (reduced) {
    animate = { x: 0, y: 0, scale: 1, opacity: 1, rotate: land.rot };
    transition = { duration: 0 };
  } else if (resetting) {
    animate = { x: home.x * 0.85, y: home.y * 0.85, scale: 0.6, opacity: 0, rotate: 0 };
    transition = { duration: 0.45, ease: EASE_OUT, delay: order * 0.03 };
  } else if (released) {
    const delay = order * STAGGER_S;
    animate = { x: path.x, y: path.y, scale: 1, opacity: 1, rotate: land.rot };
    transition = {
      x: { duration: FLIGHT_S, ease: "linear", delay },
      y: { duration: FLIGHT_S, ease: "linear", delay },
      scale: { ...SPRING, delay: delay + 0.1 },
      rotate: { ...SPRING, delay: delay + 0.1 },
      opacity: { duration: 0.15, ease: EASE_OUT, delay },
    };
  } else {
    animate = { x: home.x, y: home.y, scale: 0.35, opacity: 0, rotate: startTilt };
    transition = { duration: 0 };
  }

  return (
    <m.div
      className="absolute"
      style={{
        left: `calc(50% + ${land.x - CARD.w / 2}px)`,
        top: `calc(50% + ${land.y - CARD.h / 2}px)`,
        width: CARD.w,
        height: CARD.h,
        perspective: 600,
      }}
      initial={false}
      animate={animate}
      transition={transition}
    >
      <m.div
        className="relative size-full"
        style={{ transformStyle: "preserve-3d" }}
        initial={false}
        animate={{ rotateX: claimed ? 180 : 0 }}
        transition={claimed && !reduced ? { duration: 0.5, ease: EASE_OUT } : { duration: 0 }}
      >
        <div className="absolute inset-0 flex flex-col justify-center gap-0.5 rounded-md border border-line bg-surface px-3 [backface-visibility:hidden]">
          <span className="flex items-center gap-1.5 text-xs leading-tight font-semibold text-ink">
            <span aria-hidden>{payee.flag}</span>
            {payee.name}
          </span>
          <span className="text-sm leading-tight font-bold text-ink tabular-nums">{formatCents(payee.cents)}</span>
        </div>
        <div className="absolute inset-0 flex flex-col justify-center gap-0.5 rounded-md bg-mint px-3 [backface-visibility:hidden] [transform:rotateX(180deg)]">
          <span className="flex items-center gap-1 text-xs leading-tight font-bold text-success">
            <CheckIcon />
            Claimed
          </span>
          <span className="text-sm leading-tight font-bold text-ink tabular-nums">{formatCents(payee.cents)}</span>
        </div>
      </m.div>
    </m.div>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 16 16" className="size-3" aria-hidden>
      <path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
