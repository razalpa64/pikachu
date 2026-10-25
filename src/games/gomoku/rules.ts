import type { Outcome, Slot, TurnGameRules } from '../types';

/**
 * Gomoku — five in a row on an open board.
 *
 * Freestyle rules: **five or more** in a line wins, in any direction. No opening
 * restrictions, no forbidden moves — those belong to tournament Renju and would be
 * a rules page before the first stone. A full board with no line is a draw, which
 * on 15×15 essentially never happens but is modelled properly anyway.
 */

export const GOMOKU_SIZE = 15;
export const GOMOKU_RUN = 5;

export type Stone = Slot | null;

export interface GomokuState {
  size: number;
  board: Stone[];
  turn: Slot;
  last: number | null;
  winLine: number[] | null;
  over: boolean;
  winner: Slot | null;
  reason: string;
  history: number[];
}

export type GomokuMove = { cell: number };

export const gIdx = (size: number, r: number, c: number) => r * size + c;

const DIRS: ReadonlyArray<readonly [number, number]> = [[0, 1], [1, 0], [1, 1], [1, -1]];

/** The winning run through `cell`, if the stone just played there completed one. */
export function gomokuWinFrom(board: Stone[], size: number, cell: number): number[] | null {
  const who = board[cell];
  if (who === null || who === undefined) return null;
  const r0 = Math.floor(cell / size), c0 = cell % size;
  for (const [dr, dc] of DIRS) {
    const line = [cell];
    for (const sign of [1, -1]) {
      let r = r0 + dr * sign, c = c0 + dc * sign;
      while (r >= 0 && r < size && c >= 0 && c < size && board[r * size + c] === who) {
        line.push(r * size + c); r += dr * sign; c += dc * sign;
      }
    }
    if (line.length >= GOMOKU_RUN) return line.sort((a, b) => a - b);
  }
  return null;
}

export const gomokuRules: TurnGameRules<GomokuState, GomokuMove> = {
  id: 'gomoku',
  createInitialState(config) {
    const wanted = Number(config.size ?? GOMOKU_SIZE);
    const size = [9, 11, 13, 15, 19].includes(wanted) ? wanted : GOMOKU_SIZE;
    return {
      size, board: Array(size * size).fill(null), turn: 0, last: null,
      winLine: null, over: false, winner: null, reason: '', history: [],
    };
  },

  currentPlayer: (s) => (s.over ? null : s.turn),

  legalMoves(s, p) {
    if (s.over || s.turn !== p) return [];
    const out: GomokuMove[] = [];
    for (let i = 0; i < s.board.length; i++) if (s.board[i] === null) out.push({ cell: i });
    return out;
  },

  isLegal(s, p, m): m is GomokuMove {
    const mv = m as GomokuMove;
    if (!mv || typeof mv.cell !== 'number' || !Number.isInteger(mv.cell)) return false;
    if (s.over || s.turn !== p) return false;
    return mv.cell >= 0 && mv.cell < s.board.length && s.board[mv.cell] === null;
  },

  applyMove(s, p, m) {
    if (!this.isLegal(s, p, m)) return s;
    const board = s.board.slice();
    board[m.cell] = p;
    const next: GomokuState = { ...s, board, turn: p === 0 ? 1 : 0, last: m.cell, history: [...s.history, m.cell] };
    const line = gomokuWinFrom(board, s.size, m.cell);
    if (line) return { ...next, over: true, winner: p, winLine: line, reason: `${line.length} in a row` };
    if (board.every((v) => v !== null)) return { ...next, over: true, winner: null, reason: 'board full' };
    return next;
  },

  result: (s): Outcome => (s.over ? { over: true, winner: s.winner, reason: s.reason } : { over: false }),

  describeMove: (s, p, m) => {
    const c = m.cell % s.size;
    return `${p === 0 ? 'Volt' : 'Spark'} plays ${'abcdefghijklmnopqrs'[c]}${Math.floor(m.cell / s.size) + 1}`;
  },
};
