/**
 * The board, as coordinates.
 *
 * Ludo is a ring of 52 squares wrapped around a cross-shaped board, with a
 * five-square private lane per player and a home triangle in the middle. Every
 * rule in this game is arithmetic on one number — how far a token has walked —
 * so the geometry lives here, once, and both the referee and the painter read it.
 *
 * The ring is written out rather than generated. A generator would have to be
 * checked against a picture of a real board anyway; the list *is* the picture,
 * and a mistake in it is visible at a glance instead of hiding in a loop.
 *
 * Coordinates are (col, row) on a 15×15 grid, x rightwards, y downwards.
 *
 * The ring, clockwise from the top-left player's start square:
 *   along the top of the left arm, up the left lane of the top arm, over its
 *   tip, down the right lane, along the right arm, down its right side, across
 *   the bottom of the bottom arm, back along the left arm's bottom lane and up
 *   its outer edge. Four elbows turn the agent through the corner of the home
 *   triangle, which is exactly how the squares meet on a printed board.
 */

export type Cell = readonly [number, number];

export const RING: readonly Cell[] = [
  /* left arm, upper lane, heading towards the middle */
  [1, 6], [2, 6], [3, 6], [4, 6], [5, 6],
  /* up the top arm's left lane */
  [6, 5], [6, 4], [6, 3], [6, 2], [6, 1], [6, 0],
  /* the tip */
  [7, 0],
  /* down the top arm's right lane */
  [8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5],
  /* right arm, upper lane */
  [9, 6], [10, 6], [11, 6], [12, 6], [13, 6], [14, 6],
  [14, 7],
  [14, 8], [13, 8], [12, 8], [11, 8], [10, 8], [9, 8],
  /* down the bottom arm's right lane */
  [8, 9], [8, 10], [8, 11], [8, 12], [8, 13], [8, 14],
  [7, 14],
  [6, 14], [6, 13], [6, 12], [6, 11], [6, 10], [6, 9],
  /* left arm, lower lane, heading back out */
  [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8],
  [0, 7],
  [0, 6],
];

/** Four home lanes, each five squares, ending next to the middle. */
export const HOME_LANES: readonly (readonly Cell[])[] = [
  [[1, 7], [2, 7], [3, 7], [4, 7], [5, 7]],      // from the left
  [[7, 1], [7, 2], [7, 3], [7, 4], [7, 5]],      // from the top
  [[13, 7], [12, 7], [11, 7], [10, 7], [9, 7]],  // from the right
  [[7, 13], [7, 12], [7, 11], [7, 10], [7, 9]],  // from the bottom
];

/** Where each seat's four tokens rest in the yard, in grid-line coordinates
 *  (a value of 1.75 is three-quarters of the way through the first square). */
const YARD_SPOTS = [[1.75, 1.75], [4.25, 1.75], [1.75, 4.25], [4.25, 4.25]] as const;
/** The top-left corner of each 6×6 yard, in squares. */
export const YARD_CORNER: readonly Cell[] = [[0, 0], [9, 0], [9, 9], [0, 9]];
export const YARDS: readonly (readonly Cell[])[] = YARD_CORNER.map(([cx, cy]) =>
  YARD_SPOTS.map(([x, y]) => [cx + x, cy + y] as const),
);

/** Ring index each seat starts on. 13 apart, one per arm. */
export const START = [0, 13, 26, 39] as const;

/** Ring indices that are safe: every start square, and the star eight past it. */
export const SAFE: ReadonlySet<number> = new Set([0, 13, 26, 39, 8, 21, 34, 47]);

/** How far a token walks: 51 ring squares (0…50), five lane squares (51…55), home (56). */
export const RING_STEPS = 51;
export const HOME_STEP = 56;

/** Which ring square a token sits on, given its seat and how far it has walked. */
export const ringIndexOf = (seat: number, progress: number): number | null =>
  progress >= 0 && progress < RING_STEPS ? (START[seat] + progress) % RING.length : null;

/** The grid square a token occupies at a given progress, ignoring the yard. */
export function cellFor(seat: number, progress: number, yardSpot = 0): Cell | null {
  if (progress < 0) return YARDS[seat][yardSpot] ?? YARDS[seat][0];
  if (progress >= HOME_STEP) return [7, 7];
  const ring = ringIndexOf(seat, progress);
  if (ring !== null) return RING[ring];
  return HOME_LANES[seat][progress - RING_STEPS];
}

export const isSafeRing = (seat: number, progress: number): boolean => {
  const ring = ringIndexOf(seat, progress);
  return ring !== null && SAFE.has(ring);
};

/** Every square a token passes through between two progress values, inclusive of the end. */
export function pathBetween(seat: number, from: number, to: number): Cell[] {
  const out: Cell[] = [];
  for (let p = Math.max(0, from); p <= to; p++) {
    const c = cellFor(seat, p);
    if (c) out.push(c);
  }
  return out;
}
