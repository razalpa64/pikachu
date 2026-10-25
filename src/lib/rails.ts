/**
 * What the front page puts in each rail.
 *
 * The rails used to be `GAMES.filter(...).slice(0, 9)` — registry order, every
 * day. The registry grows at the bottom, so the same nine early games filled the
 * whole page forever: the "Party & trivia" row was chess, checkers and Mancala,
 * and none of the games added later was ever visible unless you went looking in
 * the library. That is a shop window that never changes.
 *
 * Two fixes live here, both pure so they can be tested without a browser:
 *
 *  1. **Party means party.** The row now filters on `genre === 'party'` instead
 *     of `modes.includes('local')`, which every turn-based board happens to
 *     support. A row that promises a table game shows table games.
 *  2. **The window rotates with the day.** Each rail is rotated by a hash of the
 *     date, so a rail is stable all day (two people opening the arcade together
 *     see the same page) and different tomorrow. Over a month every game gets a
 *     turn in front, which is why the coverage test can promise it.
 */

import type { GameMeta } from '../games/types';

/** How many tiles a rail shows. Short rows read faster than a wall of cards. */
export const RAIL_SIZE = 9;
/** One from each genre, plus two wildcards. */
export const FEATURED_SIZE = 6;
/** Games short enough to be the "a few minutes" row. */
export const QUICK_MINUTES = 6;

const GENRES = ['strategy', 'party', 'puzzle', 'arcade'] as const;

export interface Rails {
  /** Sorted by how much of an evening they ask for. */
  quick: GameMeta[];
  /** Server-refereed, two seats: the private-room games. */
  together: GameMeta[];
  /** Anything you can play with nobody else in the room. */
  solo: GameMeta[];
  /** Party games only — trivia, bluffing, dares, drawing. */
  party: GameMeta[];
  /** The six shown in "The game library". */
  featured: GameMeta[];
}

/** Stable, cheap hash of a date key — the same seed the rest of the app uses. */
export function dayHash(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return h;
}

/** Rotate a list without mutating it; `by` may be any integer. */
export function rotate<T>(list: readonly T[], by: number): T[] {
  if (list.length === 0) return [];
  const k = ((Math.floor(by) % list.length) + list.length) % list.length;
  if (k === 0) return list.slice();
  return [...list.slice(k), ...list.slice(0, k)];
}

const take = (list: GameMeta[], size: number) => list.slice(0, size);

export function railPicks(live: readonly GameMeta[], day: number): Rails {
  const all = live.filter((g) => g.status === 'live');
  const d = Math.abs(Math.floor(day));

  const quick = take(rotate(all.filter((g) => g.duration <= QUICK_MINUTES), d), RAIL_SIZE);
  const together = take(
    rotate(all.filter((g) => g.serverRefereed && g.modes.includes('online') && g.players[1] >= 2), d + 1),
    RAIL_SIZE,
  );
  const solo = take(
    rotate(all.filter((g) => g.modes.includes('solo') || g.modes.includes('ai') || g.modes.includes('local')), d + 2),
    RAIL_SIZE,
  );
  const party = take(rotate(all.filter((g) => g.genre === 'party'), d + 3), RAIL_SIZE);

  /* One from each genre first — the front page should not be six strategy boards
     with every puzzle invisible until the library — then fill from the rest. */
  const featured: GameMeta[] = [];
  GENRES.forEach((genre, i) => {
    const first = rotate(all.filter((g) => g.genre === genre), d + i)[0];
    if (first) featured.push(first);
  });
  for (const g of rotate(all, d)) {
    if (featured.length >= FEATURED_SIZE) break;
    if (!featured.includes(g)) featured.push(g);
  }

  return { quick, together, solo, party, featured: take(featured, FEATURED_SIZE) };
}
