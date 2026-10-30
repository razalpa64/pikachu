import { describe, expect, it } from 'vitest';
import {
  CELLS, CLUES, candidates, conflicts, countSolutions, dailySeed, generate, generateSolution,
  isSolved, remaining, solve, type Grid,
} from '../engine';

const LEVELS = ['beginner', 'casual', 'intermediate', 'advanced', 'expert'] as const;

const rowOf = (a: Grid, r: number) => a.slice(r * 9, r * 9 + 9);

describe('a generated board is a real sudoku', () => {
  it('solves its own solution: every row, column and box is 1–9', () => {
    const sol = generateSolution(1234);
    expect(sol).toHaveLength(CELLS);
    for (let r = 0; r < 9; r++) expect(rowOf(sol, r).slice().sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    for (let c = 0; c < 9; c++) {
      expect(Array.from({ length: 9 }, (_, r) => sol[r * 9 + c]).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    }
    expect(isSolved(sol)).toBe(true);
    expect(conflicts(sol).size).toBe(0);
  });

  it('is deterministic: the same seed is the same board', () => {
    expect(generateSolution(99)).toEqual(generateSolution(99));
    expect(generate(7, 'casual').puzzle).toEqual(generate(7, 'casual').puzzle);
  });

  it('different seeds give different boards', () => {
    expect(generateSolution(1)).not.toEqual(generateSolution(2));
  });
});

describe('every generated puzzle has exactly one answer', () => {
  it.each(LEVELS)('%s', (level) => {
    for (const seed of [1, 42, 12345, 987654]) {
      const { puzzle, solution, clues } = generate(seed, level);
      expect(isSolved(solution), 'the stored solution is legal').toBe(true);
      expect(puzzle.filter((v) => v !== 0).length, 'clue count matches the board').toBe(clues);
      // every given is consistent with the solution
      puzzle.forEach((v, i) => { if (v) expect(v, `cell ${i}`).toBe(solution[i]); });
      expect(countSolutions(puzzle, 3), `${level} seed ${seed} is ambiguous`).toBe(1);
      expect(solve(puzzle), 'the puzzle is solvable').toEqual(solution);
    }
  });

  it('gets harder as the level rises', () => {
    const counts = LEVELS.map((l) => generate(2026, l).clues);
    for (let i = 1; i < counts.length; i++) {
      expect(counts[i], `${LEVELS[i]} should have fewer clues than ${LEVELS[i - 1]}`).toBeLessThan(counts[i - 1]);
    }
    expect(counts[4]).toBeLessThanOrEqual(CLUES.expert + 2);
  });

  it('is fast enough to build on a phone', () => {
    const started = Date.now();
    generate(555, 'expert');
    expect(Date.now() - started).toBeLessThan(1500);
  });
});

describe('the rules helpers', () => {
  const solution = generateSolution(7);
  const puzzle = generate(7, 'casual').puzzle;

  it('finds no conflict in a legal board and both cells in a duplicate', () => {
    expect(conflicts(solution).size).toBe(0);
    const broken = solution.slice();
    broken[1] = broken[0]; // same row, same value
    const bad = conflicts(broken);
    expect(bad.has(0)).toBe(true);
    expect(bad.has(1)).toBe(true);
  });

  it('candidates are exactly the digits that do not break a rule', () => {
    const empty = new Array(CELLS).fill(0);
    expect(candidates(empty, 0)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const firstEmpty = puzzle.findIndex((v) => v === 0);
    const options = candidates(puzzle, firstEmpty);
    expect(options).toContain(solution[firstEmpty]);
    for (const v of options) {
      const trial = puzzle.slice();
      trial[firstEmpty] = v;
      expect(conflicts(trial).has(firstEmpty), `${v} should not conflict`).toBe(false);
    }
  });

  it('counts what is left of each digit', () => {
    const left = remaining(puzzle);
    const nines = puzzle.filter((v) => v === 9).length;
    expect(left[9]).toBe(9 - nines);
  });

  it('refuses a board that cannot be completed', () => {
    const impossible = new Array(CELLS).fill(0);
    impossible[0] = 5; impossible[1] = 5; // two fives in row one
    expect(countSolutions(impossible, 2)).toBe(0);
    expect(solve(impossible)).toBeNull();
  });

  it('does not treat a full-but-wrong board as solved', () => {
    const wrong = solution.slice();
    [wrong[0], wrong[1]] = [wrong[1], wrong[0]];
    if (wrong[0] !== solution[0]) {
      expect(isSolved(wrong)).toBe(false);
    }
  });
});

describe('daily seeds', () => {
  it('are stable per date and different across dates', () => {
    expect(dailySeed('2026-10-30')).toBe(dailySeed('2026-10-30'));
    expect(dailySeed('2026-10-30')).not.toBe(dailySeed('2026-10-31'));
    expect(Number.isInteger(dailySeed('2026-01-01'))).toBe(true);
  });
});
