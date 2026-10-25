import { Chess } from 'chess.js';
import type { Slot, TurnGameRules, Outcome } from '../types';

/** Slot 0 = white, slot 1 = black. State is the FEN plus bookkeeping — cheap to sync. */
export interface ChessState {
  fen: string;
  pgnMoves: string[];          // SAN history
  lastMove: { from: string; to: string } | null;
  over: boolean;
  winner: Slot | null;
  reason: string;
  /** milliseconds remaining, null = untimed */
  clock: [number, number] | null;
  clockStartedAt: number | null;
  increment: number;
  drawOfferBy: Slot | null;
}
export type ChessMove = { from: string; to: string; promotion?: 'q' | 'r' | 'b' | 'n' };

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

export function load(fen: string): Chess {
  const c = new Chess();
  c.load(fen);
  return c;
}

function finish(c: Chess, s: ChessState): ChessState {
  if (c.isCheckmate()) return { ...s, over: true, winner: c.turn() === 'w' ? 1 : 0, reason: 'checkmate' };
  if (c.isStalemate()) return { ...s, over: true, winner: null, reason: 'stalemate' };
  if (c.isInsufficientMaterial()) return { ...s, over: true, winner: null, reason: 'insufficient material' };
  if (c.isThreefoldRepetition()) return { ...s, over: true, winner: null, reason: 'threefold repetition' };
  if (c.isDraw()) return { ...s, over: true, winner: null, reason: 'fifty-move rule' };
  return s;
}

const TIME_CONTROLS: Record<string, [number, number]> = {
  bullet: [60_000, 0], blitz: [180_000, 2_000], rapid: [600_000, 5_000], classical: [1_800_000, 10_000], none: [0, 0],
};

export const chessRules: TurnGameRules<ChessState, ChessMove> = {
  id: 'chess',
  createInitialState(config) {
    const tcKey = String(config.timeControl ?? 'rapid');
    const tc = TIME_CONTROLS[tcKey] ?? TIME_CONTROLS.rapid;
    const timed = tcKey !== 'none';
    return {
      fen: START_FEN, pgnMoves: [], lastMove: null, over: false, winner: null, reason: '',
      clock: timed ? [tc[0], tc[0]] : null, clockStartedAt: null, increment: tc[1], drawOfferBy: null,
    };
  },
  currentPlayer: (s) => (s.over ? null : (s.fen.split(' ')[1] === 'w' ? 0 : 1)),
  legalMoves(s, p) {
    if (s.over) return [];
    // The enumeration belongs to whoever was asked about. Handing the side to
    // move's list to the other seat is how "why is the board lighting up my
    // opponent's moves" bugs start.
    if (p !== this.currentPlayer(s)) return [];
    return load(s.fen).moves({ verbose: true }).map((m) => ({ from: m.from, to: m.to, promotion: m.promotion as ChessMove['promotion'] }));
  },
  isLegal(s, p, m): m is ChessMove {
    const mv = m as ChessMove;
    if (!mv || typeof mv.from !== 'string' || typeof mv.to !== 'string') return false;
    if (s.over) return false;
    if ((s.fen.split(' ')[1] === 'w' ? 0 : 1) !== p) return false;
    const c = load(s.fen);
    return c.moves({ verbose: true }).some(
      (lm) => lm.from === mv.from && lm.to === mv.to && (!lm.promotion || lm.promotion === (mv.promotion ?? 'q')),
    );
  },
  applyMove(s, p, m) {
    // chess.js throws (or returns null) on anything it cannot parse, so an
    // unchecked call would take the room down instead of ignoring the move.
    if (!this.isLegal(s, p, m)) return s;
    const c = load(s.fen);
    const res = c.move({ from: m.from, to: m.to, promotion: m.promotion ?? 'q' });
    let clock = s.clock;
    const now = Date.now();
    if (clock && s.clockStartedAt) {
      const spent = now - s.clockStartedAt;
      clock = [...clock] as [number, number];
      clock[p] = Math.max(0, clock[p] - spent + s.increment);
    }
    const next: ChessState = {
      ...s, fen: c.fen(), pgnMoves: [...s.pgnMoves, res.san],
      lastMove: { from: res.from, to: res.to }, clockStartedAt: clock ? now : null, clock, drawOfferBy: null,
    };
    return finish(c, next);
  },
  result: (s): Outcome => (s.over ? { over: true, winner: s.winner, reason: s.reason } : { over: false }),
  tick(s, nowMs) {
    if (s.over || !s.clock || !s.clockStartedAt) return s;
    const mover = s.fen.split(' ')[1] === 'w' ? 0 : 1;
    const left = s.clock[mover] - (nowMs - s.clockStartedAt);
    if (left <= 0) {
      const clock = [...s.clock] as [number, number];
      clock[mover] = 0;
      return { ...s, clock, over: true, winner: (mover === 0 ? 1 : 0) as Slot, reason: 'flag fall' };
    }
    return s;
  },
  describeMove: (_s, p, m) => `${p === 0 ? 'White' : 'Black'} ${m.from}–${m.to}`,
};

export function startClock(s: ChessState): ChessState {
  return s.clock && !s.clockStartedAt ? { ...s, clockStartedAt: Date.now() } : s;
}
export function resign(s: ChessState, by: Slot): ChessState {
  return { ...s, over: true, winner: (by === 0 ? 1 : 0) as Slot, reason: 'resignation' };
}
export function agreeDraw(s: ChessState): ChessState {
  return { ...s, over: true, winner: null, reason: 'draw agreed' };
}
export function undoChess(s: ChessState, plies: number): ChessState {
  const c = new Chess();
  const keep = s.pgnMoves.slice(0, Math.max(0, s.pgnMoves.length - plies));
  for (const san of keep) c.move(san);
  const hist = c.history({ verbose: true });
  const last = hist[hist.length - 1];
  return { ...s, fen: c.fen(), pgnMoves: keep, lastMove: last ? { from: last.from, to: last.to } : null, over: false, winner: null, reason: '', drawOfferBy: null };
}
