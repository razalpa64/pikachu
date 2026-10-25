/**
 * Pikachu's vocabulary.
 *
 * The AI answers only from the same list the arcade ships, filtered to words that
 * are legal right now — so it can never manufacture a word a person could not
 * also have typed. Difficulty changes two things and nothing else: how long it
 * takes to think, and how often it blanks entirely (which costs it a strike, the
 * same as it costs you).
 */
import { rng, type Difficulty } from '../types';
import { wordsStartingWith } from './words';

interface Tuning {
  /** ms before it answers */
  think: [number, number];
  /** chance it simply cannot think of anything */
  blank: number;
  /** it prefers longer words as the level rises */
  longBias: number;
}

export const TUNING: Record<Difficulty, Tuning> = {
  beginner: { think: [2600, 4200], blank: 0.18, longBias: 0.05 },
  casual: { think: [2200, 3600], blank: 0.12, longBias: 0.15 },
  intermediate: { think: [1800, 3000], blank: 0.08, longBias: 0.3 },
  advanced: { think: [1300, 2300], blank: 0.05, longBias: 0.5 },
  expert: { think: [900, 1700], blank: 0.02, longBias: 0.7 },
};

/** How long Pikachu will take this turn, in ms. Deterministic per (seed, turn). */
export function thinkMs(difficulty: Difficulty, seed: number, turn: number): number {
  const t = TUNING[difficulty] ?? TUNING.intermediate;
  const r = rng((seed ^ (turn * 0x85ebca6b)) >>> 0);
  return Math.round(t.think[0] + r() * (t.think[1] - t.think[0]));
}

/** The word it plays, or `null` when it blanks. */
export function pickWord(
  letter: string, used: string[], difficulty: Difficulty, seed: number, turn: number,
): string | null {
  const t = TUNING[difficulty] ?? TUNING.intermediate;
  const r = rng((seed ^ (turn * 0x27d4eb2f) ^ 0x9e3779b9) >>> 0);
  if (r() < t.blank) return null;

  const options = wordsStartingWith(letter).filter((w) => !used.includes(w));
  if (!options.length) return null;

  // sort by length, then pick a slot biased toward the shorter half; as the
  // difficulty rises the bias slides toward the longer words
  const sorted = options.slice().sort((a, b) => a.length - b.length);
  const lenient = sorted[Math.floor(r() * Math.max(1, Math.ceil(sorted.length * 0.55)))];
  const clever = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.5 + r() * Math.ceil(sorted.length * 0.5)))];
  return r() < t.longBias ? clever : lenient;
}
