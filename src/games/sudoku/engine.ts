/**
 * Sudoku, as arithmetic rather than as a grid of buttons.
 *
 * Everything here is pure and seeded, because three different things depend on
 * getting the same grid from the same number: the daily puzzle (everyone must
 * get the same board, and the same board again after a reload), the difficulty
 * ladder, and the tests. `rng` is the mulberry32 already used by the referees.
 *
 * The generator works the way a person would: fill a legal grid, then take
 * numbers back out one at a time, refusing any removal that would leave the
 * puzzle with more than one answer. That last check is the whole point — a
 * puzzle with two solutions is not a puzzle, it is a guess, and the player has
 * no way to know which branch the game wanted.
 */
import { rng } from '../types';

export const SIZE = 9;
export const CELLS = SIZE * SIZE;
export type Grid = number[];

export type Level = 'beginner' | 'casual' | 'intermediate' | 'advanced' | 'expert';

/** clues kept on the board, per level — fewer clues, harder puzzle */
export const CLUES: Record<Level, number> = {
  beginner: 42, casual: 36, intermediate: 31, advanced: 27, expert: 24,
};

export const LEVEL_LABEL: Record<Level, string> = {
  beginner: 'Beginner', casual: 'Casual', intermediate: 'Inter', advanced: 'Advanced', expert: 'Expert',
};

const ALL = 0b111111111;

const rowOf = (i: number) => (i / SIZE) | 0;
const colOf = (i: number) => i % SIZE;
const boxOf = (i: number) => ((rowOf(i) / 3) | 0) * 3 + ((colOf(i) / 3) | 0);

/** Bitmask of the digits already used in each row, column and box. */
interface Masks { rows: number[]; cols: number[]; boxes: number[] }

function masksFor(grid: Grid): Masks {
  const rows = new Array(SIZE).fill(0);
  const cols = new Array(SIZE).fill(0);
  const boxes = new Array(SIZE).fill(0);
  for (let i = 0; i < CELLS; i++) {
    const v = grid[i];
    if (!v) continue;
    const bit = 1 << (v - 1);
    rows[rowOf(i)] |= bit; cols[colOf(i)] |= bit; boxes[boxOf(i)] |= bit;
  }
  return { rows, cols, boxes };
}

const allowed = (m: Masks, i: number) => ALL & ~(m.rows[rowOf(i)] | m.cols[colOf(i)] | m.boxes[boxOf(i)]);

const bitCount = (n: number) => { let c = 0; while (n) { n &= n - 1; c++; } return c; };

function placementMask(m: Masks, i: number, v: number) {
  return { bit: 1 << (v - 1), r: rowOf(i), c: colOf(i), b: boxOf(i) };
}

/** Fill an empty grid, choosing candidates in seed order. Always succeeds. */
export function generateSolution(seed: number): Grid {
  const random = rng(seed >>> 0);
  const grid = new Array(CELLS).fill(0);
  const m: Masks = { rows: new Array(SIZE).fill(0), cols: new Array(SIZE).fill(0), boxes: new Array(SIZE).fill(0) };
  /* A plain recursive backfill can wander for a while on 9×9 because it picks a
     fixed cell order. Picking the *most constrained* empty cell at every step
     (MRV) fills a grid in a few hundred operations instead of a few hundred
     thousand, which is what makes generating a puzzle on a phone acceptable. */
  const solveFrom = (): boolean => {
    let best = -1, bestMask = 0, bestCount = 10;
    for (let i = 0; i < CELLS; i++) {
      if (grid[i]) continue;
      const mask = allowed(m, i);
      if (!mask) return false;
      const count = bitCount(mask);
      if (count < bestCount) { best = i; bestMask = mask; bestCount = count; if (count === 1) break; }
    }
    if (best === -1) return true;
    const choices: number[] = [];
    for (let v = 1; v <= 9; v++) if (bestMask & (1 << (v - 1))) choices.push(v);
    for (let k = choices.length - 1; k > 0; k--) {
      const j = Math.floor(random() * (k + 1));
      [choices[k], choices[j]] = [choices[j], choices[k]];
    }
    for (const v of choices) {
      const { bit, r, c, b } = placementMask(m, best, v);
      grid[best] = v; m.rows[r] |= bit; m.cols[c] |= bit; m.boxes[b] |= bit;
      if (solveFrom()) return true;
      grid[best] = 0; m.rows[r] &= ~bit; m.cols[c] &= ~bit; m.boxes[b] &= ~bit;
    }
    return false;
  };
  solveFrom();
  return grid;
}

