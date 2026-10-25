/**
 * Pikachu's half of Would You Rather.
 *
 * Two different jobs, so two different functions:
 *
 *   `aiChoose` — when the arcade is the chooser it has to have an *opinion*. It is
 *   deterministic from (dilemma, seed), so the same Pikachu you are playing with
 *   answers the same dilemma the same way all evening instead of flickering.
 *
 *   `aiGuess` — when the arcade is the guesser it is trying to read *you*. It
 *   starts out guessing, then notices which side you actually favour and leans on
 *   that. Difficulty only changes how quickly it starts paying attention and how
 *   often it ignores the evidence — it never cheats by reading the current pick.
 */
import { rng, type Difficulty } from '../types';
import type { WyrRound, Side } from './rules';

export function aiChoose(dilemmaId: number, seed: number): Side {
  const r = rng((seed ^ (dilemmaId * 2654435761)) >>> 0);
  return r() < 0.5 ? 'a' : 'b';
}

interface Tuning {
  /** how many of your previous answers before it starts using them */
  sample: number;
  /** probability of using the model at all, once it has a sample */
  trust: number;
}

const TUNING: Record<Difficulty, Tuning> = {
  beginner: { sample: 99, trust: 0 },      // never reads you
  casual: { sample: 6, trust: 0.5 },
  intermediate: { sample: 4, trust: 0.68 },
  advanced: { sample: 3, trust: 0.82 },
  expert: { sample: 2, trust: 0.92 },
};

export function aiGuess(history: WyrRound[], difficulty: Difficulty, seed: number): Side {
  const tune = TUNING[difficulty] ?? TUNING.intermediate;
  // only the rounds where *you* were the chooser tell Pikachu anything about you
  const yours = history.filter((r) => r.chooser === 0 && r.choice !== null).map((r) => r.choice as Side);
  const r = rng((seed ^ (history.length * 0x9e3779b1)) >>> 0);

  if (yours.length < tune.sample || r() > tune.trust) {
    return r() < 0.5 ? 'a' : 'b';
  }
  const aCount = yours.filter((s) => s === 'a').length;
  const bCount = yours.length - aCount;
  if (aCount === bCount) return r() < 0.5 ? 'a' : 'b';
  return aCount > bCount ? 'a' : 'b';
}

/** A short, human line for the reveal. */
export function aiLine(round: WyrRound, aiSeat: 0 | 1): string {
  const aiWasChooser = round.chooser === aiSeat;
  if (round.choice === null) return 'You ran out of time — no point either way.';
  if (round.guess === null) return 'No guess in time. The point is yours.';
  if (aiWasChooser) {
    return round.hit
      ? 'Pikachu called it. It is starting to know you.'
      : 'Pikachu did not see that one coming.';
  }
  return round.hit ? 'Read you like a book.' : 'You surprised Pikachu.';
}
