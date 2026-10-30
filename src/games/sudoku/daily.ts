/**
 * The daily sudoku, and the three things it asks of you.
 *
 * A daily puzzle on its own is a nice habit; a daily puzzle with *goals* is a
 * reason to come back tomorrow. So the day has a fixed grid — the same one for
 * everybody, derived from the date, not from a server we do not have — and three
 * tasks to complete on it:
 *
 *   1. finish it
 *   2. finish it without a single wrong entry
 *   3. finish it inside the target time
 *
 * The streak counts days where the grid was finished *and* the clean run was
 * kept, so the streak means "I did the thing properly", not "I clicked a lot".
 * Everything is local, and everything is honest: there is no invented count of
 * other players, and a missed day breaks the streak the next time it is read
 * rather than when it is next written.
 *
 * The pure parts live here so they can be tested without a browser; the storage
 * wrappers at the bottom are the only impure lines in the file.
 */
import { generate, type Grid, type Level } from './engine';

export const DAILY_VERSION = 1;
const KEY = `pikachu.sudoku.daily.v${DAILY_VERSION}`;
/** how long the daily should take — task three's target */
export const DAILY_TARGET_SECONDS = 12 * 60;
/** the daily is always this level: one board, one difficulty, one ladder */
export const DAILY_LEVEL: Level = 'casual';

export type TaskId = 'solve' | 'clean' | 'swift';

export interface TaskDef { id: TaskId; label: string; hint: string }

export const TASKS: TaskDef[] = [
  { id: 'solve', label: 'Finish today’s grid', hint: 'Every cell filled, no rule broken.' },
  { id: 'clean', label: 'No wrong entries', hint: 'Not one red cell for the whole solve.' },
  { id: 'swift', label: 'Inside 12 minutes', hint: 'The clock stops the moment the board is full.' },
];

/** `2026-10-30` in the player's own timezone — a daily must change at midnight, locally. */
export function dateKey(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function addDays(key: string, delta: number): string {
  const [y, m, d] = key.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + delta);
  return dateKey(dt);
}

export interface DailyPuzzle { date: string; seed: number; level: Level; puzzle: Grid; solution: Grid; clues: number }

/* Generating costs a few milliseconds, but the board must not be rebuilt on
   every render, and the *same* board must come back after a reload. One entry is
   all we ever need: today's. */
let memo: DailyPuzzle | null = null;

export function dailyPuzzle(date: string = dateKey()): DailyPuzzle {
  if (memo && memo.date === date) return memo;
  /* A different salt to `dailySeed` so the sudoku grid is not the same pattern
     as any other daily in the app that uses the date as a seed. */
  const seed = hash(`sudoku:${date}:v${DAILY_VERSION}`);
  const { puzzle, solution, clues } = generate(seed, DAILY_LEVEL);
  memo = { date, seed, level: DAILY_LEVEL, puzzle, solution, clues };
  return memo;
}

function hash(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h ^ 0x9e3779b9) >>> 0;
}

export interface DayResult { solved: boolean; clean: boolean; swift: boolean; seconds: number }

export interface DailyState {
  /** the most recent day whose *whole* task list was completed */
  lastPerfect: string | null;
  /** consecutive qualifying days, as of `asOf` */
  streak: number;
  best: number;
  /** recent days, newest last — bounded so storage cannot grow without limit */
  days: Record<string, DayResult>;
}

export const EMPTY_STATE: DailyState = { lastPerfect: null, streak: 0, best: 0, days: {} };

/** What counts for the streak: the grid finished, and finished cleanly. Speed is
 *  a bonus task, not a condition — a slow, correct solve is still a good day. */
export const qualifies = (r: DayResult | undefined): boolean => Boolean(r?.solved && r?.clean);

/** How many days in a row ending at `today` qualify. */
export function streakAsOf(state: DailyState, today: string): number {
  let n = 0;
  let cursor = today;
  // today counts only once it qualifies; yesterday-or-earlier can carry the streak
  if (!qualifies(state.days[cursor])) cursor = addDays(cursor, -1);
  while (qualifies(state.days[cursor])) {
    n += 1;
    cursor = addDays(cursor, -1);
    if (n > 3650) break; // a corrupt clock must not spin
  }
  return n;
}

