"use client";

import { useEffect, useRef, useState } from "react";

const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;

/**
 * Animates a number toward `target`, easing out. Counts up over `durationMs`;
 * drops instantly when the target goes down (e.g. a reset) or when `instant` is set.
 */
export function useCountUp(target: number, { durationMs = 700, instant = false } = {}): number {
  const [value, setValue] = useState(target);
  const fromRef = useRef(target);

  useEffect(() => {
    const from = fromRef.current;
    if (instant || target <= from) {
      fromRef.current = target;
      const id = requestAnimationFrame(() => setValue(target));
      return () => cancelAnimationFrame(id);
    }
    const start = performance.now();
    let id = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      const next = from + (target - from) * easeOutCubic(t);
      fromRef.current = next;
      setValue(next);
      if (t < 1) id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [target, durationMs, instant]);

  // Drops show immediately, without waiting a frame for the state update.
  return instant ? target : Math.min(value, target);
}
