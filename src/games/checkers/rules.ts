import type { Slot, TurnGameRules, Outcome } from '../types';

/** English draughts on 8x8 dark squares. Slot 0 = gold (moves "up"), slot 1 = charcoal. */
export type Piece = { p: Slot; king: boolean } | null;
export interface CKState {
  board: Piece[];            // 64, only dark squares used
  turn: Slot;
  mustContinueFrom: number | null;  // multi-jump lock
  mandatoryCapture: boolean;
  lastMove: number[] | null;
  over: boolean; winner: Slot | null; reason: string;
  noCaptureCount: number;
  history: { from: number; to: number }[];
}
export type CKMove = { from: number; to: number };

export const isDark = (i: number) => ((Math.floor(i / 8) + (i % 8)) % 2) === 1;
const rc = (i: number) => [Math.floor(i / 8), i % 8] as const;
const ix = (r: number, c: number) => r * 8 + c;
const inside = (r: number, c: number) => r >= 0 && r < 8 && c >= 0 && c < 8;

function dirsFor(pc: NonNullable<Piece>): number[][] {
  if (pc.king) return [[-1, -1], [-1, 1], [1, -1], [1, 1]];
  return pc.p === 0 ? [[-1, -1], [-1, 1]] : [[1, -1], [1, 1]];
}

export function capturesFrom(s: CKState, from: number): CKMove[] {
  const pc = s.board[from];
  if (!pc) return [];
  const [r, c] = rc(from);
  const out: CKMove[] = [];
  for (const [dr, dc] of dirsFor(pc)) {
    const mr = r + dr, mc = c + dc, lr = r + dr * 2, lc = c + dc * 2;
    if (!inside(lr, lc)) continue;
    const mid = s.board[ix(mr, mc)];
    if (mid && mid.p !== pc.p && s.board[ix(lr, lc)] === null) out.push({ from, to: ix(lr, lc) });
  }
  return out;
}

function simpleFrom(s: CKState, from: number): CKMove[] {
  const pc = s.board[from];
  if (!pc) return [];
  const [r, c] = rc(from);
  const out: CKMove[] = [];
  for (const [dr, dc] of dirsFor(pc)) {
    const nr = r + dr, nc = c + dc;
    if (inside(nr, nc) && s.board[ix(nr, nc)] === null) out.push({ from, to: ix(nr, nc) });
  }
  return out;
}

export const checkersRules: TurnGameRules<CKState, CKMove> = {
  id: 'checkers',
  createInitialState(config) {
    const board: Piece[] = Array(64).fill(null);
    for (let i = 0; i < 64; i++) {
      if (!isDark(i)) continue;
      const r = Math.floor(i / 8);
      if (r < 3) board[i] = { p: 1, king: false };
      else if (r > 4) board[i] = { p: 0, king: false };
    }
    return {
      board, turn: 0, mustContinueFrom: null,
      mandatoryCapture: config.mandatoryCapture !== false,
      lastMove: null, over: false, winner: null, reason: '', noCaptureCount: 0, history: [],
    };
  },
  currentPlayer: (s) => (s.over ? null : s.turn),
  legalMoves(s, p) {
    if (s.over || s.turn !== p) return [];
    if (s.mustContinueFrom !== null) return capturesFrom(s, s.mustContinueFrom);
    const mine: number[] = [];
    for (let i = 0; i < 64; i++) if (s.board[i]?.p === p) mine.push(i);
    const caps = mine.flatMap((i) => capturesFrom(s, i));
    if (caps.length && s.mandatoryCapture) return caps;
    return [...caps, ...mine.flatMap((i) => simpleFrom(s, i))];
  },
  isLegal(s, p, m): m is CKMove {
    const mv = m as CKMove;
    if (!mv || !Number.isInteger(mv.from) || !Number.isInteger(mv.to)) return false;
    return this.legalMoves(s, p).some((l) => l.from === mv.from && l.to === mv.to);
  },
  applyMove(s, p, m) {
    if (!this.isLegal(s, p, m)) return s;
    const board = s.board.slice();
    const pc = board[m.from]!;
    board[m.from] = null;
    const jumped = Math.abs(m.to - m.from) > 9;
    if (jumped) {
      const [fr, fc] = rc(m.from), [tr, tc] = rc(m.to);
      board[ix((fr + tr) / 2, (fc + tc) / 2)] = null;
    }
    const [tr] = rc(m.to);
    const king = pc.king || (pc.p === 0 && tr === 0) || (pc.p === 1 && tr === 7);
    const crowned = king && !pc.king;
    board[m.to] = { p: pc.p, king };

    let next: CKState = {
      ...s, board, lastMove: [m.from, m.to], history: [...s.history, m],
      noCaptureCount: jumped ? 0 : s.noCaptureCount + 1, mustContinueFrom: null,
    };
    // multi-jump: same piece keeps the turn, unless it just got crowned (English rule)
    if (jumped && !crowned && capturesFrom(next, m.to).length) {
      next = { ...next, mustContinueFrom: m.to };
      return next;
    }
    next = { ...next, turn: (p === 0 ? 1 : 0) as Slot };

    const oppHasPieces = next.board.some((b) => b?.p === next.turn);
    const oppHasMoves = checkersRules.legalMoves(next, next.turn).length > 0;
    if (!oppHasPieces || !oppHasMoves) return { ...next, over: true, winner: p, reason: oppHasPieces ? 'opponent has no legal moves' : 'all pieces captured' };
    /* The counter is in plies, so 80 plies is forty moves for each side — the
       number the reason quotes, and the number the rules panel promises. */
    if (next.noCaptureCount >= 80) return { ...next, over: true, winner: null, reason: '40 moves each without a capture' };
    return next;
  },
  result: (s): Outcome => (s.over ? { over: true, winner: s.winner, reason: s.reason } : { over: false }),
  describeMove: (_s, p, m) => `${p === 0 ? 'Gold' : 'Charcoal'} ${m.from}→${m.to}`,
};

export function resignCheckers(s: CKState, by: Slot): CKState {
  return { ...s, over: true, winner: (by === 0 ? 1 : 0) as Slot, reason: 'resignation' };
}
