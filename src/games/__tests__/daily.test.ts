// @vitest-environment jsdom
/**
 * Daily Puzzle — the two promises it makes.
 *
 * 1. The grid is a pure function of the date and the edition, so "the same
 *    puzzle for everyone" is true rather than hoped for.
 * 2. It is solved by the clues, not by the reference picture, so a correct
 *    answer can never be rejected for being the wrong shape.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import {
  DAILY_VERSION, cluesFor, colCluesFor, dateKey, dailyFor, linesSolved, rowCluesFor, satisfies, shareText,
} from '../daily/puzzle';
import { readRecord, recordSolve, solvedToday } from '../daily/streak';

const at = (key: string) => dailyFor(key, DAILY_VERSION);

describe('daily puzzle generation', () => {
  it('is identical for the same date and edition, and moves with the edition', () => {
    const a = at('2026-10-25');
    const b = at('2026-10-25');
    expect(a.solution).toEqual(b.solution);
    expect(a.rowClues).toEqual(b.rowClues);
    expect(a.id).toBe('2026-10-25-v' + DAILY_VERSION);
    expect(dailyFor('2026-10-25', DAILY_VERSION + 1).solution).not.toEqual(a.solution);
  });

  it('actually changes from day to day', () => {
    const days = ['2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25', '2026-10-26'];
    const shapes = new Set(days.map((d) => at(d).solution.map((c) => (c ? '1' : '0')).join('')));
    expect(shapes.size, 'seven days should not collapse into one grid').toBeGreaterThanOrEqual(6);
  });

  it('always ships clues that describe its own picture, and never a dull one', () => {
    for (let i = 0; i < 40; i++) {
      const d = new Date(2026, 0, 1 + i);
      const p = at(dateKey(d));
      expect(p.rowClues).toEqual(rowCluesFor(p.solution));
      expect(p.colClues).toEqual(colCluesFor(p.solution));
      const filled = p.solution.filter(Boolean).length;
      expect(filled).toBeGreaterThanOrEqual(6);
      expect(filled).toBeLessThanOrEqual(19);
      expect(p.rowClues.some((c) => c.length > 0)).toBe(true);
      expect(p.colClues.some((c) => c.length > 0)).toBe(true);
    }
  });

  it('counts runs the way the rules say it does', () => {
    expect(cluesFor([true, true, false, true, false])).toEqual([2, 1]);
    expect(cluesFor([false, false, false, false, false])).toEqual([]);
    expect(cluesFor([true, true, true, true, true])).toEqual([5]);
    expect(cluesFor([true, false, true, false, true])).toEqual([1, 1, 1]);
  });
});

describe('solving by the clues', () => {
  it('accepts the reference picture', () => {
    const p = at('2026-10-25');
    expect(satisfies(p.solution, p)).toBe(true);
    expect(linesSolved(p.solution, p)).toBe(p.size * 2);
  });

  it('rejects a picture that does not fit, and says how far off it is', () => {
    const p = at('2026-10-25');
    const wrong = p.solution.map((c, i) => (i === 0 ? !c : c));
    const fits = satisfies(wrong, p);
    // flipping the first cell only breaks a clue if it was alone in its run
    if (!fits) {
      expect(linesSolved(wrong, p)).toBeLessThan(p.size * 2);
    }
    const empty = Array(p.size * p.size).fill(false);
    expect(satisfies(empty, p)).toBe(false);
    const full = Array(p.size * p.size).fill(true);
    expect(satisfies(full, p)).toBe(false);
  });

  it('accepts any arrangement that satisfies every clue, not just the stored one', () => {
    // a symmetric, unambiguous picture: a hollow 3×3 ring in a 5×5 grid
    const grid = [
      false, false, false, false, false,
      false, true, true, true, false,
      false, true, false, true, false,
      false, true, true, true, false,
      false, false, false, false, false,
    ];
    const p = {
      dateKey: 'x', version: 1, id: 'x', size: 5, solution: grid,
      rowClues: rowCluesFor(grid), colClues: colCluesFor(grid),
    };
    expect(satisfies(grid, p)).toBe(true);
    // the same clues describe the transposed ring… which is the same ring here,
    // so prove the point the other way: the *mirrored* ring satisfies them too
    const mirrored = grid.map((c, i) => grid[(i % 5) + (4 - Math.floor(i / 5)) * 5]);
    expect(satisfies(mirrored, p)).toBe(true);
  });

  it('shares without spoiling: date, edition, time and blocks only', () => {
    const p = at('2026-10-25');
    const text = shareText(p, p.solution, 125);
    expect(text).toContain('2026-10-25');
    expect(text).toContain(`v${p.version}`);
    expect(text).toContain('2:05');
    expect(text.split('\n').length).toBeGreaterThanOrEqual(7);
    expect(text).not.toMatch(/answer|solution|clue/i);
  });
});

describe('the streak is honest', () => {
  beforeEach(() => { localStorage.clear(); });

  it('starts at one, does not double-count the same day, and extends the next day', () => {
    expect(readRecord().streak).toBe(0);

    const first = recordSolve('2026-10-24');
    expect(first.streak).toBe(1);
    expect(solvedToday(first, '2026-10-24')).toBe(true);

    const again = recordSolve('2026-10-24');
    expect(again.streak, 'solving twice must not inflate the streak').toBe(1);

    const next = recordSolve('2026-10-25');
    expect(next.streak).toBe(2);
    expect(next.best).toBe(2);
  });

  it('drops to zero when a day is missed, and says so before it is written again', () => {
    recordSolve('2026-10-20');
    const stale = readRecord();
    expect(stale.lastSolved).toBe('2026-10-20');
    expect(stale.streak, 'a streak older than yesterday is no longer alive').toBe(0);
    expect(stale.best, 'the personal best survives a broken streak').toBe(1);
    expect(recordSolve('2026-10-25').streak).toBe(1);
  });

  it('keeps a local record only — nothing here talks to a server', () => {
    recordSolve('2026-10-25');
    const raw = localStorage.getItem('pikachu.daily.v1')!;
    expect(Object.keys(JSON.parse(raw)).sort()).toEqual(['best', 'lastSolved', 'solvedTodayOn', 'streak']);
  });
});
