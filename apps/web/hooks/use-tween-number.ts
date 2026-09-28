"use client";

import { useEffect, useRef, useState } from "react";

const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;

/** Eases a number toward `target` in either direction. `instant` jumps straight there. */
export function useTweenNumber(target: number, { durationMs = 800, instant = false } = {}): number {
  const [value, setValue] = useState(target);
  const current = useRef(target);

  useEffect(() => {
    const from = current.current;
    let id = 0;
    if (instant || from === target) {
      current.current = target;
      id = requestAnimationFrame(() => setValue(target));
      return () => cancelAnimationFrame(id);
    }
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      current.current = from + (target - from) * easeOutCubic(t);
      setValue(current.current);
      if (t < 1) id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [target, durationMs, instant]);

  return instant ? target : value;
}
