"use client";

import { useEffect, useState } from "react";

/**
 * Counts 0 -> `count`, one tick every `intervalMs` after `delayMs`, while `play` is true.
 * Resets to 0 when `play` turns false. `instant` returns `count` straight away.
 */
export function useTicker(
  play: boolean,
  count: number,
  { intervalMs = 400, delayMs = 0, instant = false } = {},
): number {
  const [ticks, setTicks] = useState(0);

  useEffect(() => {
    if (!play || instant) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (let i = 1; i <= count; i++) timers.push(setTimeout(() => setTicks(i), delayMs + (i - 1) * intervalMs));
    return () => {
      timers.forEach(clearTimeout);
      setTicks(0);
    };
  }, [play, count, intervalMs, delayMs, instant]);

  return instant ? count : ticks;
}
