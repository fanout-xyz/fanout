"use client";

import { useEffect, useState, type RefObject } from "react";

/** Index of the step element that crosses the middle of the viewport. */
export function useActiveStep(refs: RefObject<(HTMLElement | null)[]>, count: number): [number, (i: number) => void] {
  const [active, setActive] = useState(0);

  useEffect(() => {
    const els = refs.current.slice(0, count).filter((el): el is HTMLElement => !!el);
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setActive(Number((entry.target as HTMLElement).dataset.step));
        }
      },
      { rootMargin: "-50% 0px -50% 0px" },
    );
    els.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [refs, count]);

  return [active, setActive];
}
