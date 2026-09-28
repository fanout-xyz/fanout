"use client";

import { domAnimation, LazyMotion } from "motion/react";
import type { ReactNode } from "react";

/** Loads motion's DOM features once per page tree (components use `m.*` under strict mode). */
export function MotionRoot({ children }: { children: ReactNode }) {
  return (
    <LazyMotion features={domAnimation} strict>
      {children}
    </LazyMotion>
  );
}
