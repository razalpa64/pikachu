/**
 * Spyfall — the deal, the vote and the scoring.
 *
 * A hidden-role game lives or dies on four promises, and all four are checkable
 * without a screen: there is always exactly one spy, nobody gets a second
 * player's identity, the spy is never handed the location, and a tied vote
 * accuses nobody. If any of those slips, the table plays a different game than
 * the one it was told it was playing.
 */
import { describe, expect, it } from 'vitest';
import { LOCATIONS, QUESTIONS, rolesFor } from '../spyfall/deck';
import {
  MAX_SEATS, MIN_SEATS, POINTS, cardFor, dealRound, scoreRound, tally,
} from '../spyfall/round';

const seeds = Array.from({ length: 64 }, (_, i) => (i * 2654435761) >>> 0);

describe('spyfall — the deck', () => {
  it('has enough locations to keep a table guessing', () => {
    expect(LOCATIONS.length).toBeGreaterThanOrEqual(12);
    expect(new Set(LOCATIONS.map((l) => l.id)).size, 'ids are unique').toBe(LOCATIONS.length);
    expect(new Set(LOCATIONS.map((l) => l.name)).size, 'names are unique').toBe(LOCATIONS.length);
  });

  it('gives every location a full set of eight distinct roles and a blurb', () => {
    for (const location of LOCATIONS) {
      expect(location.roles.length, `${location.name} roles`).toBe(MAX_SEATS);
      expect(new Set(location.roles).size, `${location.name} has no duplicate role`).toBe(MAX_SEATS);
      expect(location.blurb.length, `${location.name} blurb`).toBeGreaterThan(20);
    }
  });

  it('deals no more roles than there are seats, and never fewer than three', () => {
    const casino = LOCATIONS[0];
    expect(rolesFor(casino, 3)).toHaveLength(3);
    expect(rolesFor(casino, 6)).toHaveLength(6);
    expect(rolesFor(casino, 99)).toHaveLength(MAX_SEATS);
    expect(rolesFor(casino, 1)).toHaveLength(MIN_SEATS);
  });

  it('offers interrogation questions that do not name a place', () => {
    expect(QUESTIONS.length).toBeGreaterThanOrEqual(12);
    for (const location of LOCATIONS) {
      for (const question of QUESTIONS) {
        expect(question.toLowerCase()).not.toContain(location.name.toLowerCase());
      }
    }
  });
});

describe('spyfall — the deal', () => {
  it('always deals exactly one spy, for every table size and seed', () => {
    for (let seats = 0; seats <= 10; seats++) {
      for (const seed of seeds) {
        const deal = dealRound(seats, seed);
        const spies = deal.roles.map((role, seat) => (role === null ? seat : -1)).filter((s) => s >= 0);
        expect(spies, `seats=${seats} seed=${seed}`).toEqual([deal.spy]);
        expect(deal.roles).toHaveLength(deal.seats);
      }
    }
  });

  it('clamps a table to three-to-eight seats', () => {
    expect(dealRound(1, 5).seats).toBe(MIN_SEATS);
    expect(dealRound(2, 5).seats).toBe(MIN_SEATS);
    expect(dealRound(12, 5).seats).toBe(MAX_SEATS);
    expect(dealRound(4.8, 5).seats).toBe(4);
  });

  it('hands the agents eight different roles from the location they are in', () => {
    for (const seed of seeds) {
      const deal = dealRound(MAX_SEATS, seed);
      const agentRoles = deal.roles.filter((role): role is string => role !== null);
      expect(agentRoles).toHaveLength(MAX_SEATS - 1);
      expect(new Set(agentRoles).size, 'no two agents share a role').toBe(MAX_SEATS - 1);
      for (const role of agentRoles) expect(deal.location.roles).toContain(role);
      expect(deal.roles[deal.spy], 'the spy holds no role card').toBeNull();
    }
  });

  it('is deterministic for a seed, and varies across seeds', () => {
    expect(dealRound(5, 1234)).toEqual(dealRound(5, 1234));
    const locations = new Set(seeds.map((seed) => dealRound(5, seed).location.id));
    expect(locations.size, 'the whole deck gets used').toBeGreaterThan(4);
    const spySeats = new Set(seeds.map((seed) => dealRound(5, seed).spy));
    expect(spySeats.size, 'the spy moves around the table').toBeGreaterThan(2);
  });

  it('deals three different questions to seed the interrogation', () => {
    for (const seed of seeds) {
      const { prompts } = dealRound(5, seed);
      expect(prompts).toHaveLength(3);
      expect(new Set(prompts).size).toBe(3);
      for (const prompt of prompts) expect(QUESTIONS).toContain(prompt);
    }
  });

  it('never names the location on the spy’s card', () => {
    for (const seed of seeds) {
      const deal = dealRound(6, seed);
      const spyCard = cardFor(deal, deal.spy);
      expect(spyCard.spy).toBe(true);
      expect(spyCard.title).toMatch(/spy/i);
      expect(spyCard.body.toLowerCase()).not.toContain(deal.location.name.toLowerCase());
      expect(spyCard.body.toLowerCase()).not.toContain(deal.location.blurb.toLowerCase());
      // nothing that happens to be a role card either
      for (const role of deal.location.roles) expect(spyCard.body).not.toContain(role);
    }
  });

  it('tells each agent their own role and where they are', () => {
    for (const seed of seeds) {
      const deal = dealRound(7, seed);
      deal.roles.forEach((role, seat) => {
        if (seat === deal.spy) return;
        const card = cardFor(deal, seat);
        expect(card.spy).toBe(false);
        expect(card.title).toBe(role);
        expect(card.body).toContain(deal.location.name);
      });
    }
  });
});

