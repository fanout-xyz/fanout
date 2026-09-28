"use client";

import { domAnimation, LazyMotion } from "motion/react";
import type { ReactNode } from "react";

/** Loads motion's DOM features once for the landing sections (they use `m.*`). */
export function MotionRoot({ children }: { children: ReactNode }) {
  return (
    <LazyMotion features={domAnimation} strict>
      {children}
    </LazyMotion>
  );
}
