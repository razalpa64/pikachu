/**
 * Imposter — rules.
 *
 * A pass-the-device party game for 3–8 people. Everyone is shown the same secret
 * word except the imposter, who either sees nothing or a plausible decoy from the
 * same group. Players take turns saying one word about the secret out loud, then
 * vote. The imposter gets one chance to steal it by naming the word.
 *
 * The whole thing is deterministic from (config, seed), so a round can be
 * replayed exactly — which is what makes it testable.
 */
import { rng, shuffled } from '../types';

export type Phase = 'reveal' | 'clues' | 'vote' | 'defence' | 'result';

export interface WordGroup {
  topic: string;
  words: string[];
}

/** Words are grouped so a decoy is always believable but never identical. */
export const GROUPS: WordGroup[] = [
  { topic: 'Breakfast', words: ['Pancakes', 'Waffles', 'Omelette', 'Porridge', 'Toast', 'Dosa', 'Croissant', 'Cereal'] },
  { topic: 'Places to go', words: ['Beach', 'Museum', 'Cinema', 'Mountain', 'Library', 'Night market', 'Aquarium', 'Rooftop'] },
  { topic: 'Around the house', words: ['Kettle', 'Mirror', 'Doormat', 'Ceiling fan', 'Bookshelf', 'Laundry basket', 'Balcony', 'Fridge'] },
  { topic: 'Weather', words: ['Monsoon', 'Heatwave', 'Drizzle', 'Thunderstorm', 'Fog', 'Snowfall', 'Breeze', 'Humidity'] },
  { topic: 'Travel', words: ['Airport', 'Train station', 'Suitcase', 'Passport', 'Window seat', 'Road trip', 'Hostel', 'Boarding pass'] },
  { topic: 'Jobs', words: ['Teacher', 'Surgeon', 'Pilot', 'Chef', 'Firefighter', 'Architect', 'Barista', 'Lifeguard'] },
  { topic: 'Sport', words: ['Cricket', 'Badminton', 'Swimming', 'Football', 'Chess', 'Cycling', 'Tennis', 'Marathon'] },
  { topic: 'Music', words: ['Guitar', 'Drums', 'Karaoke', 'Headphones', 'Concert', 'Piano', 'Playlist', 'Violin'] },
  { topic: 'Things that scare people', words: ['Heights', 'Public speaking', 'Spiders', 'The dark', 'Deep water', 'Dentists', 'Turbulence', 'Being late'] },
  { topic: 'Romance', words: ['First date', 'Love letter', 'Slow dance', 'Long drive', 'Candlelight', 'Handwritten note', 'Shared umbrella', 'Goodnight call'] },
  { topic: 'Food', words: ['Biryani', 'Pizza', 'Ramen', 'Ice cream', 'Mango', 'Chocolate', 'Street tacos', 'Filter coffee'] },
  { topic: 'Cinema', words: ['Plot twist', 'Soundtrack', 'Sequel', 'Popcorn', 'Opening scene', 'Villain', 'Cliffhanger', 'End credits'] },
];

export interface ImposterConfig {
  playerCount: number;
  names: string[];
  /** 1, or 2 once there are six or more players */
  imposters: number;
  /** show the imposter a decoy word instead of nothing — much harder for the crew */
  decoy: boolean;
  /** how many times round the table before voting */
  clueRounds: number;
}

export interface ImposterState {
  seed: number;
  config: ImposterConfig;
  topic: string;
  word: string;
  decoyWord: string | null;
  imposterSeats: number[];
  /** seat order for the clue phase */
  order: number[];
  phase: Phase;
  /** how many players have looked at their card */
  revealed: number;
  /** index into `order` during the clue phase */
  clueAt: number;
  votes: (number | null)[];
  accused: number | null;
  /** what the imposter typed when guessing the word */
  guess: string | null;
  winner: 'crew' | 'imposter' | null;
  reason: string;
}

export const MAX_PLAYERS = 8;
export const MIN_PLAYERS = 3;

export const defaultNames = (n: number) => Array.from({ length: n }, (_, i) => `Player ${i + 1}`);

