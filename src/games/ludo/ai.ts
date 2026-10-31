/**
 * The opponent.
 *
 * A Ludo turn is a die and up to four choices, so the machine does not search —
 * it *judges*. For each token it could move it asks the questions a player asks:
 * does this take somebody? does it get me home? does it leave me standing where
 * the next player can eat me? does it finally get that last token out of the
 * yard? Then it weighs them.
 *
 * Difficulty is how carefully it looks and how often it chooses the merely
 * decent over the best — never which rules it follows. A beginner plays legal,
 * careless Ludo.
 */
import { rng, type Difficulty, type Slot } from '../types';
import {
  HOME_STEP, TOKENS, capturesAt, destination, homeCount, movableTokens, seatOf, yardCount, type LudoState,
} from './rules';
import { isSafeRing, ringIndexOf } from './track';

/** How much a square is worth being on: opponents behind it are what matters. */
function threatAt(state: LudoState, slot: Slot, to: number): number {
  const ring = ringIndexOf(seatOf(slot), to);
  if (ring === null) return 0;             // in the home lane: nobody can reach you
  if (isSafeRing(seatOf(slot), to)) return 0;
  let threat = 0;
  for (const other of [0, 1] as Slot[]) {
    if (other === slot) continue;
    for (const p of state.tokens[other]) {
      const theirs = ringIndexOf(seatOf(other), p);
      if (theirs === null) continue;
      // how many squares behind us are they, going the same way round?
      const gap = (ring - theirs + 52) % 52;
      if (gap >= 1 && gap <= 6) threat += 7 - gap;   // a 6 behind is the most dangerous
    }
  }
  return threat;
}

export function scoreMove(state: LudoState, slot: Slot, token: number, dice: number): number {
  const { from, to } = destination(state, slot, token, dice);
  const captured = capturesAt(state, slot, to);
  let score = 0;

  score += captured.length * 120;                  // eating a token is the best thing in the game
  if (to >= HOME_STEP) score += 95;                // and landing home is the point
  if (from < 0) score += 52;                       // a token in the yard is a token doing nothing
  if (isSafeRing(seatOf(slot), to)) score += 26;
  score += Math.min(20, to) * 0.4;                 // progress is worth something
  score -= threatAt(state, slot, to) * 4.5;        // but not if it walks into a knife

  // stepping off a square that somebody is about to land on is worth as much as
  // the capture they would have made
  score += threatAt(state, slot, from) * 3;

  // with most tokens home, a lone runner is the whole game: protect it
  if (homeCount(state, slot) >= 3 && to > 40) score += 14;
  // early on, breadth beats depth — get tokens out
  if (from < 0 && yardCount(state, slot) >= 3) score += 18;

  return score;
}

const EFFORT: Record<Difficulty, number> = {
  beginner: 4, casual: 3, intermediate: 2, advanced: 1, expert: 1,
};
const NOISE: Record<Difficulty, number> = {
  beginner: 60, casual: 34, intermediate: 16, advanced: 6, expert: 0,
};

/**
 * Which token to move. Deterministic for a position and a difficulty, so a
 * replayed match makes the same choices, and so a test can pin it down.
 */
export function chooseToken(state: LudoState, slot: Slot, difficulty: Difficulty = 'casual'): number | null {
  const dice = state.dice;
  if (dice === null) return null;
  const movable = movableTokens(state, slot, dice);
  if (!movable.length) return null;

  const random = rng((state.moves + 1) * 2246822519 + (slot + 1) * 3266489917);
  const scored = movable.map((token) => ({
    token,
    score: scoreMove(state, slot, token, dice) + (random() * 2 - 1) * NOISE[difficulty],
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored[Math.min(scored.length - 1, Math.floor(random() * Math.min(EFFORT[difficulty], scored.length)))].token;
}

/** Used by a hint button: the move an expert would make, without the noise. */
export const bestToken = (state: LudoState, slot: Slot) => chooseToken(state, slot, 'expert');

export { TOKENS };
