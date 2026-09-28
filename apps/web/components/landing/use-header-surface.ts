"use client";

import { useMotionValueEvent, useScroll } from "motion/react";
import { useEffect, useState } from "react";

export type HeaderSurface = "top" | "light" | "dark";

const SCROLLED_AFTER = 24;
/** Sample the header's vertical middle. */
const PROBE_Y = 36;

/**
 * What the sticky header is floating over: "top" (not scrolled yet), "light", or
 * "dark" when it overlaps an element marked data-theme="dark" (the race, the CTA band).
 */
export function useHeaderSurface(): HeaderSurface {
  const { scrollY } = useScroll();
  const [surface, setSurface] = useState<HeaderSurface>("top");

  const measure = (y: number) => {
    if (y <= SCROLLED_AFTER) return setSurface("top");
    const overDark = [...document.querySelectorAll<HTMLElement>('main [data-theme="dark"]')].some((el) => {
      const r = el.getBoundingClientRect();
      return r.top <= PROBE_Y && r.bottom >= PROBE_Y;
    });
    setSurface(overDark ? "dark" : "light");
  };

  useMotionValueEvent(scrollY, "change", measure);
  // A reload can land mid-page; measure once after the first frame.
  useEffect(() => {
    const id = requestAnimationFrame(() => measure(window.scrollY));
    return () => cancelAnimationFrame(id);
  }, []);

  return surface;
}
