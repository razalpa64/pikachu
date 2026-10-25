/**
 * The front page's shop window.
 *
 * These tests exist because of a specific complaint: the games that had just
 * been added were "not there". They were in the registry and in the library, but
 * the home rails were `filter(...).slice(0, 9)` over registry order, so the same
 * nine early entries were the entire page every single day — and the row labelled
 * "Party & trivia" was chess, checkers and Mancala.
 *
 * So the promises tested here are deliberately about *visibility*:
 *
 *   • every rail is capped and never repeats a game;
 *   • "Party & trivia" contains only party games;
 *   • "Best with two" contains only games the relay can actually referee;
 *   • over the course of a month, every game in the catalogue appears on the
 *     front page at least once;
 *   • the page is stable for a given day and different the next one.
 */
import { describe, expect, it } from 'vitest';

import { GAMES, liveGames } from '../../games/registry';
import { FEATURED_SIZE, RAIL_SIZE, dayHash, railPicks, rotate } from '../rails';

const live = liveGames();

/** A year of date keys, the way `progress.dailySeed` produces them. */
const days = Array.from({ length: 365 }, (_, i) => dayHash(`2026-${(i % 12) + 1}-${(i % 28) + 1}-${i}`));

describe('rotate', () => {
  it('rotates without losing or duplicating anything', () => {
    const list = [1, 2, 3, 4, 5];
    for (const by of [0, 1, 4, 5, 7, -2, 10_000]) {
      const out = rotate(list, by);
      expect(out).toHaveLength(list.length);
      expect([...out].sort((a, b) => a - b)).toEqual(list);
    }
    expect(rotate([], 3)).toEqual([]);
    expect(rotate(list, 0)).toEqual(list);
  });
});

describe('the home rails', () => {
  it('caps every rail and never shows the same game twice in one rail', () => {
    for (const day of days.slice(0, 60)) {
      const rails = railPicks(live, day);
      expect(rails.quick.length).toBeLessThanOrEqual(RAIL_SIZE);
      expect(rails.together.length).toBeLessThanOrEqual(RAIL_SIZE);
      expect(rails.solo.length).toBeLessThanOrEqual(RAIL_SIZE);
      expect(rails.party.length).toBeLessThanOrEqual(RAIL_SIZE);
      expect(rails.featured).toHaveLength(FEATURED_SIZE);
      for (const rail of [rails.quick, rails.together, rails.solo, rails.party]) {
        expect(new Set(rail.map((g) => g.id)).size, 'a rail repeats a game').toBe(rail.length);
      }
      expect(new Set(rails.featured.map((g) => g.id)).size, 'the featured grid repeats').toBe(FEATURED_SIZE);
    }
  });

  it('fills "Party & trivia" with party games, not chess boards', () => {
    for (const day of days.slice(0, 60)) {
      const { party } = railPicks(live, day);
      expect(party.length).toBeGreaterThan(0);
      for (const g of party) expect(g.genre, `${g.id} is not a party game`).toBe('party');
      expect(party.map((g) => g.id)).toContain('spyfall');
      expect(party.map((g) => g.id)).not.toContain('chess');
    }
  });

  it('only offers refereed games in "Best with two"', () => {
    for (const day of days.slice(0, 60)) {
      const { together } = railPicks(live, day);
      expect(together.length).toBeGreaterThan(0);
      for (const g of together) {
        expect(g.serverRefereed, `${g.id} cannot be played online`).toBe(true);
        expect(g.modes, `${g.id} does not offer online`).toContain('online');
        expect(g.players[1], `${g.id} has no second seat`).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it('keeps the "five minutes" row short enough to be true', () => {
    for (const day of days.slice(0, 60)) {
      for (const g of railPicks(live, day).quick) expect(g.duration, `${g.id} is not a quick game`).toBeLessThanOrEqual(6);
    }
  });

  it('puts every single game in the catalogue on the front page within a year', () => {
    const shown = new Set<string>();
    for (const day of days) {
      const rails = railPicks(live, day);
      for (const rail of [rails.quick, rails.together, rails.solo, rails.party, rails.featured]) {
        for (const g of rail) shown.add(g.id);
      }
    }
    const missing = GAMES.map((g) => g.id).filter((id) => !shown.has(id));
    expect(missing, `these games never reach the front page: ${missing.join(', ')}`).toEqual([]);
  });

  it('is stable for one day and different the next', () => {
    const today = dayHash('2026-10-25');
    const tomorrow = dayHash('2026-10-26');
    expect(railPicks(live, today)).toEqual(railPicks(live, today));
    expect(railPicks(live, today).quick.map((g) => g.id))
      .not.toEqual(railPicks(live, tomorrow).quick.map((g) => g.id));
  });
});
