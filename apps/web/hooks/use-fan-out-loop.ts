"use client";

import { useEffect, useState } from "react";

export type FanState = {
  cycle: number;
  /** How many waves have left the coin (0 = all cards still gathered). */
  waves: number;
  claimed: boolean[];
  resetting: boolean;
};

/** Timeline of one cycle, in ms from its start. */
export const FAN_TIMELINE = {
  waveAt: [500, 950, 1400],
  claimsFrom: 2500,
  claimsSpread: 2500,
  resetAt: 7200,
  cycleMs: 8800,
} as const;

const fresh = (cycle: number, count: number): FanState => ({
  cycle,
  waves: 0,
  claimed: Array(count).fill(false),
  resetting: false,
});

/**
 * Drives the hero loop. Claim times are re-randomised every cycle so it looks like
 * people claiming at different moments. Pausing (e.g. scrolled away) stops the clock;
 * resuming starts a fresh cycle.
 */
export function useFanOutLoop(count: number, running: boolean): FanState {
  const [state, setState] = useState<FanState>(() => fresh(0, count));

  useEffect(() => {
    if (!running) return;
    let timers: ReturnType<typeof setTimeout>[] = [];
    const at = (ms: number, fn: () => void) => timers.push(setTimeout(fn, ms));

    const runCycle = () => {
      timers.forEach(clearTimeout);
      timers = [];
      at(0, () => setState((s) => fresh(s.cycle + 1, count)));
      FAN_TIMELINE.waveAt.forEach((ms, w) => at(ms, () => setState((s) => ({ ...s, waves: w + 1 }))));
      for (let i = 0; i < count; i++) {
        const ms = FAN_TIMELINE.claimsFrom + Math.random() * FAN_TIMELINE.claimsSpread;
        at(ms, () => setState((s) => ({ ...s, claimed: s.claimed.map((c, j) => c || j === i) })));
      }
      at(FAN_TIMELINE.resetAt, () => setState((s) => ({ ...s, resetting: true })));
      at(FAN_TIMELINE.cycleMs, runCycle);
    };

    runCycle();
    return () => timers.forEach(clearTimeout);
  }, [running, count]);

  return state;
}
