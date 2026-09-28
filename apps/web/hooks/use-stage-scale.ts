"use client";

import { useLayoutEffect, useState, type RefObject } from "react";

/** Scale factor that fits a square design of `designSize` px into the element's width. */
export function useStageScale(ref: RefObject<HTMLElement | null>, designSize: number): number | null {
  const [scale, setScale] = useState<number | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = (width: number) => setScale(Math.min(1, width / designSize));
    // Measure once now: ResizeObserver only reports on the next rendered frame.
    update(el.getBoundingClientRect().width);
    const observer = new ResizeObserver(([entry]) => update(entry.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, designSize]);

  return scale;
}
