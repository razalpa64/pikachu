import type { Slot, TurnGameRules, Outcome } from '../types';

export const C4_COLS = 7;
export const C4_ROWS = 6;

export interface C4State {
  cols: number; rows: number;
  /** column-major stacks; index 0 = bottom */
  board: (Slot | null)[];      // length cols*rows, index = r*cols + c  (r=0 bottom)
  turn: Slot;
  lastDrop: { col: number; row: number } | null;
  winLine: number[] | null;
  winner: Slot | null;
  over: boolean;
  reason: string;
  history: number[];
}
export type C4Move = { col: number };

export const at = (s: C4State, r: number, c: number) => s.board[r * s.cols + c];

export function dropRow(s: C4State, col: number): number {
  for (let r = 0; r < s.rows; r++) if (s.board[r * s.cols + col] === null) return r;
  return -1;
}

export function winFrom(s: C4State, r: number, c: number): number[] | null {
  const who = at(s, r, c);
  if (who === null) return null;
  const dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];
  for (const [dr, dc] of dirs) {
    const line = [r * s.cols + c];
    for (const sign of [1, -1]) {
      let rr = r + dr * sign, cc = c + dc * sign;
      while (rr >= 0 && rr < s.rows && cc >= 0 && cc < s.cols && at(s, rr, cc) === who) {
        line.push(rr * s.cols + cc); rr += dr * sign; cc += dc * sign;
      }
    }
    if (line.length >= 4) return line.sort((a, b) => a - b);
  }
  return null;
}

export const connect4Rules: TurnGameRules<C4State, C4Move> = {
  id: 'connect4',
  createInitialState(config) {
    const cols = Number(config.cols ?? C4_COLS);
    const rows = Number(config.rows ?? C4_ROWS);
    return { cols, rows, board: Array(cols * rows).fill(null), turn: 0, lastDrop: null, winLine: null, winner: null, over: false, reason: '', history: [] };
  },
  currentPlayer: (s) => (s.over ? null : s.turn),
  legalMoves(s, p) {
    if (s.over || s.turn !== p) return [];
    const out: C4Move[] = [];
    for (let c = 0; c < s.cols; c++) if (dropRow(s, c) >= 0) out.push({ col: c });
    return out;
  },
  isLegal(s, p, m): m is C4Move {
    const mv = m as C4Move;
    if (!mv || typeof mv.col !== 'number' || !Number.isInteger(mv.col)) return false;
    if (s.over || s.turn !== p) return false;
    return mv.col >= 0 && mv.col < s.cols && dropRow(s, mv.col) >= 0;
  },
  applyMove(s, p, m) {
    if (!this.isLegal(s, p, m)) return s;
    const row = dropRow(s, m.col);
    const board = s.board.slice();
    board[row * s.cols + m.col] = p;
    const next: C4State = { ...s, board, turn: p === 0 ? 1 : 0, lastDrop: { col: m.col, row }, history: [...s.history, m.col] };
    const line = winFrom(next, row, m.col);
    if (line) return { ...next, over: true, winner: p, winLine: line, reason: 'four in a row' };
    if (board.every((v) => v !== null)) return { ...next, over: true, winner: null, reason: 'board full' };
    return next;
  },
  result: (s): Outcome => (s.over ? { over: true, winner: s.winner, reason: s.reason } : { over: false }),
  describeMove: (_s, p, m) => `${p === 0 ? 'Volt' : 'Spark'} drops col ${m.col + 1}`,
};

/** Undo is only legal in local/solo modes — the server never exposes it online. */
export function undoC4(s: C4State, plies: number): C4State {
  const hist = s.history.slice(0, Math.max(0, s.history.length - plies));
  let st = connect4Rules.createInitialState({ cols: s.cols, rows: s.rows }, 0);
  for (const col of hist) st = connect4Rules.applyMove(st, st.turn, { col });
  return st;
}