/**
 * How many ways the grid can be completed, counted up to `limit`.
 *
 * Counting rather than solving is what lets the carver prove a removal is safe:
 * "can it be solved" is true for almost any removal, "can it be solved once" is
 * not.
 */
export function countSolutions(grid: Grid, limit = 2): number {
  const work = grid.slice();
  /* A board that already breaks a rule has no legal completion, and saying so
     up front is not an optimisation — it is the difference between "impossible"
     and a search that thrashes for minutes looking for one. */
  if (conflicts(work).size > 0) return 0;
  const m = masksFor(work);
  let found = 0;
  /* A hard ceiling on the search. Exhausting it is reported as `limit`
     solutions, which is the conservative answer for every caller: the carver
     keeps the clue rather than gambling on uniqueness, and the UI never freezes
     because somebody typed a number into a bad position. */
  let budget = 400_000;
  const walk = (): void => {
    if (found >= limit || budget <= 0) return;
    budget -= 1;
    let best = -1, bestMask = 0, bestCount = 10;
    for (let i = 0; i < CELLS; i++) {
      if (work[i]) continue;
      const mask = allowed(m, i);
      if (!mask) return;
      const count = bitCount(mask);
      if (count < bestCount) { best = i; bestMask = mask; bestCount = count; if (count === 1) break; }
    }
    if (best === -1) { found++; return; }
    const { r, c, b } = placementMask(m, best, 1);
    for (let v = 1; v <= 9 && found < limit; v++) {
      const bit = 1 << (v - 1);
      if (!(bestMask & bit)) continue;
      work[best] = v; m.rows[r] |= bit; m.cols[c] |= bit; m.boxes[b] |= bit;
      walk();
      work[best] = 0; m.rows[r] &= ~bit; m.cols[c] &= ~bit; m.boxes[b] &= ~bit;
    }
  };
  walk();
  return budget <= 0 ? limit : found;
}

/** The first completion of a grid, or null if it has none. */
export function solve(grid: Grid): Grid | null {
  if (grid.some((v) => v !== 0 && (v < 1 || v > 9 || !Number.isInteger(v)))) return null;
  if (conflicts(grid).size > 0) return null;
  const work = grid.slice();
  const m = masksFor(work);
  let budget = 400_000;
  const walk = (): boolean => {
    if (budget <= 0) return false;
    budget -= 1;
    let best = -1, bestMask = 0, bestCount = 10;
    for (let i = 0; i < CELLS; i++) {
      if (work[i]) continue;
      const mask = allowed(m, i);
      if (!mask) return false;
      const count = bitCount(mask);
      if (count < bestCount) { best = i; bestMask = mask; bestCount = count; if (count === 1) break; }
    }
    if (best === -1) return true;
    const { r, c, b } = placementMask(m, best, 1);
    for (let v = 1; v <= 9; v++) {
      const bit = 1 << (v - 1);
      if (!(bestMask & bit)) continue;
      work[best] = v; m.rows[r] |= bit; m.cols[c] |= bit; m.boxes[b] |= bit;
      if (walk()) return true;
      work[best] = 0; m.rows[r] &= ~bit; m.cols[c] &= ~bit; m.boxes[b] &= ~bit;
    }
    return false;
  };
  return walk() ? work : null;
}

/**
 * A puzzle with exactly one answer.
 *
 * Symmetric digging (a cell and its mirror go together) is what makes a sudoku
 * *look* like a sudoku rather than a random scatter of givens, so removals are
 * attempted in mirrored pairs. A pair that would break uniqueness is skipped
 * rather than the whole attempt abandoned, and the loop stops either when the
 * clue target is met or when the time budget runs out — a slightly easier
 * puzzle is a much better outcome than a frozen tab.
 */
