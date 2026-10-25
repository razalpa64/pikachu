import type { Difficulty, Slot } from '../types';
import { flipsFor, legalCells, reversiRules, type ReversiState } from './rules';

/**
 * Reversi opponent.
 *
 * Beating a beginner at Reversi is mostly three ideas, in this order: corners are
 * permanent, the squares diagonally next to a corner are a gift, and having fewer
 * options than the other player near the end is *good* because they have to move.
 * The evaluation here is a hand-tuned square table plus a mobility term, which is
 * enough to feel like someone who has played before — and the top levels search
 * two plies, so it will not hand you a corner in exchange for nothing.
 */

/* Corners +80 · X-squares (diagonal to a corner) −40 · C-squares (beside one) −22
   · edges are steady · the ring around the centre is nearly worthless. */
const BASE = [
  [80, -22, 12, 6, 6, 12, -22, 80],
  [-22, -40, 2, 2, 2, 2, -40, -22],
  [12, 2, 6, 3, 3, 6, 2, 12],
  [6, 2, 3, 1, 1, 3, 2, 6],
  [6, 2, 3, 1, 1, 3, 2, 6],
  [12, 2, 6, 3, 3, 6, 2, 12],
  [-22, -40, 2, 2, 2, 2, -40, -22],
  [80, -22, 12, 6, 6, 12, -22, 80],
];

function weight(size: number, i: number): number {
  if (size === 8) return BASE[Math.floor(i / 8)][i % 8];
  // other sizes: sample the base table, which keeps corners and X-squares sane
  const r = Math.min(7, Math.floor((Math.floor(i / size) / size) * 8));
  const c = Math.min(7, Math.floor(((i % size) / size) * 8));
  return BASE[r][c] * 0.8;
}

function mobility(s: ReversiState, p: Slot): number {
  let n = 0;
  for (let i = 0; i < s.board.length; i++) if (flipsFor(s.board, s.size, i, p).length) n++;
  return n;
}

function evaluate(s: ReversiState, me: Slot): number {
  const foe: Slot = me === 0 ? 1 : 0;
  let score = 0;
  for (let i = 0; i < s.board.length; i++) {
    const v = s.board[i];
    if (v === null) continue;
    score += (v === me ? 1 : -1) * weight(s.size, i);
  }
  score += (mobility(s, foe) - mobility(s, me)) * 1.6;
  const empty = s.board.filter((v) => v === null).length;
  if (empty <= 12) score += (s.counts[me] - s.counts[foe]) * 4;  // discs matter late
  return score;
}

const DEPTH: Record<Difficulty, number> = { beginner: 0, casual: 0, intermediate: 1, advanced: 1, expert: 2 };
const NOISE: Record<Difficulty, number> = { beginner: 0.55, casual: 0.22, intermediate: 0.06, advanced: 0.012, expert: 0 };

function search(s: ReversiState, me: Slot, depth: number, alpha: number, beta: number): number {
  if (depth === 0 || s.over) return evaluate(s, me);
  const cells = legalCells(s, s.turn);
  if (!cells.length) return evaluate(s, me);
  const maximising = s.turn === me;
  let best = maximising ? -Infinity : Infinity;
  for (const cell of cells) {
    const child = reversiRules.applyMove(s, s.turn, { cell });
    const v = search(child, me, depth - 1, alpha, beta);
    if (maximising) { if (v > best) best = v; if (v > alpha) alpha = v; }
    else { if (v < best) best = v; if (v < beta) beta = v; }
    if (beta <= alpha) break;
  }
  return best;
}

export function pickReversiMove(s: ReversiState, me: Slot, diff: Difficulty = 'intermediate'): { cell: number } | null {
  const cells = legalCells(s, me);
  if (!cells.length) return null;

  const scored = cells.map((cell) => {
    const child = reversiRules.applyMove(s, me, { cell });
    return { cell, v: DEPTH[diff] > 0 ? search(child, me, DEPTH[diff], -Infinity, Infinity) : evaluate(child, me) };
  });

  const noise = NOISE[diff];
  if (noise > 0 && Math.random() < noise) {
    const pool = scored.slice().sort((a, b) => b.v - a.v).slice(0, Math.max(2, Math.ceil(scored.length / 2)));
    return { cell: pool[Math.floor(Math.random() * pool.length)].cell };
  }
  const best = Math.max(...scored.map((x) => x.v));
  const top = scored.filter((x) => x.v >= best - 1e-9);
  return { cell: top[Math.floor(Math.random() * top.length)].cell };
}

export function explainReversi(s: ReversiState, me: Slot, mv: { cell: number }): string {
  const flips = flipsFor(s.board, s.size, mv.cell, me).length;
  const r = Math.floor(mv.cell / s.size) + 1, c = (mv.cell % s.size) + 1;
  const isCorner = (r === 1 || r === s.size) && (c === 1 || c === s.size);
  if (isCorner) return 'A corner. That disc can never be taken back.';
  if (flips >= 5) return `That one turns ${flips} discs at once. Hard to argue with.`;
  if (flips === 1) return 'Just one disc — but it keeps my options open.';
  return `Row ${r}, column ${c} — ${flips} disc${flips === 1 ? '' : 's'} flipped.`;
}
