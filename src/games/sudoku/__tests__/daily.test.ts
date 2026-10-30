import { describe, expect, it } from 'vitest';
import {
  DAILY_LEVEL, EMPTY_STATE, TASKS, addDays, allDone, dailyPuzzle, dateKey, qualifies,
  readDaily, shareText, streakAsOf, tasksFor, withResult, writeDaily, type DailyState,
} from '../daily';

/* vitest runs in `node`, so give the storage tests a real in-memory Storage. */
const mem = new Map<string, string>();
const fakeStorage: Storage = {
  get length() { return mem.size; },
  clear: () => mem.clear(),
  getItem: (k) => (mem.has(k) ? mem.get(k)! : null),
  key: (i) => Array.from(mem.keys())[i] ?? null,
  removeItem: (k) => { mem.delete(k); },
  setItem: (k, v) => { mem.set(k, String(v)); },
};
Object.defineProperty(globalThis, 'localStorage', { value: fakeStorage, configurable: true, writable: true });

const day = (solved: boolean, clean = solved, swift = solved): { solved: boolean; clean: boolean; swift: boolean; seconds: number } =>
  ({ solved, clean, swift, seconds: solved ? 300 : 0 });

describe('today’s grid', () => {
  it('is the same board for the same date, and a different one tomorrow', () => {
    const a = dailyPuzzle('2026-10-30');
    const b = dailyPuzzle('2026-10-30');
    expect(a.puzzle).toEqual(b.puzzle);
    expect(dailyPuzzle('2026-10-31').puzzle).not.toEqual(a.puzzle);
  });

  it('is always the same level and has a single answer', () => {
    const p = dailyPuzzle('2026-10-30');
    expect(p.level).toBe(DAILY_LEVEL);
    expect(p.puzzle.filter((v) => v !== 0).length).toBe(p.clues);
    expect(p.solution.every((v) => v >= 1 && v <= 9)).toBe(true);
  });

  it('changes at local midnight, not UTC midnight', () => {
    expect(dateKey(new Date(2026, 9, 30, 0, 0, 1))).toBe('2026-10-30');
    expect(dateKey(new Date(2026, 9, 30, 23, 59, 59))).toBe('2026-10-30');
    expect(dateKey(new Date(2026, 9, 31, 0, 0, 0))).toBe('2026-10-31');
  });
});

describe('dates', () => {
  it('walks across month and year boundaries', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
});

describe('the three daily tasks', () => {
  it('start undone and turn on independently', () => {
    const today = '2026-10-30';
    expect(tasksFor(EMPTY_STATE, today).map((t) => t.done)).toEqual([false, false, false]);
    const solvedOnly = withResult(EMPTY_STATE, today, day(true, false, false));
    expect(tasksFor(solvedOnly, today).map((t) => t.done)).toEqual([true, false, false]);
    expect(allDone(solvedOnly, today)).toBe(false);
    const all = withResult(EMPTY_STATE, today, day(true, true, true));
    expect(tasksFor(all, today).map((t) => t.done)).toEqual([true, true, true]);
    expect(allDone(all, today)).toBe(true);
    expect(TASKS).toHaveLength(3);
  });

  it('never makes a day worse on a replay', () => {
    const today = '2026-10-30';
    const good = withResult(EMPTY_STATE, today, day(true, true, true));
    const messy = withResult(good, today, day(true, false, false));
    expect(tasksFor(messy, today).every((t) => t.done)).toBe(true);
    expect(messy.days[today].seconds).toBe(300);
  });
});

describe('the streak', () => {
  const base = (days: Record<string, ReturnType<typeof day>>): DailyState => ({ ...EMPTY_STATE, days });

  it('counts consecutive qualifying days ending today', () => {
    const state = base({ '2026-10-28': day(true), '2026-10-29': day(true), '2026-10-30': day(true) });
    expect(streakAsOf(state, '2026-10-30')).toBe(3);
  });

  it('still counts while today is unfinished', () => {
    const state = base({ '2026-10-28': day(true), '2026-10-29': day(true) });
    expect(streakAsOf(state, '2026-10-30')).toBe(2);
  });

  it('breaks on a missed or a dirty day', () => {
    expect(streakAsOf(base({ '2026-10-28': day(true), '2026-10-30': day(true) }), '2026-10-30')).toBe(1);
    expect(streakAsOf(base({ '2026-10-29': day(true, false), '2026-10-30': day(true) }), '2026-10-30')).toBe(1);
  });

  it('is not a condition of the speed task', () => {
    expect(qualifies({ solved: true, clean: true, swift: false, seconds: 4000 })).toBe(true);
    expect(qualifies({ solved: true, clean: false, swift: true, seconds: 60 })).toBe(false);
  });

  it('records a personal best and survives storage', () => {
    mem.clear();
    let state = EMPTY_STATE;
    state = withResult(state, '2026-10-29', day(true, true, false));
    state = withResult(state, '2026-10-30', day(true, true, false));
    expect(state.best).toBe(2);
    expect(state.lastPerfect).toBe('2026-10-30');
    writeDaily(state);
    expect(readDaily()).toEqual(state);
  });

  it('ignores garbage in storage instead of crashing the screen', () => {
    mem.set('pikachu.sudoku.daily.v1', '{"days":{"x":1,"2026-10-30":{"solved":"yes"}},"streak":"nine"}');
    const state = readDaily();
    expect(state.streak).toBe(0);
    expect(state.days['x']).toBeUndefined();
    expect(state.days['2026-10-30']).toEqual({ solved: true, clean: false, swift: false, seconds: 0 });
    mem.set('pikachu.sudoku.daily.v1', 'not json at all');
    expect(readDaily()).toEqual(EMPTY_STATE);
  });

  it('keeps the stored history bounded', () => {
    let state = EMPTY_STATE;
    for (let i = 0; i < 200; i++) state = withResult(state, addDays('2026-10-30', -i), day(true));
    expect(Object.keys(state.days).length).toBeLessThanOrEqual(62);
    expect(state.days['2026-10-30']).toBeDefined();
  });
});

describe('sharing', () => {
  it('says what you did without giving anything away', () => {
    const state = withResult(EMPTY_STATE, '2026-10-30', day(true, true, false));
    const text = shareText('2026-10-30', state);
    expect(text).toContain('2026-10-30');
    expect(text).toContain('✓✓·');
    expect(text).not.toMatch(/\b[1-9]{3,}\b/); // no run of digits that could be the board
  });
});
