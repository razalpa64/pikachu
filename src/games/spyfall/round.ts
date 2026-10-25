/**
 * Spyfall — the deal, the vote and the scoring, out of the screen.
 *
 * Everything in this file is pure and seeded, which is the only way to be sure of
 * the things a table game can quietly get wrong:
 *
 *   • exactly one spy, every round;
 *   • no two players holding the same role card;
 *   • the spy is not handed a role from the location they are meant to guess;
 *   • a vote with a tie accuses nobody, rather than picking a "winner" at random;
 *   • the spy's escape is worth more than a caught round, so bluffing pays.
 *
 * The screen never decides any of it — it renders `dealRound`, `tally` and
 * `scoreRound` and keeps the private cards behind a pass-the-device curtain,
 * which is the only way to hide a card on a single phone.
 */
import { rng, shuffled } from '../types';
import { LOCATIONS, QUESTIONS, rolesFor, type Location } from './deck';

export interface Seat {
  id: number;
  name: string;
}

export interface Deal {
  location: Location;
  /** seat index of the spy */
  spy: number;
  /** role per seat; the spy's entry is null — they are only ever "the spy" */
  roles: (string | null)[];
  /** the shape of the table, so every card can say "3 of 5 players" */
  seats: number;
  /** three questions to seed the interrogation */
  prompts: string[];
}

export interface RoundResult {
  /** who the table accused; null when the vote tied or nobody was named */
  accused: number | null;
  /** the accusation was right */
  caught: boolean;
  /** the spy named the location after escaping */
  guessedRight: boolean;
  /** per-seat points for the round */
  points: number[];
  summary: string;
}

export const MIN_SEATS = 3;
export const MAX_SEATS = 8;

/** Rounds are scored the same way the boxed game does it: the table splits a catch. */
export const POINTS = {
  /** each agent earns this when the spy is caught */
  agentCatch: 1,
  /** the spy earns this by escaping the vote */
  spyEscape: 2,
  /** and this extra for naming the location afterwards */
  spyLocation: 1,
};

export function dealRound(seatCount: number, seed: number, pool: Location[] = LOCATIONS): Deal {
  const seats = Math.max(MIN_SEATS, Math.min(MAX_SEATS, Math.floor(seatCount)));
  const r = rng(seed >>> 0);
  const location = pool[Math.floor(r() * pool.length)] ?? pool[0];
  const spy = Math.floor(r() * seats);
  const roles = rolesFor(location, seats);

  // The spy never gets a role card: a card would name the location they are trying
  // to guess, which is the one thing that must not happen.
  const assignment: (string | null)[] = [];
  let cursor = 0;
  for (let seat = 0; seat < seats; seat++) {
    assignment.push(seat === spy ? null : roles[cursor++]);
  }

  const prompts = shuffled(QUESTIONS.map((_, i) => i), (seed ^ 0x9e3779b9) >>> 0)
    .slice(0, 3)
    .map((i) => QUESTIONS[i]);

  return { location, spy, roles: assignment, seats, prompts };
}

/**
 * Count a secret ballot. Returns the accused seat, or null when there is no
 * single most-voted player — a tie accuses nobody, which is the rule that keeps
 * a table from lynching whoever spoke last.
 */
export function tally(votes: (number | null)[], seats: number): { accused: number | null; counts: number[] } {
  const counts = Array.from({ length: seats }, () => 0);
  for (const v of votes) {
    if (v === null || v === undefined) continue;
    if (!Number.isInteger(v) || v < 0 || v >= seats) continue;
    counts[v] += 1;
  }
  const best = Math.max(0, ...counts);
  if (best === 0) return { accused: null, counts };
  const leaders = counts.map((c, i) => (c === best ? i : -1)).filter((i) => i >= 0);
  return { accused: leaders.length === 1 ? leaders[0] : null, counts };
}

export function scoreRound(deal: Deal, votes: (number | null)[], spyGuess: string | null): RoundResult {
  const { accused, counts } = tally(votes, deal.seats);
  const caught = accused !== null && accused === deal.spy;
  const points = Array.from({ length: deal.seats }, () => 0);

  if (caught) {
    for (let seat = 0; seat < deal.seats; seat++) if (seat !== deal.spy) points[seat] += POINTS.agentCatch;
  } else {
    points[deal.spy] += POINTS.spyEscape;
  }

  const guessedRight = !caught && !!spyGuess && spyGuess === deal.location.id;
  if (guessedRight) points[deal.spy] += POINTS.spyLocation;

  const spyName = `Player ${deal.spy + 1}`;
  const summary = caught
    ? `${spyName} was the spy. The table called it, ${counts[deal.spy]} vote${counts[deal.spy] === 1 ? '' : 's'} to ${Math.max(0, ...counts.filter((_, i) => i !== deal.spy))}.`
    : accused === null
      ? `The vote tied, so nobody was accused — ${spyName} was the spy, at ${deal.location.name}.`
      : `${spyName} walked. ${deal.location.name} was the location${guessedRight ? ', and the spy named it.' : '.'}`;

  return { accused, caught, guessedRight, points, summary };
}

/** Human-readable card for a seat — the only thing that goes in front of a player. */
export function cardFor(deal: Deal, seat: number): { spy: boolean; title: string; body: string } {
  if (seat === deal.spy) {
    return {
      spy: true,
      title: 'You are the spy',
      body: 'You were not given a role card. Listen, bluff, and work out the location — or survive the vote and take one guess at the end.',
    };
  }
  return {
    spy: false,
    title: deal.roles[seat] ?? 'Agent',
    body: `You are at the ${deal.location.name}. Answer questions like someone who has been here before; do not make it easy.`,
  };
}

export const spiesLocationList = () => LOCATIONS.map((l) => l.name);
