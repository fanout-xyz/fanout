"use client";

import { m } from "motion/react";

/**
 * The Fanout mark drawn as three separate petals so they can animate.
 * Geometry matches brand/svg/mark: rounded rects pivoting on (50, 80) at -38°, 0°, 38°.
 * The brand file separates petals with a mask; here each petal gets a stroke in
 * `cutColor` (the background it sits on) for the same gap.
 */
const PETALS = [
  { angle: -38, y: 16, h: 64 },
  { angle: 38, y: 16, h: 64 },
  { angle: 0, y: 12, h: 68 },
] as const;

type Props = {
  size: number;
  color?: string;
  cutColor: string;
  /** Play the one-time "fan out" brand moment on mount. */
  fanOut?: boolean;
  className?: string;
};

export function PetalsMark({ size, color = "var(--color-cobalt)", cutColor, fanOut = false, className }: Props) {
  return (
    <svg
      viewBox="8.49 14.5 83.03 65.54"
      width={size}
      height={(size * 65.54) / 83.03}
      className={className}
      aria-hidden
    >
      {PETALS.map((p, i) => (
        <m.rect
          key={p.angle}
          x={38}
          y={p.y}
          width={24}
          height={p.h}
          rx={12}
          fill={color}
          stroke={cutColor}
          strokeWidth={5}
          paintOrder="stroke"
          // Each petal pivots on its own bottom-centre, which is the mark's (50, 80).
          // motion manages SVG transform-origin itself, so it has to be set via originX/originY.
          style={{ originX: 0.5, originY: 1 }}
          initial={fanOut ? { scale: 0.8, rotate: 0 } : false}
          animate={{ scale: 1, rotate: p.angle }}
          transition={{ type: "spring", stiffness: 260, damping: 22, delay: fanOut ? i * 0.06 : 0 }}
        />
      ))}
    </svg>
  );
}