export function createImposter(config: ImposterConfig, seed: number): ImposterState {
  const r = rng(seed);
  const count = Math.max(MIN_PLAYERS, Math.min(MAX_PLAYERS, config.playerCount));
  const imposters = Math.max(1, Math.min(count - 2, config.imposters));

  const group = GROUPS[Math.floor(r() * GROUPS.length)];
  const words = shuffled(group.words, seed);
  const word = words[0];
  const decoyWord = config.decoy ? words[1] : null;

  const seats = shuffled(Array.from({ length: count }, (_, i) => i), (seed ^ 0x6d2b79f5) >>> 0);
  return {
    seed,
    config: { ...config, playerCount: count, imposters, names: config.names.slice(0, count) },
    topic: group.topic, word, decoyWord,
    imposterSeats: seats.slice(0, imposters).sort((a, b) => a - b),
    order: shuffled(Array.from({ length: count }, (_, i) => i), (seed ^ 0x45d9f3b) >>> 0),
    phase: 'reveal', revealed: 0, clueAt: 0,
    votes: Array.from({ length: count }, () => null),
    accused: null, guess: null, winner: null, reason: '',
  };
}

export const isImposter = (s: ImposterState, seat: number) => s.imposterSeats.includes(seat);
export const nameOf = (s: ImposterState, seat: number) => s.config.names[seat] || `Player ${seat + 1}`;

/** What a given seat is allowed to see on their private card. */
export function cardFor(s: ImposterState, seat: number): { role: 'crew' | 'imposter'; word: string | null; topic: string } {
  if (isImposter(s, seat)) return { role: 'imposter', word: s.decoyWord, topic: s.topic };
  return { role: 'crew', word: s.word, topic: s.topic };
}

export function acknowledge(s: ImposterState): ImposterState {
  if (s.phase !== 'reveal') return s;
  const revealed = s.revealed + 1;
  return revealed >= s.config.playerCount
    ? { ...s, revealed, phase: 'clues', clueAt: 0 }
    : { ...s, revealed };
}

export function nextClue(s: ImposterState): ImposterState {
  if (s.phase !== 'clues') return s;
  const total = s.config.playerCount * s.config.clueRounds;
  const clueAt = s.clueAt + 1;
  return clueAt >= total ? { ...s, clueAt, phase: 'vote' } : { ...s, clueAt };
}

export const clueSeat = (s: ImposterState) => s.order[s.clueAt % s.config.playerCount];
export const clueRound = (s: ImposterState) => Math.floor(s.clueAt / s.config.playerCount) + 1;

export function castVote(s: ImposterState, voter: number, target: number): ImposterState {
  if (s.phase !== 'vote' || voter === target) return s;
  const votes = s.votes.slice();
  votes[voter] = target;
  return { ...s, votes };
}

export function tally(s: ImposterState): { counts: number[]; leaders: number[] } {
  const counts = Array.from({ length: s.config.playerCount }, () => 0);
  for (const v of s.votes) if (v !== null) counts[v] += 1;
  const top = Math.max(0, ...counts);
  const leaders = top === 0 ? [] : counts.map((c, i) => (c === top ? i : -1)).filter((i) => i >= 0);
  return { counts, leaders };
}

export const allVoted = (s: ImposterState) => s.votes.every((v) => v !== null);

/**
 * Close the vote. A tie means nobody is ejected and the imposter walks free —
 * the same way it works at a real table.
 */
export function closeVote(s: ImposterState): ImposterState {
  if (s.phase !== 'vote' || !allVoted(s)) return s;
  const { leaders } = tally(s);
  if (leaders.length !== 1) {
    return { ...s, phase: 'result', accused: null, winner: 'imposter', reason: 'The vote was tied — nobody was ejected.' };
  }
  const accused = leaders[0];
  if (!isImposter(s, accused)) {
    return {
      ...s, phase: 'result', accused, winner: 'imposter',
      reason: `${nameOf(s, accused)} was ejected, and was not the imposter.`,
    };
  }
  // caught — but they get one shot at the word
  return { ...s, phase: 'defence', accused };
}

const norm = (v: string) => v.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();

/** The caught imposter names the word. Getting it right steals the round. */
export function submitGuess(s: ImposterState, guess: string): ImposterState {
  if (s.phase !== 'defence') return s;
  const right = norm(guess) === norm(s.word);
  return {
    ...s, phase: 'result', guess,
    winner: right ? 'imposter' : 'crew',
    reason: right
      ? `Caught — but named the secret word. ${nameOf(s, s.accused ?? 0)} steals it.`
      : `${nameOf(s, s.accused ?? 0)} was the imposter and guessed "${guess.trim() || '—'}". The crew holds.`,
  };
}

/** Skip the steal attempt. */
export function concede(s: ImposterState): ImposterState {
  if (s.phase !== 'defence') return s;
  return {
    ...s, phase: 'result', winner: 'crew', guess: null,
    reason: `${nameOf(s, s.accused ?? 0)} was the imposter and passed on the guess. Clean catch.`,
  };
}
