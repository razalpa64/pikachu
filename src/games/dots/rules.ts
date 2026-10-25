import type { Outcome, Slot, TurnGameRules } from '../types';

/**
 * Dots & Boxes.
 *
 * A grid of dots; each turn you draw one line between two neighbours. Complete the
 * fourth side of a box and you claim it — and you move again. When every box is
 * claimed the player holding more of them wins. That "move again" rule is the
 * entire game: it is why handing over the third side of a box is a gift, and why
 * long chains are decided by who is forced to open first.
 *
 * Coordinates: `h[i]` is a horizontal line, `v[i]` a vertical one, `boxes[i]` a
 * square. The `cols`/`rows` in the config count **dots**, not boxes.
 */

export const DOTS_COLS = 5;
export const DOTS_ROWS = 5;

export interface DotsEdge { o: 'h' | 'v'; i: number }

export interface DotsState {
  cols: number;
  rows: number;
  h: boolean[];
  v: boolean[];
  boxes: (Slot | null)[];
  turn: Slot;
  scores: [number, number];
  last: DotsEdge | null;
  /** how many boxes the last move claimed, so the UI can celebrate a chain */
  lastGain: number;
  over: boolean;
  winner: Slot | null;
  reason: string;
  history: DotsEdge[];
}

export type DotsMove = DotsEdge;

export const boxCount = (cols: number, rows: number) => (cols - 1) * (rows - 1);
const hAt = (s: { cols: number }, r: number, c: number) => r * (s.cols - 1) + c;
const vAt = (s: { cols: number }, r: number, c: number) => r * s.cols + c;

/** The boxes a given edge borders, as box indices. */
export function boxesTouching(s: DotsState, e: DotsEdge): number[] {
  const out: number[] = [];
  const bw = s.cols - 1, bh = s.rows - 1;
  if (e.o === 'h') {
    const r = Math.floor(e.i / bw), c = e.i % bw;
    if (r > 0) out.push((r - 1) * bw + c);
    if (r < bh) out.push(r * bw + c);
  } else {
    const r = Math.floor(e.i / s.cols), c = e.i % s.cols;
    if (c > 0) out.push(r * bw + (c - 1));
    if (c < bw) out.push(r * bw + c);
  }
  return out;
}

/** Sides of box `b` that are already drawn. */
export function sidesOf(s: DotsState, b: number): number {
  const bw = s.cols - 1;
  const r = Math.floor(b / bw), c = b % bw;
  return Number(s.h[hAt(s, r, c)])
    + Number(s.h[hAt(s, r + 1, c)])
    + Number(s.v[vAt(s, r, c)])
    + Number(s.v[vAt(s, r, c + 1)]);
}

export function isDrawn(s: DotsState, e: DotsEdge): boolean {
  if (e.o === 'h') return !!s.h[e.i];
  return !!s.v[e.i];
}

export function allEdges(s: DotsState): DotsEdge[] {
  const out: DotsEdge[] = [];
  for (let i = 0; i < s.h.length; i++) out.push({ o: 'h', i });
  for (let i = 0; i < s.v.length; i++) out.push({ o: 'v', i });
  return out;
}

function withEdge(s: DotsState, e: DotsEdge): DotsState {
  if (e.o === 'h') { const h = s.h.slice(); h[e.i] = true; return { ...s, h }; }
  const v = s.v.slice(); v[e.i] = true;
  return { ...s, v };
}

/** Claim every box that the freshly drawn edge completed. Returns the new state. */
function claim(s: DotsState, e: DotsEdge, p: Slot): { state: DotsState; gained: number } {
  const boxes = s.boxes.slice();
  let gained = 0;
  for (const b of boxesTouching(s, e)) {
    if (boxes[b] === null && sidesOf(s, b) === 4) { boxes[b] = p; gained++; }
  }
  if (!gained) return { state: s, gained: 0 };
  const scores: [number, number] = [s.scores[0], s.scores[1]];
  scores[p] += gained;
  return { state: { ...s, boxes, scores }, gained };
}

export const dotsRules: TurnGameRules<DotsState, DotsMove> = {
  id: 'dots',
  createInitialState(config) {
    const side = Number(config.size ?? 0) || 0;
    const cols = Math.max(3, Math.min(9, Number(config.cols ?? (side || DOTS_COLS))));
    const rows = Math.max(3, Math.min(9, Number(config.rows ?? (side || DOTS_ROWS))));
    return {
      cols, rows,
      h: Array(rows * (cols - 1)).fill(false),
      v: Array((rows - 1) * cols).fill(false),
      boxes: Array(boxCount(cols, rows)).fill(null),
      turn: 0, scores: [0, 0], last: null, lastGain: 0,
      over: false, winner: null, reason: '', history: [],
    };
  },

  currentPlayer: (s) => (s.over ? null : s.turn),

  legalMoves(s, p) {
    if (s.over || s.turn !== p) return [];
    return allEdges(s).filter((e) => !isDrawn(s, e));
  },

  isLegal(s, p, m): m is DotsMove {
    const mv = m as DotsMove;
    if (!mv || (mv.o !== 'h' && mv.o !== 'v') || typeof mv.i !== 'number' || !Number.isInteger(mv.i)) return false;
    if (s.over || s.turn !== p) return false;
    const list = mv.o === 'h' ? s.h : s.v;
    return mv.i >= 0 && mv.i < list.length && !list[mv.i];
  },

  applyMove(s, p, m) {
    if (!this.isLegal(s, p, m)) return s;
    const drawn = withEdge(s, m);
    const { state, gained } = claim(drawn, m, p);
    const left = state.boxes.some((b) => b === null);
    const next: DotsState = {
      ...state, last: m, lastGain: gained,
      history: [...s.history, m],
      turn: gained > 0 ? p : (p === 0 ? 1 : 0),
    };
    if (!left) {
      return {
        ...next, over: true,
        winner: state.scores[0] === state.scores[1] ? null : state.scores[0] > state.scores[1] ? 0 : 1,
        reason: 'every box claimed',
      };
    }
    return next;
  },

  result: (s): Outcome => (s.over ? { over: true, winner: s.winner, reason: s.reason } : { over: false }),

  describeMove: (_s, p, m) => `${p === 0 ? 'Volt' : 'Spark'} draws a ${m.o === 'h' ? 'flat' : 'upright'} line`,
};

/* ------------------------------------------------------------------ helpers for UI + AI */

/** Boxes that would be completed by playing `e`, right now. */
export function boxesFor(s: DotsState, e: DotsEdge): number[] {
  return boxesTouching(s, e).filter((b) => s.boxes[b] === null && sidesOf(s, b) === 3);
}
