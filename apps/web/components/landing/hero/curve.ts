const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;

/**
 * Keyframes along a quadratic curve from `from` to (0,0), bowing to one side so
 * each card swings out like a petal opening. Points are sampled at eased times,
 * so linear playback between them still eases out overall.
 */
export function curveKeyframes(from: { x: number; y: number }, bend = 0.3, samples = 14) {
  const vx = -from.x;
  const vy = -from.y;
  const len = Math.hypot(vx, vy) || 1;
  // Control point: midpoint pushed along the perpendicular (always the same side -> consistent swirl).
  const cx = from.x + vx / 2 + (-vy / len) * len * bend;
  const cy = from.y + vy / 2 + (vx / len) * len * bend;
  const xs: number[] = [];
  const ys: number[] = [];
  for (let k = 0; k <= samples; k++) {
    const t = easeOutCubic(k / samples);
    const u = 1 - t;
    xs.push(u * u * from.x + 2 * u * t * cx);
    ys.push(u * u * from.y + 2 * u * t * cy);
  }
  return { x: xs, y: ys };
}
