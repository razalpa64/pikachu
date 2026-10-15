import type { Difficulty, Slot } from '../types';
import { checkersRules as R, type CKState, type CKMove } from './rules';

const ROW_BONUS = [0, 1, 2, 3, 4, 5, 6, 7];

function evaluate(s: CKState, me: Slot): number {
  let score = 0;
  for (let i = 0; i < 64; i++) {
    const pc = s.board[i];
    if (!pc) continue;
    const r = Math.floor(i / 8), c = i % 8;
    let v = pc.king ? 18 : 10;
    if (!pc.king) v += (pc.p === 0 ? ROW_BONUS[7 - r] : ROW_BONUS[r]) * 0.4;  // advancement
    if (c === 0 || c === 7) v += 1.2;                                          // edge safety
    if (r === 0 || r === 7) v += 0.8;
    score += pc.p === me ? v : -v;
  }
  return score;
}

function negamax(s: CKState, me: Slot, depth: number, alpha: number, beta: number, deadline: number): number {
  const res = R.result(s);
  if (res.over) return res.winner === null ? 0 : res.winner === me ? 100000 - depth : -100000 + depth;
  if (depth === 0 || Date.now() > deadline) return evaluate(s, me);
  const moves = R.legalMoves(s, s.turn);
  if (!moves.length) return s.turn === me ? -100000 : 100000;
  const maximising = s.turn === me;
  let best = maximising ? -Infinity : Infinity;
  for (const m of moves) {
    const v = negamax(R.applyMove(s, s.turn, m), me, depth - 1, alpha, beta, deadline);
    if (maximising) { if (v > best) best = v; if (v > alpha) alpha = v; }
    else { if (v < best) best = v; if (v < beta) beta = v; }
    if (beta <= alpha) break;
  }
  return best;
}

const DEPTH: Record<Difficulty, number> = { beginner: 1, casual: 3, intermediate: 5, advanced: 7, expert: 9 };
const NOISE: Record<Difficulty, number> = { beginner: 0.6, casual: 0.25, intermediate: 0.07, advanced: 0.01, expert: 0 };

export function pickCheckersMove(s: CKState, me: Slot, diff: Difficulty = 'intermediate', budgetMs = 700): CKMove | null {
  const moves = R.legalMoves(s, me);
  if (!moves.length) return null;
  if (moves.length === 1) return moves[0];
  if (Math.random() < NOISE[diff]) return moves[Math.floor(Math.random() * moves.length)];
  const deadline = Date.now() + budgetMs;
  let best = moves[0], bestV = -Infinity;
  for (let d = 1; d <= DEPTH[diff]; d++) {
    let lb = moves[0], lv = -Infinity;
    for (const m of moves) {
      const v = negamax(R.applyMove(s, me, m), me, d - 1, -Infinity, Infinity, deadline);
      if (v > lv) { lv = v; lb = m; }
    }
    best = lb; bestV = lv;
    if (Date.now() > deadline || bestV > 90000) break;
  }
  return best;
}