/** Fold a finished (or abandoned) attempt into the record. Pure. */
export function withResult(state: DailyState, date: string, result: DayResult): DailyState {
  const previous = state.days[date];
  /* Best-of within a day: replaying the daily must never make the day worse. */
  const merged: DayResult = previous
    ? {
      solved: previous.solved || result.solved,
      clean: previous.clean || result.clean,
      swift: previous.swift || result.swift,
      seconds: Math.min(
        previous.solved ? previous.seconds : Infinity,
        result.solved ? result.seconds : Infinity,
      ) === Infinity ? 0 : Math.min(
        previous.solved ? previous.seconds : Infinity,
        result.solved ? result.seconds : Infinity,
      ),
    }
    : result;

  const days = { ...state.days, [date]: merged };
  // keep the record bounded: two months of history is plenty for a streak
  const keys = Object.keys(days).sort();
  while (keys.length > 62) {
    const gone = keys.shift()!;
    delete days[gone];
  }
  const streak = streakAsOf({ ...state, days }, date);
  return {
    ...state,
    days,
    streak,
    best: Math.max(state.best, streak),
    lastPerfect: qualifies(merged) ? date : state.lastPerfect,
  };
}

export interface TaskView extends TaskDef { done: boolean }

export function tasksFor(state: DailyState, date: string): TaskView[] {
  const day = state.days[date];
  return TASKS.map((t) => ({
    ...t,
    done: t.id === 'solve' ? Boolean(day?.solved) : t.id === 'clean' ? Boolean(day?.clean) : Boolean(day?.swift),
  }));
}

export const allDone = (state: DailyState, date: string) => tasksFor(state, date).every((t) => t.done);

/* ------------------------------------------------------------------ storage */

/** Storage, or nothing. Accessing `localStorage` itself can throw — Safari in
 *  private mode does — so even asking for it is wrapped. */
function store(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function readDaily(): DailyState {
  try {
    const raw = store()?.getItem(KEY);
    if (raw == null) return { ...EMPTY_STATE };
    const parsed = JSON.parse(raw) as Partial<DailyState>;
    const days: Record<string, DayResult> = {};
    if (parsed && typeof parsed.days === 'object' && parsed.days) {
      for (const [k, v] of Object.entries(parsed.days)) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(k) || !v || typeof v !== 'object') continue;
        const r = v as Partial<DayResult>;
        days[k] = {
          solved: Boolean(r.solved), clean: Boolean(r.clean), swift: Boolean(r.swift),
          seconds: Math.max(0, Number(r.seconds) || 0),
        };
      }
    }
    return {
      lastPerfect: typeof parsed.lastPerfect === 'string' ? parsed.lastPerfect : null,
      streak: Math.max(0, Number(parsed.streak) || 0),
      best: Math.max(0, Number(parsed.best) || 0),
      days,
    };
  } catch {
    return { ...EMPTY_STATE };
  }
}

export function writeDaily(state: DailyState): void {
  try { store()?.setItem(KEY, JSON.stringify(state)); } catch { /* private mode: the day still plays, it just is not remembered */ }
}

/** A share string that spoils nothing: which tasks you got, never the board. */
export function shareText(date: string, state: DailyState): string {
  const tasks = tasksFor(state, date);
  const marks = tasks.map((t) => (t.done ? '✓' : '·')).join('');
  const streak = streakAsOf(state, date);
  return `Pikachu Sudoku · ${date} · ${marks}${streak > 1 ? ` · ${streak}-day streak` : ''}`;
}

/* ------------------------------------------------------------------ resume */

/** A daily in progress. Only the daily is worth resuming — a free-play board is
 *  a new board one tap away. */
export interface SavedProgress {
  date: string;
  cells: { v: number; notes: number[] }[];
  seconds: number;
  mistakes: number;
  hints: number;
}

const PROGRESS_KEY = `pikachu.sudoku.progress.v${DAILY_VERSION}`;

export function readProgress(today: string): SavedProgress | null {
  try {
    const raw = store()?.getItem(PROGRESS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SavedProgress>;
    if (!parsed || parsed.date !== today || !Array.isArray(parsed.cells)) return null;
    return {
      date: today,
      cells: parsed.cells.map((c) => ({
        v: Number(c?.v) >= 1 && Number(c?.v) <= 9 ? Number(c.v) : 0,
        notes: Array.isArray(c?.notes) ? c.notes.map(Number).filter((n) => n >= 1 && n <= 9) : [],
      })),
      seconds: Math.max(0, Number(parsed.seconds) || 0),
      mistakes: Math.max(0, Number(parsed.mistakes) || 0),
      hints: Math.max(0, Number(parsed.hints) || 0),
    };
  } catch {
    return null;
  }
}

export function saveProgress(p: SavedProgress): void {
  try { store()?.setItem(PROGRESS_KEY, JSON.stringify(p)); } catch { /* not remembered, still playable */ }
}

export function clearProgress(): void {
  try { store()?.removeItem(PROGRESS_KEY); } catch { /* nothing to clear */ }
}