export function generate(seed: number, level: Level = 'casual', budgetMs = 700): { puzzle: Grid; solution: Grid; clues: number } {
  const solution = generateSolution(seed);
  const puzzle = solution.slice();
  const target = CLUES[level] ?? CLUES.casual;
  const random = rng((seed ^ 0x5bf03635) >>> 0);
  const order = Array.from({ length: CELLS }, (_, i) => i);
  for (let k = order.length - 1; k > 0; k--) {
    const j = Math.floor(random() * (k + 1));
    [order[k], order[j]] = [order[j], order[k]];
  }
  const started = Date.now();
  let clues = CELLS;
  /* Pass one: mirrored pairs, which is what gives the board its shape. */
  for (const i of order) {
    if (clues <= target) break;
    if (Date.now() - started > budgetMs) break;
    if (!puzzle[i]) continue;
    const mirror = CELLS - 1 - i;
    const pair = mirror !== i && puzzle[mirror] ? [i, mirror] : [i];
    const saved = pair.map((p) => puzzle[p]);
    for (const p of pair) puzzle[p] = 0;
    if (countSolutions(puzzle, 2) !== 1) {
      pair.forEach((p, k) => { puzzle[p] = saved[k]; });
      continue;
    }
    clues -= pair.length;
  }
  /* Pass two: singles. Symmetry sometimes leaves the board one or two clues
     short of the level it was asked for — a fallback pass reaches the target
     without ever breaking uniqueness, at the cost of a lopsided board, which is
     the right trade for the last few numbers. */
  if (clues > target) {
    for (const i of order) {
      if (clues <= target) break;
      if (Date.now() - started > budgetMs * 2) break;
      if (!puzzle[i]) continue;
      const saved = puzzle[i];
      puzzle[i] = 0;
      if (countSolutions(puzzle, 2) !== 1) { puzzle[i] = saved; continue; }
      clues -= 1;
    }
  }
  return { puzzle, solution, clues };
}

/** Cells that break the rules right now — duplicates in a row, column or box. */
export function conflicts(grid: Grid): Set<number> {
  const bad = new Set<number>();
  const groups: number[][] = [];
  for (let r = 0; r < SIZE; r++) groups.push(Array.from({ length: SIZE }, (_, c) => r * SIZE + c));
  for (let c = 0; c < SIZE; c++) groups.push(Array.from({ length: SIZE }, (_, r) => r * SIZE + c));
  for (let b = 0; b < SIZE; b++) {
    const top = ((b / 3) | 0) * 27, left = (b % 3) * 3;
    const cells: number[] = [];
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) cells.push(top + r * SIZE + left + c);
    groups.push(cells);
  }
  for (const group of groups) {
    const seen = new Map<number, number[]>();
    for (const i of group) {
      const v = grid[i];
      if (!v) continue;
      const list = seen.get(v) ?? [];
      list.push(i);
      seen.set(v, list);
    }
    for (const list of seen.values()) if (list.length > 1) for (const i of list) bad.add(i);
  }
  return bad;
}

/** What may still legally go in a cell, given everything else on the board. */
export function candidates(grid: Grid, index: number): number[] {
  if (index < 0 || index >= CELLS) return [];
  const m = masksFor(grid);
  const mask = allowed(m, index);
  const out: number[] = [];
  for (let v = 1; v <= 9; v++) if (mask & (1 << (v - 1))) out.push(v);
  return out;
}

export const isFull = (grid: Grid) => grid.every((v) => v >= 1 && v <= 9);

/** A finished, legal board. */
export const isSolved = (grid: Grid) => isFull(grid) && conflicts(grid).size === 0;

/** How many of each digit are still missing — the number-pad counters. */
export function remaining(grid: Grid): Record<number, number> {
  const counts: Record<number, number> = {};
  for (let v = 1; v <= 9; v++) counts[v] = 9;
  for (const v of grid) if (v >= 1 && v <= 9) counts[v] -= 1;
  return counts;
}

/** `2026-10-30` → a stable 32-bit seed. Different day, different grid; a reload
 *  on the same day produces the identical board. */
export function dailySeed(dateKey: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < dateKey.length; i++) {
    h ^= dateKey.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h ^ 0x9e3779b9) >>> 0;
}

/** Human label for a cell, used by the accessible grid. */
export function cellLabel(grid: Grid, given: boolean[], notes: number[][], index: number): string {
  const row = rowOf(index) + 1, col = colOf(index) + 1;
  const v = grid[index];
  const what = v ? `${v}` : notes[index]?.length ? `pencilled ${notes[index].join(' ')}` : 'empty';
  return `row ${row} column ${col}, ${what}${given[index] ? ', given' : ''}`;
}
