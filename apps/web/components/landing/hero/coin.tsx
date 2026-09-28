"use client";

import { m } from "motion/react";
import { COIN } from "./fan-layout";

const EASE_OUT = [0.2, 0.8, 0.2, 1] as const;

/** The single deposit. `pulseKey` changes on load and each time a wave leaves, replaying the pulse. */
export function Coin({ pulseKey, reduced }: { pulseKey: string; reduced: boolean }) {
  return (
    <div
      className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2"
      style={{ width: COIN, height: COIN }}
    >
      {!reduced && (
        <m.span
          key={`ripple-${pulseKey}`}
          className="absolute inset-0 rounded-full border-2 border-cobalt"
          initial={{ scale: 1, opacity: 0 }}
          animate={{ scale: [1, 1.7], opacity: [0.3, 0] }}
          transition={{ duration: 0.8, ease: EASE_OUT }}
        />
      )}
      <m.div
        key={`coin-${pulseKey}`}
        className="relative flex size-full items-center justify-center rounded-full bg-cobalt"
        initial={{ scale: 1 }}
        animate={reduced ? undefined : { scale: [1, 1.07, 0.97, 1] }}
        transition={{ duration: 0.45, times: [0, 0.35, 0.7, 1], ease: EASE_OUT }}
      >
        <span className="absolute inset-[7%] rounded-full border border-cream/25" />
        {/* eslint-disable-next-line @next/next/no-img-element -- tiny static SVG from the brand kit */}
        <img src="/brand/svg/mark/fanout-mark-cream.svg" alt="" width={52} height={41} />
      </m.div>
    </div>
  );
}
