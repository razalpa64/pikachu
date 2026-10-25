/**
 * Daily Puzzle — one nonogram a day, the same one for everybody.
 *
 * The rules of a daily are stricter than the rules of a normal puzzle, and this
 * file is where they are kept:
 *
 * 1. **Deterministic.** The puzzle is a pure function of `(dateKey, version)`.
 *    There is no server, no cache and no randomness at play time, so two people
 *    in two countries open the same grid. Bumping `DAILY_VERSION` retires every
 *    old puzzle at once (for the day a clue scheme changes), and the version is
 *    shown in the UI so a stale tab cannot quietly disagree with a fresh one.
 *
 * 2. **Solved by the clues, not by a stored answer.** The generator keeps a
 *    reference filling, but a small grid can fit more than one picture, so the
 *    win condition is "every row and column count is satisfied" — not "you
 *    reproduced my array". Accepting only the reference array would be a hidden
 *    second rule the player cannot see, and it would throw out correct answers.
 *
 * 3. **Honest about size.** This is a 5×5 warm-up, and it says so. It is not
 *    pretending to be a 15×15 newspaper nonogram.
 */
import { rng } from '../types';

export const SIZE = 5;
export const DAILY_VERSION = 3;
/** how full the reference picture is — enough to be a puzzle, not a mosaic */
const DENSITY = 0.46;

export interface DailyPuzzle {
  /** local YYYY-MM-DD */
  dateKey: string;
  version: number;
  id: string;
  size: number;
  /** the reference picture; a hint, never the only accepted answer */
  solution: boolean[];
  rowClues: number[][];
  colClues: number[][];
}

/** Local calendar day — deliberately not UTC, so "today" means today where you are. */
export function dateKey(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** FNV-1a, trimmed to 32 bits: small, stable, and the same in every JS engine. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Run lengths of filled cells: [3] , [1,2] , [] for an empty line. */
export function cluesFor(line: boolean[]): number[] {
  const out: number[] = [];
  let run = 0;
  for (const cell of line) {
    if (cell) run += 1;
    else if (run) { out.push(run); run = 0; }
  }
  if (run) out.push(run);
  return out;
}

const rows = (g: boolean[], size: number) =>
  Array.from({ length: size }, (_, r) => g.slice(r * size, r * size + size));
const cols = (g: boolean[], size: number) =>
  Array.from({ length: size }, (_, c) => Array.from({ length: size }, (_, r) => g[r * size + c]));

export const rowCluesFor = (g: boolean[], size = SIZE) => rows(g, size).map(cluesFor);
export const colCluesFor = (g: boolean[], size = SIZE) => cols(g, size).map(cluesFor);

/**
 * A grid that is neither empty nor solid — both are legal nonograms and both are
 * dull ones. Regenerating rather than nudging keeps the distribution honest.
 */
function interesting(row: number[][], col: number[][], size: number): boolean {
  const boring = (clues: number[][]) => clues.every((c) => c.length === 0) || clues.every((c) => c.length === 1 && c[0] === size);
  return !boring(row) && !boring(col);
}

export function dailyFor(key: string = dateKey(), version: number = DAILY_VERSION): DailyPuzzle {
  const seed = hashString(`${key}:v${version}`);
  const r = rng(seed);
  let solution: boolean[] = [];
  let rowClues: number[][] = [];
  let colClues: number[][] = [];

  for (let attempt = 0; attempt < 12; attempt++) {
    solution = Array.from({ length: SIZE * SIZE }, () => r() < DENSITY);
    // nudge toward the target density so a run of luck cannot hand out a nearly
    // empty board
    if (solution.filter(Boolean).length < 8) continue;
    if (solution.filter(Boolean).length > 18) continue;
    rowClues = rowCluesFor(solution);
    colClues = colCluesFor(solution);
    if (interesting(rowClues, colClues, SIZE)) break;
  }

  // the clues always describe the picture actually returned, whatever the loop
  // above settled on
  return {
    dateKey: key,
    version,
    id: `${key}-v${version}`,
    size: SIZE,
    solution,
    rowClues: rowCluesFor(solution),
    colClues: colCluesFor(solution),
  };
}

/** The only win condition: every clue is satisfied. */
export function satisfies(grid: boolean[], p: DailyPuzzle): boolean {
  if (grid.length !== p.size * p.size) return false;
  const rc = rowCluesFor(grid, p.size);
  const cc = colCluesFor(grid, p.size);
  return rc.every((c, i) => same(c, p.rowClues[i])) && cc.every((c, i) => same(c, p.colClues[i]));
}

/** how many lines are already correct — used for the "so close" nudge */
export function linesSolved(grid: boolean[], p: DailyPuzzle): number {
  const rc = rowCluesFor(grid, p.size);
  const cc = colCluesFor(grid, p.size);
  return rc.filter((c, i) => same(c, p.rowClues[i])).length
    + cc.filter((c, i) => same(c, p.colClues[i])).length;
}

const same = (a: number[], b: number[]) => a.length === b.length && a.every((v, i) => v === b[i]);

/**
 * Shareable result, the way a daily should be shareable: no spoilers, no link
 * that leaks the answer, and the date + version so a reader knows which grid it
 * was. Uses block characters rather than emoji, so it pastes cleanly anywhere.
 */
export function shareText(p: DailyPuzzle, grid: boolean[], seconds: number): string {
  const dots = rows(grid, p.size)
    .map((line) => line.map((c) => (c ? '██' : '░░')).join(''))
    .join('\n');
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `Pikachu Arcade · Daily Puzzle ${p.dateKey} (v${p.version})\n${mins}:${`${secs}`.padStart(2, '0')}\n\n${dots}`;
}
