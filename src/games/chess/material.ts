/**
 * What has come off the board, and who is ahead because of it.
 *
 * Both players have to be able to answer "what have I lost?" without replaying
 * the game in their head — that is the whole point of the captured-pieces tray in
 * every serious chess client. The numbers are derived from the FEN rather than
 * from a move log, so they are correct after a reconnection, a page reload or a
 * promotion, and they cannot drift from the position the server referees.
 *
 * A promotion makes a side own a piece it never started with (a second queen),
 * so "missing" is clamped at zero: a queen that was promoted is not a capture.
 */

export type PieceType = 'p' | 'n' | 'b' | 'r' | 'q';
export type Colour = 'w' | 'b';

/** Centipawn-free, the classic 1/3/3/5/9 used by every chess UI for material. */
export const PIECE_VALUE: Record<PieceType, number> = { p: 1, n: 3, b: 3, r: 5, q: 9 };

/** how many of each piece a side starts with */
const START: Record<PieceType, number> = { p: 8, n: 2, b: 2, r: 2, q: 1 };

/** biggest first, so the tray reads like a score sheet */
const ORDER: PieceType[] = ['q', 'r', 'b', 'n', 'p'];

export interface SideMaterial {
  /** pieces of this colour that are no longer on the board, biggest first */
  lost: PieceType[];
  /** what this side has taken from the opponent, biggest first */
  captured: PieceType[];
  /** board value of what this side has taken */
  taken: number;
  /** board value of what this side has given up */
  given: number;
  /** taken − given: positive means this side is ahead on material */
  balance: number;
}

export interface Material {
  w: SideMaterial;
  b: SideMaterial;
  /** how far ahead the leading side is, in pawns — 0 when level */
  edge: { side: Colour | null; points: number };
}

const EMPTY = (): Record<PieceType, number> => ({ p: 0, n: 0, b: 0, r: 0, q: 0 });

/** Count what is still on the board, per colour and type. */
export function countPieces(fen: string): { w: Record<PieceType, number>; b: Record<PieceType, number> } {
  const board = fen.split(' ')[0] ?? '';
  const w = EMPTY();
  const b = EMPTY();
  for (const ch of board) {
    const lower = ch.toLowerCase();
    if (lower === 'p' || lower === 'n' || lower === 'b' || lower === 'r' || lower === 'q') {
      (ch === lower ? b : w)[lower as PieceType] += 1;
    }
  }
  return { w, b };
}

function missing(have: Record<PieceType, number>): PieceType[] {
  const out: PieceType[] = [];
  for (const t of ORDER) for (let i = 0; i < Math.max(0, START[t] - have[t]); i++) out.push(t);
  return out;
}

const value = (pieces: PieceType[]) => pieces.reduce((n, t) => n + PIECE_VALUE[t], 0);

/** The whole tray, in one pass over the FEN. */
export function materialFromFen(fen: string): Material {
  const have = countPieces(fen);
  const lostW = missing(have.w);
  const lostB = missing(have.b);
  const w: SideMaterial = {
    lost: lostW,
    captured: lostB,
    taken: value(lostB),
    given: value(lostW),
    balance: value(lostB) - value(lostW),
  };
  const b: SideMaterial = {
    lost: lostB,
    captured: lostW,
    taken: value(lostW),
    given: value(lostB),
    balance: value(lostW) - value(lostB),
  };
  const points = Math.abs(w.balance);
  return { w, b, edge: { side: w.balance === 0 ? null : w.balance > 0 ? 'w' : 'b', points } };
}

/** `+3` / `−1` / `=` — the caption under a tray. */
export function balanceLabel(balance: number): string {
  if (balance === 0) return 'level';
  return `${balance > 0 ? '+' : '−'}${Math.abs(balance)}`;
}
