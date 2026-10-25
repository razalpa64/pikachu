import type { Difficulty, Slot } from '../types';
import { GOMOKU_RUN, gomokuRules, type GomokuState, type Stone } from './rules';

/**
 * Gomoku opponent.
 *
 * A full minimax is hopeless on a 15×15 board (225 legal moves per ply), and it is
 * also unnecessary: nearly every decisive moment in Gomoku is a *shape* — an open
 * three, a four, a broken four — and shapes can be scored directly. Each candidate
 * is scored twice, once as my attack and once as the opponent's, and the two are
 * blended. The higher levels additionally look one move ahead, which is exactly
 * enough to refuse a move that lets the other side win next turn.
 */

const DIRS: ReadonlyArray<readonly [number, number]> = [[0, 1], [1, 0], [1, 1], [1, -1]];

/** How good is it for `who` to own `cell`? Higher is better; 5-in-a-row is huge. */
function shapeScore(board: Stone[], size: number, cell: number, who: Slot): number {
  const r0 = Math.floor(cell / size), c0 = cell % size;
  let total = 0;
  for (const [dr, dc] of DIRS) {
    let run = 1;
    let openEnds = 0;
    let gapBonus = 0;
    for (const sign of [1, -1]) {
      let r = r0 + dr * sign, c = c0 + dc * sign;
      let steps = 0;
      while (r >= 0 && r < size && c >= 0 && c < size && steps < GOMOKU_RUN) {
        const v = board[r * size + c];
        if (v === who) { run++; steps++; r += dr * sign; c += dc * sign; continue; }
        // a single empty then one more of ours is a "broken" shape, still a threat
        if (v === null && steps > 0) {
          const rr = r + dr * sign, cc = c + dc * sign;
          if (rr >= 0 && rr < size && cc >= 0 && cc < size && board[rr * size + cc] === who) {
            gapBonus += 0.6;
          }
        }
        if (v === null) openEnds++;
        break;
      }
    }
    const strength = run + gapBonus;
    if (strength >= 5) { total += 5_000_000; continue; }
    if (strength >= 4) { total += openEnds >= 2 ? 260_000 : openEnds === 1 ? 42_000 : 0; continue; }
    if (strength >= 3) { total += openEnds >= 2 ? 12_000 : openEnds === 1 ? 1_400 : 0; continue; }
    if (strength >= 2) { total += openEnds >= 2 ? 480 : openEnds === 1 ? 90 : 0; continue; }
    total += openEnds >= 2 ? 22 : 6;
  }
  return total;
}

/** Only cells within two of an existing stone can be worth considering. */
function candidates(s: GomokuState): number[] {
  const { board, size } = s;
  if (board.every((v) => v === null)) {
    const mid = Math.floor(size / 2);
    return [mid * size + mid];
  }
  const seen = new Set<number>();
  for (let i = 0; i < board.length; i++) {
    if (board[i] === null) continue;
    const r0 = Math.floor(i / size), c0 = i % size;
    for (let dr = -2; dr <= 2; dr++)
      for (let dc = -2; dc <= 2; dc++) {
        const r = r0 + dr, c = c0 + dc;
        if (r < 0 || r >= size || c < 0 || c >= size) continue;
        const j = r * size + c;
        if (board[j] === null) seen.add(j);
      }
  }
  return [...seen];
}

const DEFENCE: Record<Difficulty, number> = { beginner: 0.45, casual: 0.7, intermediate: 0.95, advanced: 1.05, expert: 1.1 };
const NOISE: Record<Difficulty, number> = { beginner: 0.6, casual: 0.28, intermediate: 0.05, advanced: 0, expert: 0 };

export function pickGomokuMove(s: GomokuState, me: Slot, diff: Difficulty = 'intermediate'): { cell: number } | null {
  const foe: Slot = me === 0 ? 1 : 0;
  const cells = candidates(s);
  if (!cells.length) {
    const empty = s.board.indexOf(null);
    return empty >= 0 ? { cell: empty } : null;
  }

  const scored = cells.map((cell) => {
    const attack = shapeScore(s.board, s.size, cell, me);
    const defence = shapeScore(s.board, s.size, cell, foe);
    return { cell, v: attack + defence * DEFENCE[diff], attack, defence };
  });

  // a winning move is never a compromise
  const win = scored.find((x) => x.attack >= 5_000_000);
  if (win) return { cell: win.cell };
  // block a five in the making (or a four we could not otherwise answer)
  const block = scored.find((x) => x.defence >= 5_000_000);
  if (block) return { cell: block.cell };

  if (NOISE[diff] > 0 && Math.random() < NOISE[diff]) {
    const pool = scored.slice().sort((a, b) => b.v - a.v).slice(0, Math.max(3, Math.ceil(scored.length / 6)));
    return { cell: pool[Math.floor(Math.random() * pool.length)].cell };
  }

  scored.sort((a, b) => b.v - a.v);
  if (diff === 'advanced' || diff === 'expert') {
    // one-ply look-ahead: refuse a move that hands the opponent a winning reply
    for (const cand of scored.slice(0, 8)) {
      const board = s.board.slice();
      board[cand.cell] = me;
      const child: GomokuState = { ...s, board, turn: foe };
      const reply = candidates(child).some((c) => shapeScore(board, s.size, c, foe) >= 5_000_000);
      if (!reply) return { cell: cand.cell };
    }
  }
  return { cell: scored[0].cell };
}

export function explainGomoku(s: GomokuState, me: Slot, mv: { cell: number }): string {
  const foe: Slot = me === 0 ? 1 : 0;
  const attack = shapeScore(s.board, s.size, mv.cell, me);
  const defence = shapeScore(s.board, s.size, mv.cell, foe);
  const row = Math.floor(mv.cell / s.size) + 1;
  if (attack >= 5_000_000) return 'Five. That is the whole game.';
  if (attack >= 42_000) return 'Four in a row — you have to answer this one.';
  if (defence >= 260_000) return 'You were one move from an open four. I had to close it.';
  if (defence >= 42_000) return 'I am closing your line before it becomes five.';
  if (attack >= 12_000) return 'An open three. Watch this row.';
  return `Row ${row} — building quietly.`;
}

export const _internals = { shapeScore, candidates };
