import type { Outcome, Slot, TurnGameRules } from '../types';

/**
 * Reversi (Othello).
 *
 * The whole game is one rule — place a disc so that at least one straight line of
 * your opponent's discs is bracketed by your new disc and one of your own — and
 * everything else follows from it: the flips, the pass, the wipe-out.
 *
 * Two consequences that a naive implementation gets wrong and this one does not:
 *   • a player with no legal move must **pass**, and the same player moves again;
 *   • when neither player can move the game is over and the discs are counted,
 *     which can happen with empty squares still on the board.
 *
 * Slot 0 (butter) moves first, as black does in the printed game.
 */

export const R_SIZE = 8;

export type Cell = Slot | null;

export interface ReversiState {
  size: number;
  /** row-major, 0 = top-left */
  board: Cell[];
  turn: Slot;
  last: { cell: number; flipped: number[] } | null;
  /** who was skipped going into this turn, so the UI can say "they had to pass" */
  passed: Slot | null;
  counts: [number, number];
  over: boolean;
  winner: Slot | null;
  reason: string;
  history: number[];
}

export type ReversiMove = { cell: number };

const DIRS: ReadonlyArray<readonly [number, number]> = [
  [-1, -1], [-1, 0], [-1, 1],
  [0, -1], [0, 1],
  [1, -1], [1, 0], [1, 1],
];

export const idx = (s: number, r: number, c: number) => r * s + c;
export const rc = (s: number, i: number) => [Math.floor(i / s), i % s] as const;

/** Discs of `who`'s opponent that a disc at `cell` would flip. Empty if illegal. */
export function flipsFor(board: Cell[], size: number, cell: number, who: Slot): number[] {
  if (cell < 0 || cell >= size * size || board[cell] !== null) return [];
  const foe: Slot = who === 0 ? 1 : 0;
  const [r0, c0] = rc(size, cell);
  const out: number[] = [];
  for (const [dr, dc] of DIRS) {
    const line: number[] = [];
    let r = r0 + dr, c = c0 + dc;
    while (r >= 0 && r < size && c >= 0 && c < size && board[idx(size, r, c)] === foe) {
      line.push(idx(size, r, c));
      r += dr; c += dc;
    }
    // the run must be closed by one of our own discs, not by the board edge
    if (line.length && r >= 0 && r < size && c >= 0 && c < size && board[idx(size, r, c)] === who) {
      out.push(...line);
    }
  }
  return out;
}

export function legalCells(s: ReversiState, p: Slot): number[] {
  if (s.over || s.turn !== p) return [];
  const out: number[] = [];
  for (let i = 0; i < s.board.length; i++) if (flipsFor(s.board, s.size, i, p).length) out.push(i);
  return out;
}

/** Does `p` have any legal placement on this board? Used for passes. */
export function hasMoveFor(board: Cell[], size: number, p: Slot): boolean {
  for (let i = 0; i < board.length; i++) if (flipsFor(board, size, i, p).length) return true;
  return false;
}

export function countDiscs(board: Cell[]): [number, number] {
  let a = 0, b = 0;
  for (const v of board) { if (v === 0) a++; else if (v === 1) b++; }
  return [a, b];
}

function opening(size: number): Cell[] {
  const board: Cell[] = Array(size * size).fill(null);
  const m = size / 2;
  // the classic four in the middle, white to the north-west and south-east
  board[idx(size, m - 1, m - 1)] = 1;
  board[idx(size, m, m)] = 1;
  board[idx(size, m - 1, m)] = 0;
  board[idx(size, m, m - 1)] = 0;
  return board;
}

export const reversiRules: TurnGameRules<ReversiState, ReversiMove> = {
  id: 'reversi',
  createInitialState(config) {
    const size = Math.max(4, Math.min(12, Number(config.size ?? R_SIZE)));
    const even = size % 2 === 0 ? size : size - 1;
    const board = opening(even);
    return {
      size: even, board, turn: 0, last: null, passed: null,
      counts: countDiscs(board), over: false, winner: null, reason: '', history: [],
    };
  },

  currentPlayer: (s) => (s.over ? null : s.turn),

  legalMoves(s, p) {
    return legalCells(s, p).map((cell) => ({ cell }));
  },

  isLegal(s, p, m): m is ReversiMove {
    const mv = m as ReversiMove;
    if (!mv || typeof mv.cell !== 'number' || !Number.isInteger(mv.cell)) return false;
    if (s.over || s.turn !== p) return false;
    return flipsFor(s.board, s.size, mv.cell, p).length > 0;
  },

  applyMove(s, p, m) {
    if (!this.isLegal(s, p, m)) return s;
    const flipped = flipsFor(s.board, s.size, m.cell, p);
    const board = s.board.slice();
    board[m.cell] = p;
    for (const i of flipped) board[i] = p;

    const counts = countDiscs(board);
    const foe: Slot = p === 0 ? 1 : 0;
    const base: ReversiState = {
      ...s, board, counts, last: { cell: m.cell, flipped }, passed: null,
      history: [...s.history, m.cell],
    };

    const full = board.every((v) => v !== null);
    if (full) {
      return { ...base, over: true, winner: counts[0] === counts[1] ? null : counts[0] > counts[1] ? 0 : 1, reason: 'board full' };
    }
    if (hasMoveFor(board, s.size, foe)) return { ...base, turn: foe };
    if (hasMoveFor(board, s.size, p)) {
      // the opponent is stuck: they pass and we move again
      return { ...base, turn: p, passed: foe };
    }
    return { ...base, over: true, winner: counts[0] === counts[1] ? null : counts[0] > counts[1] ? 0 : 1, reason: 'no moves left' };
  },

  result: (s): Outcome => (s.over ? { over: true, winner: s.winner, reason: s.reason } : { over: false }),

  describeMove: (s, p, m) => {
    const [r, c] = rc(s.size, m.cell);
    const flips = flipsFor(s.board, s.size, m.cell, p).length;
    return `${p === 0 ? 'Volt' : 'Spark'} plays ${'abcdefgh'[c]}${r + 1}${flips ? ` · flips ${flips}` : ''}`;
  },
};
