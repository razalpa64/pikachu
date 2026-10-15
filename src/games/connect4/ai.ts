import type { Difficulty, Slot } from '../types';
import { connect4Rules as R, dropRow, at, type C4State, type C4Move } from './rules';

/** Minimax + alpha-beta, centre-weighted window heuristic, iterative deepening with a time budget. */
const WINDOW_SCORE = (mine: number, theirs: number, empty: number) => {
  if (mine && theirs) return 0;
  if (mine === 4) return 100000;
  if (theirs === 4) return -100000;
  if (mine === 3 && empty === 1) return 90;
  if (mine === 2 && empty === 2) return 12;
  if (theirs === 3 && empty === 1) return -110;   // defend slightly harder than attack
  if (theirs === 2 && empty === 2) return -14;
  return 0;
};

function evaluate(s: C4State, me: Slot): number {
  const opp = me === 0 ? 1 : 0;
  let score = 0;
  const centre = Math.floor(s.cols / 2);
  for (let r = 0; r < s.rows; r++)
    for (let c = 0; c < s.cols; c++)
      if (at(s, r, c) === me) score += 5 - Math.abs(c - centre);

  const dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];
  for (let r = 0; r < s.rows; r++)
    for (let c = 0; c < s.cols; c++)
      for (const [dr, dc] of dirs) {
        const er = r + dr * 3, ec = c + dc * 3;
        if (er < 0 || er >= s.rows || ec < 0 || ec >= s.cols) continue;
        let mine = 0, theirs = 0, empty = 0;
        for (let k = 0; k < 4; k++) {
          const v = at(s, r + dr * k, c + dc * k);
          if (v === me) mine++; else if (v === opp) theirs++; else empty++;
        }
        score += WINDOW_SCORE(mine, theirs, empty);
      }
  return score;
}

function order(s: C4State): number[] {
  const centre = (s.cols - 1) / 2;
  return Array.from({ length: s.cols }, (_, c) => c)
    .filter((c) => dropRow(s, c) >= 0)
    .sort((a, b) => Math.abs(a - centre) - Math.abs(b - centre));
}

function negamax(s: C4State, me: Slot, depth: number, alpha: number, beta: number, deadline: number): number {
  const res = R.result(s);
  if (res.over) {
    if (res.winner === null) return 0;
    return res.winner === me ? 1_000_000 - s.history.length : -1_000_000 + s.history.length;
  }
  if (depth === 0 || Date.now() > deadline) return evaluate(s, me);
  const maximising = s.turn === me;
  let best = maximising ? -Infinity : Infinity;
  for (const col of order(s)) {
    const child = R.applyMove(s, s.turn, { col });
    const v = negamax(child, me, depth - 1, alpha, beta, deadline);
    if (maximising) { if (v > best) best = v; if (v > alpha) alpha = v; }
    else { if (v < best) best = v; if (v < beta) beta = v; }
    if (beta <= alpha) break;
  }
  return best;
}

const DEPTH: Record<Difficulty, number> = { beginner: 1, casual: 3, intermediate: 5, advanced: 7, expert: 9 };
const NOISE: Record<Difficulty, number> = { beginner: 0.55, casual: 0.22, intermediate: 0.06, advanced: 0.01, expert: 0 };

export function pickC4Move(s: C4State, me: Slot, diff: Difficulty = 'intermediate', budgetMs = 650): C4Move | null {
  const cols = order(s);
  if (!cols.length) return null;
  if (Math.random() < NOISE[diff]) return { col: cols[Math.floor(Math.random() * cols.length)] };

  const deadline = Date.now() + budgetMs;
  let best = cols[0];
  for (let d = 1; d <= DEPTH[diff]; d++) {
    let localBest = cols[0], localScore = -Infinity;
    for (const col of cols) {
      const child = R.applyMove(s, me, { col });
      const v = negamax(child, me, d - 1, -Infinity, Infinity, deadline);
      if (v > localScore) { localScore = v; localBest = col; }
    }
    best = localBest;
    if (Date.now() > deadline) break;
    if (localScore > 900_000) break;
  }
  return { col: best };
}

export function explainC4(s: C4State, me: Slot, move: C4Move): string {
  const opp = me === 0 ? 1 : 0;
  const mine = R.applyMove(s, me, move);
  const mineOut = R.result(mine);
  if (mineOut.over && mineOut.winner === me) return 'Completes four in a row — match point.';
  const threat = order(s).find((c) => { const probe = R.applyMove({ ...s, turn: opp }, opp, { col: c }); const r = R.result(probe); return r.over && r.winner === opp; });
  if (threat === move.col) return 'Blocks the opponent\u2019s immediate four.';
  const centre = Math.floor(s.cols / 2);
  if (move.col === centre) return 'Takes the centre column — it touches the most winning lines.';
  return 'Builds a double threat while keeping the centre contested.';
}
