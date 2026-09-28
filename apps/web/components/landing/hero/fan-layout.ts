// Landing spots in design pixels, relative to the stage centre.
// Two concentric arcs around the coin, opening to the right like petals: 7 on the
// outer arc (r=248), 5 on the inner (r=126), each spanning ±124° with an even angle
// step. Rotation follows the arc from −8° (top) to +8° (bottom). Solved numerically
// so every card is ≥12px from its neighbours (min is 14px), inside the square and
// clear of the coin. Order: outer arc top→bottom, then inner arc top→bottom.

export const STAGE = 560;
export const CARD = { w: 108, h: 50 };
export const COIN = 104;
/** The coin sits left of centre so the arcs have room to open to the right. */
export const COIN_AT = { x: -80, y: 0 };

export const LANDINGS: { x: number; y: number; rot: number }[] = [
  { x: -219, y: -206, rot: -8 },
  { x: -48, y: -246, rot: -5.3 },
  { x: 106, y: -164, rot: -2.7 },
  { x: 168, y: 0, rot: 0 },
  { x: 106, y: 164, rot: 2.7 },
  { x: -48, y: 246, rot: 5.3 },
  { x: -219, y: 206, rot: 8 },
  { x: -150, y: -104, rot: -8 },
  { x: -21, y: -111, rot: -4 },
  { x: 46, y: 0, rot: 0 },
  { x: -21, y: 111, rot: 4 },
  { x: -150, y: 104, rot: 8 },
];

/** Cards leave in three waves; indexes are interleaved so each wave spreads across both arcs. */
export const WAVE_COUNT = 3;
export const waveOf = (index: number) => index % WAVE_COUNT;
