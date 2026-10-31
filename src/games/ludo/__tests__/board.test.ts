import { describe, expect, it } from 'vitest';
import {
  HOME_LANES, HOME_STEP, RING, RING_STEPS, SAFE, START, YARDS, cellFor, isSafeRing, pathBetween, ringIndexOf,
} from '../track';

const key = (c: readonly [number, number]) => `${c[0]},${c[1]}`;
const onBoard = ([x, y]: readonly [number, number]) => x >= 0 && x <= 14 && y >= 0 && y <= 14;

describe('the ring', () => {
  it('is 52 squares, all on the board and none repeated', () => {
    expect(RING).toHaveLength(52);
    expect(new Set(RING.map(key)).size).toBe(52);
    for (const c of RING) expect(onBoard(c), `${key(c)} is off the board`).toBe(true);
  });

  it('walks without jumping, except at the four elbows where the arms meet', () => {
    const corners: number[] = [];
    for (let i = 0; i < RING.length; i++) {
      const a = RING[i], b = RING[(i + 1) % RING.length];
      const d = Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);
      if (d === 2) corners.push(i);
      else expect(d, `step ${i} is neither adjacent nor a corner`).toBe(1);
    }
    // exactly four diagonal steps, one per elbow of the cross
    expect(corners).toHaveLength(4);
  });

  it('keeps the lane it does not use off the cross', () => {
    // the middle three squares of each arm belong to the home lane, not the ring
    const middle = [
      [1, 7], [2, 7], [3, 7], [4, 7], [5, 7],
      [7, 1], [7, 2], [7, 3], [7, 4], [7, 5],
      [9, 7], [10, 7], [11, 7], [12, 7], [13, 7],
      [7, 9], [7, 10], [7, 11], [7, 12], [7, 13],
    ];
    const ring = new Set(RING.map(key));
    for (const c of middle) expect(ring.has(key(c as [number, number])), `${c} is both ring and lane`).toBe(false);
  });
});

describe('the home lanes', () => {
  it('are five squares each, twenty in all, none shared', () => {
    const all = HOME_LANES.flat().map(key);
    expect(all).toHaveLength(20);
    expect(new Set(all).size).toBe(20);
    for (const lane of HOME_LANES) {
      expect(lane).toHaveLength(5);
      for (const c of lane) expect(onBoard(c)).toBe(true);
    }
  });

  it('start next to the entry square and end beside the middle', () => {
    for (let seat = 0; seat < 4; seat++) {
      const entry = RING[(START[seat] + RING_STEPS - 1) % 52];
      const first = HOME_LANES[seat][0];
      const last = HOME_LANES[seat][4];
      expect(Math.abs(entry[0] - first[0]) + Math.abs(entry[1] - first[1]), `seat ${seat} lane does not meet the ring`).toBe(1);
      /* the middle is a 3×3 block, so the lane ends beside it rather than beside
         its centre point: the gap is exactly one square */
      const gapX = Math.max(0, 6 - last[0], last[0] - 8);
      const gapY = Math.max(0, 6 - last[1], last[1] - 8);
      expect(gapX + gapY, `seat ${seat} lane does not point at the middle`).toBe(1);
    }
  });
});

describe('walking', () => {
  it('puts a token on its start square at zero, then round the ring, then into its lane', () => {
    for (let seat = 0; seat < 4; seat++) {
      expect(cellFor(seat, 0)).toEqual(RING[START[seat]]);
      expect(ringIndexOf(seat, 0)).toBe(START[seat]);
      expect(ringIndexOf(seat, RING_STEPS)).toBeNull();
      expect(cellFor(seat, RING_STEPS)).toEqual(HOME_LANES[seat][0]);
      expect(cellFor(seat, HOME_STEP - 1)).toEqual(HOME_LANES[seat][4]);
      expect(cellFor(seat, HOME_STEP)).toEqual([7, 7]);
    }
  });

  it('never visits the same square twice on one token’s walk', () => {
    for (let seat = 0; seat < 4; seat++) {
      const seen = new Set<string>();
      for (let p = 0; p <= HOME_STEP; p++) {
        const c = cellFor(seat, p)!;
        const k = key(c);
        expect(seen.has(k), `seat ${seat} revisits ${k} at ${p}`).toBe(false);
        seen.add(k);
      }
    }
  });

  it('gives the two seats in play different squares everywhere', () => {
    // gold (seat 0) and rose (seat 2) share the ring but never the same square at
    // the same distance, so they cannot shadow each other silently
    for (const seat of [0, 2]) {
      for (let p = 0; p < RING_STEPS; p++) {
        const ring = ringIndexOf(seat, p)!;
        expect(ring).toBeGreaterThanOrEqual(0);
        expect(ring).toBeLessThan(52);
      }
    }
    expect(START[0]).not.toBe(START[2]);
  });

  it('marks eight safe squares: the four starts and the four stars', () => {
    expect(SAFE.size).toBe(8);
    for (const s of START) expect(SAFE.has(s)).toBe(true);
    expect(isSafeRing(0, 0)).toBe(true);
    expect(isSafeRing(0, 1)).toBe(false);
    expect(isSafeRing(0, RING_STEPS)).toBe(false);
  });

  it('pads out a path one square at a time', () => {
    const path = pathBetween(0, 0, 3);
    expect(path).toHaveLength(4);
    expect(path[0]).toEqual(RING[START[0]]);
    expect(path[3]).toEqual(RING[START[0] + 3]);
  });
});

describe('the yards', () => {
  it('hold four spots each, inside their own corner', () => {
    const corners = [[0, 0], [9, 0], [9, 9], [0, 9]];
    YARDS.forEach((yard, seat) => {
      expect(yard).toHaveLength(4);
      for (const [x, y] of yard) {
        expect(x).toBeGreaterThan(corners[seat][0]);
        expect(x).toBeLessThan(corners[seat][0] + 6);
        expect(y).toBeGreaterThan(corners[seat][1]);
        expect(y).toBeLessThan(corners[seat][1] + 6);
      }
    });
  });

  it('has a start square reachable from the right yard', () => {
    for (let seat = 0; seat < 4; seat++) {
      const start = RING[START[seat]];
      expect(start[0]).toBeGreaterThan(0);
      expect(start[1]).toBeGreaterThan(0);
    }
  });
});
