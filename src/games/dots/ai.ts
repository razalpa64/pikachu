import type { Difficulty, Slot } from '../types';
import { boxesFor, dotsRules, isDrawn, sidesOf, type DotsEdge, type DotsState } from './rules';

/**
 * Dots & Boxes opponent.
 *
 * Two things win this game: taking every box that is already available (chains can
 * run for a dozen boxes), and never opening a new chain unless you have to. So the
 * evaluation is a short simulation — play the edge, keep taking whatever it opens,
 * then ask what the opponent can take in reply — plus a tiebreak that prefers not
 * to leave three-sided boxes lying around.
 */

/** Take `start`, then greedily keep taking boxes that the cascade opens. */
function cascade(s: DotsState, p: Slot, start: DotsEdge): { gained: number; after: DotsState } {
  let cur = s;
  let gained = 0;
  let edge: DotsEdge | null = start;
  let guard = 0;
  while (edge && guard++ < 400) {
    const next = dotsRules.applyMove({ ...cur, turn: p }, p, edge);
    const took = next.lastGain;
    gained += took;
    cur = next;
    edge = null;
    // a chain only continues while each move keeps claiming a box
    if (took > 0 && !next.over) {
      for (const e of dotsRules.legalMoves({ ...cur, turn: p }, p)) {
        if (boxesFor(cur, e).length > 0) { edge = e; break; }
      }
    }
  }
  return { gained, after: cur };
}

/** Best number of boxes `p` could take from this position in one unbroken chain. */
function bestChain(s: DotsState, p: Slot): number {
  let best = 0;
  for (const e of allEdgesOf(s)) {
    if (isDrawn(s, e)) continue;
    if (boxesFor(s, e).length === 0) continue;   // no free box, no chain
    const { gained } = cascade(s, p, e);
    if (gained > best) best = gained;
  }
  return best;
}

function allEdgesOf(s: DotsState): DotsEdge[] {
  const out: DotsEdge[] = [];
  for (let i = 0; i < s.h.length; i++) out.push({ o: 'h', i });
  for (let i = 0; i < s.v.length; i++) out.push({ o: 'v', i });
  return out;
}

function threesSided(s: DotsState): number {
  let n = 0;
  for (let b = 0; b < s.boxes.length; b++) if (s.boxes[b] === null && sidesOf(s, b) === 3) n++;
  return n;
}

const NOISE: Record<Difficulty, number> = { beginner: 0.75, casual: 0.35, intermediate: 0.06, advanced: 0, expert: 0 };

export function pickDotsMove(s: DotsState, me: Slot, diff: Difficulty = 'intermediate'): DotsEdge | null {
  const legal = dotsRules.legalMoves(s, me);
  if (!legal.length) return null;
  if (diff === 'beginner' && Math.random() < 0.4) return legal[Math.floor(Math.random() * legal.length)];

  const foe: Slot = me === 0 ? 1 : 0;
  const scored = legal.map((e) => {
    const { gained, after } = cascade(s, me, e);
    const reply = bestChain(after, foe);
    const gift = threesSided(after) * 0.35;
    return { e, v: gained * 100 - reply * 100 - gift };
  });

  scored.sort((a, b) => b.v - a.v);
  if (NOISE[diff] > 0 && Math.random() < NOISE[diff]) {
    const pool = scored.slice(0, Math.max(3, Math.ceil(scored.length / 4)));
    return pool[Math.floor(Math.random() * pool.length)].e;
  }
  return scored[0].e;
}

export function explainDots(s: DotsState, me: Slot, mv: DotsEdge): string {
  const free = boxesFor(s, mv).length;
  if (free > 0) return 'That closes a box — and I get to go again.';
  const after = dotsRules.applyMove(s, me, mv);
  const danger = threesSided(after);
  if (danger > 0) return 'I have to open something. Sorry about this.';
  return 'Nothing available yet. Just drawing quiet lines.';
}