describe('spyfall — the ballot', () => {
  it('accuses nobody when the vote ties', () => {
    expect(tally([0, 1], 3).accused).toBeNull();
    expect(tally([0, 1, 0, 1], 3).accused).toBeNull();
  });

  it('accuses nobody when every vote is an abstention or gibberish', () => {
    expect(tally([null, null, null], 3).accused).toBeNull();
    expect(tally([], 4).accused).toBeNull();
    expect(tally([9, -3, 1.5, 99], 4).accused).toBeNull();
    expect(tally([null, 2, 2], 4).accused).toBe(2);
  });

  it('accuses the single most-voted player', () => {
    const { accused, counts } = tally([1, 1, 0, 1], 4);
    expect(accused).toBe(1);
    expect(counts).toEqual([1, 3, 0, 0]);
  });
});

describe('spyfall — scoring', () => {
  const deal = (() => {
    for (const seed of seeds) {
      const d = dealRound(5, seed);
      if (d.spy === 2) return d;
    }
    throw new Error('no deal with the spy at seat 2');
  })();

  const spies = deal.spy;
  const votesAgainstSpy = Array.from({ length: deal.seats }, (_, seat) => (seat === spies ? null : spies));

  it('pays every agent when the table catches the spy', () => {
    const result = scoreRound(deal, votesAgainstSpy, null);
    expect(result.accused).toBe(spies);
    expect(result.caught).toBe(true);
    expect(result.guessedRight).toBe(false);
    result.points.forEach((points, seat) => {
      expect(points).toBe(seat === spies ? 0 : POINTS.agentCatch);
    });
    expect(result.summary).toMatch(/was the spy/i);
  });

  it('pays the spy for escaping, and more for naming the location', () => {
    const escaped = scoreRound(deal, [0, 0, 0, 1, 1], null);
    expect(escaped.caught).toBe(false);
    expect(escaped.points[spies]).toBe(POINTS.spyEscape);
    expect(escaped.points.filter((_, seat) => seat !== spies).every((p) => p === 0)).toBe(true);

    const named = scoreRound(deal, [0, 1], deal.location.id);
    expect(named.guessedRight).toBe(true);
    expect(named.points[spies]).toBe(POINTS.spyEscape + POINTS.spyLocation);
  });

  it('does not pay a spy for a wrong guess, or for guessing after being caught', () => {
    expect(scoreRound(deal, [0, 1], 'not-a-real-location').points[spies]).toBe(POINTS.spyEscape);

    const caught = scoreRound(deal, votesAgainstSpy, deal.location.id);
    expect(caught.guessedRight, 'a caught spy gets no guess').toBe(false);
    expect(caught.points[spies]).toBe(0);
  });

  it('tells the table when the vote tied, rather than inventing a result', () => {
    const tied = scoreRound(deal, [0, 1, 3, 0, 1], null);
    expect(tied.accused).toBeNull();
    expect(tied.caught).toBe(false);
    expect(tied.summary).toMatch(/tied/i);
    expect(tied.summary).toContain(deal.location.name);
  });

  it('makes escaping worth more than catching, so bluffing pays', () => {
    expect(POINTS.spyEscape).toBeGreaterThan(POINTS.agentCatch);
  });
});
