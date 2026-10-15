import type { Difficulty } from '../types';
import { FLEET, type BSState } from './rules';

/** Hunt/target with a parity screen + density map. Never reads the opponent's ship list. */
export interface BSBrain { queue: number[]; hitsOpen: number[] }
export const newBSBrain = (): BSBrain => ({ queue: [], hitsOpen: [] });

const neighbours = (cell: number, size: number) => {
  const r = Math.floor(cell / size), c = cell % size;
  const out: number[] = [];
  if (r > 0) out.push(cell - size);
  if (r < size - 1) out.push(cell + size);
  if (c > 0) out.push(cell - 1);
  if (c < size - 1) out.push(cell + 1);
  return out;
};

/** Probability density: for each remaining ship, count every legal placement through each cell. */
function density(size: number, tried: Set<number>, known: Set<number>, remaining: number[]): number[] {
  const map = new Array(size * size).fill(0);
  for (const len of remaining) {
    for (let r = 0; r < size; r++)
      for (let c = 0; c < size; c++)
        for (const horiz of [true, false]) {
          const cells: number[] = [];
          let ok = true, overlapKnownHit = 0;
          for (let k = 0; k < len; k++) {
            const rr = horiz ? r : r + k, cc = horiz ? c + k : c;
            if (rr >= size || cc >= size) { ok = false; break; }
            const idx = rr * size + cc;
            if (tried.has(idx) && !known.has(idx)) { ok = false; break; }
            if (known.has(idx)) overlapKnownHit++;
            cells.push(idx);
          }
          if (!ok) continue;
          const weight = 1 + overlapKnownHit * 12;
          for (const idx of cells) if (!tried.has(idx)) map[idx] += weight;
        }
  }
  return map;
}

const RANDOMNESS: Record<Difficulty, number> = { beginner: 0.9, casual: 0.5, intermediate: 0.18, advanced: 0.04, expert: 0 };

export function pickBSShot(s: BSState, me: 0 | 1, brain: BSBrain, diff: Difficulty): number {
  const size = s.size;
  const tried = new Set(s.shots[me]);
  const myHits = new Set(s.hits[me]);
  const sunkIds = new Set(s.sunk[me]);
  const remaining = FLEET.filter((f) => !sunkIds.has(f.id)).map((f) => f.len);

  const free = (cell: number) => cell >= 0 && cell < size * size && !tried.has(cell);

  if (Math.random() < RANDOMNESS[diff]) {
    const pool: number[] = [];
    for (let i = 0; i < size * size; i++) if (free(i)) pool.push(i);
    // even easy mode still finishes a wounded ship sometimes
    const adj = [...myHits].flatMap((h) => neighbours(h, size)).filter(free);
    if (adj.length && Math.random() < 0.35) return adj[Math.floor(Math.random() * adj.length)];
    return pool[Math.floor(Math.random() * pool.length)];
  }

  // TARGET: finish wounded ships first, preferring the established axis
  const openHits = [...myHits].filter((h) => neighbours(h, size).some(free));
  if (openHits.length) {
    const axisCandidates: number[] = [];
    for (const h of openHits) {
      for (const d of [1, -1, size, -size]) {
        if (myHits.has(h + d) && free(h - d)) axisCandidates.push(h - d);
        if (myHits.has(h - d) && free(h + d)) axisCandidates.push(h + d);
      }
    }
    const valid = axisCandidates.filter((cell) => {
      const a = cell % size;
      return a >= 0 && a < size && free(cell);
    });
    if (valid.length) return valid[0];
    const adj = openHits.flatMap((h) => neighbours(h, size)).filter(free);
    if (adj.length) {
      const map = density(size, tried, myHits, remaining);
      return adj.sort((a, b) => map[b] - map[a])[0];
    }
  }

  // HUNT: density map, restricted to a parity screen matching the smallest live ship
  const map = density(size, tried, myHits, remaining);
  const minLen = Math.min(...remaining, 2);
  let best = -1, bestV = -1;
  for (let i = 0; i < size * size; i++) {
    if (!free(i)) continue;
    const r = Math.floor(i / size), c = i % size;
    const parityOk = (r + c) % minLen === 0;
    const v = map[i] * (parityOk ? 1.35 : 1);
    if (v > bestV) { bestV = v; best = i; }
  }
  if (best >= 0) return best;
  for (let i = 0; i < size * size; i++) if (free(i)) return i;
  return 0;
}
