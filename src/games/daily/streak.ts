/**
 * The daily streak, kept honestly.
 *
 * A streak is only worth showing if it is true, so this stores exactly two
 * things — the last day that was actually solved, and how many days in a row
 * that is — and derives everything else. Missing a day resets the count the next
 * time it is read, rather than lying until it is written to again.
 *
 * All of it is local. There is no account, so there is no global "12,481 people
 * solved this today" counter to invent.
 */
import { dateKey } from './puzzle';

const KEY = 'pikachu.daily.v1';

export interface DailyRecord {
  /** YYYY-MM-DD of the most recent solve */
  lastSolved: string | null;
  streak: number;
  /** personal best, kept even after the streak breaks */
  best: number;
  /** how many times today's puzzle has been finished (0 or 1 in normal use) */
  solvedTodayOn: string | null;
}

const EMPTY: DailyRecord = { lastSolved: null, streak: 0, best: 0, solvedTodayOn: null };

const yesterdayOf = (key: string): string => {
  const [y, m, d] = key.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() - 1);
  return dateKey(dt);
};

export function readRecord(today: string = dateKey()): DailyRecord {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...EMPTY };
    const parsed = JSON.parse(raw) as Partial<DailyRecord>;
    const rec: DailyRecord = {
      lastSolved: typeof parsed.lastSolved === 'string' ? parsed.lastSolved : null,
      streak: Math.max(0, Number(parsed.streak) || 0),
      best: Math.max(0, Number(parsed.best) || 0),
      solvedTodayOn: typeof parsed.solvedTodayOn === 'string' ? parsed.solvedTodayOn : null,
    };
    /* A streak only survives if its last solve was today or yesterday — measured
       against the day being asked about, which is usually the wall clock but is
       passed explicitly when recording a solve for a known date. Reading the
       clock inside here made `recordSolve('2026-10-24')` zero a streak that the
       same call had just written. */
    if (rec.lastSolved && rec.lastSolved !== today && rec.lastSolved !== yesterdayOf(today)) {
      return { ...rec, streak: 0 };
    }
    return rec;
  } catch {
    return { ...EMPTY };
  }
}

/** Record a solve. Idempotent within a day: finishing twice does not inflate it. */
export function recordSolve(today: string = dateKey()): DailyRecord {
  const rec = readRecord(today);
  if (rec.solvedTodayOn === today) return rec;

  const streak = rec.lastSolved === yesterdayOf(today) ? rec.streak + 1 : 1;
  const next: DailyRecord = {
    lastSolved: today,
    streak,
    best: Math.max(rec.best, streak),
    solvedTodayOn: today,
  };
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* private mode — the game still works */ }
  return next;
}

export const solvedToday = (rec: DailyRecord, today: string = dateKey()) => rec.solvedTodayOn === today;
