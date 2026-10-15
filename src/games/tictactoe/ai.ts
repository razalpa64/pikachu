import type { Slot } from '../types';
import { tictactoeRules as R, findWin, lines, type TTTState, type TTTMove } from './rules';
import type { Difficulty } from '../types';

/** Perfect, exact minimax on 3x3 (memoised); depth-limited alpha-beta + heuristic above that. */
const memo = new Map<string, number>();
const key = (s: TTTState) => s.cells.map((c) => (c === null ? '.' : c)).join('') + s.turn;

function terminal(s: TTTState): number | null {
  const w = findWin(s);
  if (w) return w.winner === 0 ? 1 : -1;
  if (s.cells.every((c) => c !== null)) return 0;
  return null;
}

/**
 * Exact minimax for 3x3, memoised on the position itself.
 *
 * Deliberately NO alpha-beta here. A cutoff makes `best` a *bound* rather than a
 * score, and storing bounds in a table that is reused under different windows
 * returns wrong values later — which is exactly how the "unbeatable" AI could be
 * beaten roughly one game in a hundred. The 3x3 tree is only a few hundred
 * thousand nodes and collapses to ~5,500 distinct positions once memoised, so
 * the exact search is both correct and instant.
 *
 * The key is board + side to move. That is sound because the returned value is a
 * pure function of the position: `empties` is derived from the board, so the
 * "win sooner, lose later" bonus cannot vary by search path.
 */
function minimax(s: TTTState): number {
  const w = findWin(s);
  if (w) {
    const empties = s.cells.reduce<number>((n, c) => n + (c === null ? 1 : 0), 0);
    return (w.winner === 0 ? 1 : -1) * (10 + empties);
  }
  if (s.cells.every((c) => c !== null)) return 0;

  const k = key(s);
  const hit = memo.get(k);
  if (hit !== undefined) return hit;

  const max = s.turn === 0;
  let best = max ? -Infinity : Infinity;
  for (const m of R.legalMoves(s, s.turn as Slot)) {
    const v = minimax(R.applyMove(s, s.turn as Slot, m));
    best = max ? Math.max(best, v) : Math.min(best, v);
  }
  memo.set(k, best);
  return best;
}

/** Heuristic for larger boards: weighted open-line counting. */
function evaluate(s: TTTState): number {
  let score = 0;
  for (const ln of lines(s.size, s.need)) {
    let a = 0, b = 0;
    for (const i of ln) { const v = s.cells[i]; if (v === 0) a++; else if (v === 1) b++; }
    if (a && b) continue;
    if (a) score += Math.pow(10, a - 1);
    if (b) score -= Math.pow(10, b - 1);
  }
  return score;
}

function search(s: TTTState, depth: number, alpha: number, beta: number): number {
  const t = terminal(s);
  if (t !== null) return t * 100000;
  if (depth === 0) return evaluate(s);
  const max = s.turn === 0;
  let best = max ? -Infinity : Infinity;
  const moves = R.legalMoves(s, s.turn as Slot);
  for (const m of moves) {
    const v = search(R.applyMove(s, s.turn as Slot, m), depth - 1, alpha, beta);
    if (max) { best = Math.max(best, v); alpha = Math.max(alpha, v); }
    else { best = Math.min(best, v); beta = Math.min(beta, v); }
    if (beta <= alpha) break;
  }
  return best;
}

const BLUNDER: Record<Difficulty, number> = {
  beginner: 0.72, casual: 0.38, intermediate: 0.14, advanced: 0.03, expert: 0,
};

export function pickTTTMove(s: TTTState, me: Slot, diff: Difficulty = 'expert'): TTTMove | null {
  const moves = R.legalMoves(s, me);
  if (!moves.length) return null;
  if (Math.random() < BLUNDER[diff]) {
    // "approachable" mistakes: still blocks an immediate loss half the time
    const urgent = moves.find((m) => {
      const probe = R.applyMove({ ...s, turn: (me === 0 ? 1 : 0) as Slot }, (me === 0 ? 1 : 0) as Slot, m);
      return !!findWin(probe);
    });
    if (urgent && Math.random() < 0.5) return urgent;
    return moves[Math.floor(Math.random() * moves.length)];
  }
  const perfect = s.size === 3;
  let best = moves[0];
  let bestV = me === 0 ? -Infinity : Infinity;
  const depth = s.size === 4 ? 5 : 4;
  for (const m of moves) {
    const child = R.applyMove(s, me, m);
    const v = perfect ? minimax(child) : search(child, depth, -Infinity, Infinity);
    if (me === 0 ? v > bestV : v < bestV) { bestV = v; best = m; }
  }
  return best;
}
