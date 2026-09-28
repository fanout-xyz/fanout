// Landing spots around the coin, in design pixels relative to the stage centre.
// Two radii alternate (outer/inner, like petals) with small angle, distance and
// rotation jitter so it reads as organic. Found with a search that keeps every card
// at least 14px apart, inside the square, and clear of the coin. Listed clockwise from the top.

export const STAGE = 560;
export const CARD = { w: 108, h: 50 };
export const COIN = 104;

export const LANDINGS: { x: number; y: number; rot: number }[] = [
  { x: 61, y: -227, rot: -5 },
  { x: 107, y: -106, rot: 1.5 },
  { x: 212, y: -37, rot: -4 },
  { x: 147, y: 55, rot: -6 },
  { x: 153, y: 166, rot: 2.5 },
  { x: 23, y: 157, rot: 1.5 },
  { x: -54, y: 232, rot: 0.5 },
  { x: -99, y: 111, rot: 4.5 },
  { x: -207, y: 35, rot: -4 },
  { x: -137, y: -56, rot: 3.5 },
  { x: -145, y: -165, rot: -5 },
  { x: -21, y: -163, rot: 2.5 },
];

/** Cards leave in three waves; each wave is spread around the ring (indexes 0,3,6,9 / 1,4,7,10 / 2,5,8,11). */
export const WAVE_COUNT = 3;
export const waveOf = (index: number) => index % WAVE_COUNT;
