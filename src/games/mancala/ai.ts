import type { Difficulty, Slot } from '../types';
import { mancalaRules, myPits, storeOf, type MancalaState, type MancalaMove } from './rules';

/**
 * Mancala opponent.
 *
 * The tree is tiny — six possible moves per turn — so this one really can search:
 * alpha-beta to a depth that grows with the difficulty, with the store difference
 * as the evaluation. Extra turns make the tree a little deeper than the ply count
 * suggests, which is exactly the point: the engine learns to farm them.
 */

function evaluate(s: MancalaState, me: Slot): number {
  const foe: Slot = me === 0 ? 1 : 0;
  const mine = s.board[storeOf(s, me)], theirs = s.board[storeOf(s, foe)];
  // seeds still in play count for whoever can reach them first
  let onMySide = 0, onTheirSide = 0;
  for (const i of myPits(s, me)) onMySide += s.board[i];
  for (const i of myPits(s, foe)) onTheirSide += s.board[i];
  return (mine - theirs) * 10 + (onMySide - onTheirSide) * 0.35;
}

function negamax(s: MancalaState, me: Slot, depth: number, alpha: number, beta: number): number {
  if (s.over) return evaluate(s, me);
  if (depth <= 0) return evaluate(s, me);
  const moves = mancalaRules.legalMoves(s, s.turn);
  if (!moves.length) return evaluate(s, me);
  const maximising = s.turn === me;
  let best = maximising ? -Infinity : Infinity;
  for (const m of moves) {
    const child = mancalaRules.applyMove(s, s.turn, m);
    const v = negamax(child, me, depth - 1, alpha, beta);
    if (maximising) { if (v > best) best = v; if (v > alpha) alpha = v; }
    else { if (v < best) best = v; if (v < beta) beta = v; }
    if (beta <= alpha) break;
  }
  return best;
}

const DEPTH: Record<Difficulty, number> = { beginner: 1, casual: 2, intermediate: 4, advanced: 6, expert: 8 };
const NOISE: Record<Difficulty, number> = { beginner: 0.5, casual: 0.2, intermediate: 0.04, advanced: 0, expert: 0 };

export function pickMancalaMove(s: MancalaState, me: Slot, diff: Difficulty = 'intermediate'): MancalaMove | null {
  const moves = mancalaRules.legalMoves(s, me);
  if (!moves.length) return null;

  const scored = moves.map((m) => {
    const child = mancalaRules.applyMove(s, me, m);
    const v = negamax(child, me, DEPTH[diff], -Infinity, Infinity);
    return { m, v };
  });

  if (NOISE[diff] > 0 && Math.random() < NOISE[diff]) {
    const pool = scored.slice().sort((a, b) => b.v - a.v).slice(0, Math.max(2, Math.ceil(scored.length / 2)));
    return pool[Math.floor(Math.random() * pool.length)].m;
  }
  scored.sort((a, b) => b.v - a.v);
  return scored[0].m;
}

export function explainMancala(s: MancalaState, me: Slot, mv: MancalaMove): string {
  const child = mancalaRules.applyMove(s, me, mv);
  if (child.lastCapture > 0) return `Captured ${child.lastCapture} seeds with that one.`;
  if (child.turn === me && !child.over) return 'Landing in my own store — I go again.';
  if (child.over) return 'That empties a row. Seeds are being swept.';
  return 'Sowing wide. Setting something up.';
}
