"use client";

import { useEffect, useRef, useState } from "react";

const easeOutQuart = (t: number) => 1 - (1 - t) ** 4;

/** Counts from where it is (zero at first) to `target`, easing out. `instant` jumps there. */
function useCountFromZero(target: number, durationMs: number, instant: boolean): number {
  const [value, setValue] = useState(0);
  const from = useRef(0);

  useEffect(() => {
    if (instant) return;
    const start = performance.now();
    const origin = from.current;
    let id = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      from.current = origin + (target - origin) * easeOutQuart(t);
      setValue(from.current);
      if (t < 1) id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [target, durationMs, instant]);

  return instant ? target : value;
}

/**
 * A number that counts up the first time it shows. Screen readers get the final value straight
 * away; the moving digits are hidden from them. Tabular digits keep the width steady.
 */
export function CountUp({
  value,
  format,
  reduced,
  durationMs = 900,
  className,
}: {
  value: number;
  format: (n: number) => string;
  reduced: boolean;
  durationMs?: number;
  className?: string;
}) {
  const shown = useCountFromZero(value, durationMs, reduced);
  return (
    <span className={className}>
      <span className="sr-only">{format(value)}</span>
      <span aria-hidden className="tabular-nums">
        {format(shown)}
      </span>
    </span>
  );
}
