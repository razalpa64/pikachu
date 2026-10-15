/**
 * Wild Eights — opponent.
 *
 * No search tree here: the game is mostly hidden information, so a deep search
 * would be searching its own guesses. Instead the tiers differ by how much real
 * reasoning they do — card economy, suit control, action-card timing, and what
 * they remember about the suits you could not follow.
 */
import type { Difficulty, Slot } from '../types';
import { rng } from '../types';
import {
  SUITS, type Suit, type EightsState,
  canPlay, isWild, rankOf, suitOf, cardValue, playable, topCard,
} from './rules';

export type Decision =
  | { type: 'play'; card: number }
  | { type: 'draw' }
  | { type: 'pass' }
  | { type: 'take' }
  | { type: 'suit'; suit: Suit };

/** Think time, so the opponent does not feel like a vending machine. */
export const THINK_MS: Record<Difficulty, [number, number]> = {
  beginner: [700, 1500],
  casual: [650, 1400],
  intermediate: [600, 1300],
  advanced: [550, 1200],
  expert: [450, 1100],
};

const countSuits = (hand: number[]) => {
  const c: Record<Suit, number> = { hearts: 0, diamonds: 0, clubs: 0, spades: 0 };
  for (const card of hand) if (!isWild(card)) c[suitOf(card)] += 1;
  return c;
};

/** Which suit to call after an eight. */
export function pickSuit(state: EightsState, who: Slot, difficulty: Difficulty, r: () => number): Suit {
  const hand = state.hands[who];
  if (difficulty === 'beginner') return SUITS[Math.floor(r() * 4)];

  const mine = countSuits(hand);
  if (difficulty === 'casual' || difficulty === 'intermediate') {
    return SUITS.slice().sort((a, b) => mine[b] - mine[a])[0];
  }

  // advanced + expert: favour my strongest suit, but weight up any suit the
  // opponent has already shown they cannot follow
  const theirVoids = state.passedOn[who === 0 ? 1 : 0];
  let best: Suit = SUITS[0];
  let bestScore = -Infinity;
  for (const s of SUITS) {
    let score = mine[s] * 2;
    if (theirVoids.includes(s)) score += difficulty === 'expert' ? 5 : 3;
    if (mine[s] === 0) score -= 3;
    score += r() * 0.4;
    if (score > bestScore) { bestScore = score; best = s; }
  }
  return best;
}

/**
 * Score a candidate play. Higher is better.
 *
 * This is tuned for *winning*, not for the traditional points-in-hand tiebreak.
 * The levers that actually decide a game of eights are, in order:
 *   1. going out this turn,
 *   2. taking another turn (skip cards) — a free card off your hand,
 *   3. making the opponent pick up,
 *   4. keeping an eight in reserve, because it is the only card that always plays,
 *   5. staying able to follow suit next turn.
 * Shedding expensive cards only matters once those are equal.
 */
function scorePlay(state: EightsState, who: Slot, card: number, difficulty: Difficulty, r: () => number): number {
  const hand = state.hands[who];
  const opponent = who === 0 ? 1 : 0;
  const theirCount = state.hands[opponent].length;
  const mine = countSuits(hand);
  const sharp = difficulty === 'advanced' || difficulty === 'expert';
  let score = 0;

  // 1. this play empties the hand — nothing else comes close
  if (hand.length === 1) return 1000 + r();

  if (isWild(card)) {
    // 4. an eight is a guaranteed out; spending it early throws that away
    score -= 40;
  } else {
    // 5. prefer a suit you are long in, so you can follow again next turn
    score += mine[suitOf(card)] * (sharp ? 3.2 : 1.6);
    // tiebreak only: get the expensive cards off the hand
    score += cardValue(card) * 0.22;
  }

  if (state.config.actionCards) {
    const rk = rankOf(card);
    // 2. a jack or ace hands the turn straight back — effectively a free discard
    if (rk === 10 || rk === 0) score += sharp ? 46 : 30;
    // 3. a two costs them two cards and a turn; worth most when they are nearly out
    if (rk === 1) score += (theirCount <= 3 ? 34 : 20) * (sharp ? 1 : 0.7);
  }

  // changing suit by rank is free — valuable when they have shown they cannot follow it
  if (!isWild(card) && rankOf(card) === rankOf(topCard(state))) {
    score += 5;
    if (sharp && state.passedOn[opponent].includes(suitOf(card))) score += 16;
  }

  const noise = difficulty === 'casual' ? 30 : difficulty === 'intermediate' ? 12 : difficulty === 'advanced' ? 4 : 1.5;
  return score + r() * noise;
}

/**
 * One decision for the AI seat. Call it repeatedly; it returns the single next
 * action, so the view can animate drawing a card at a time.
 */
export function decide(state: EightsState, who: Slot, difficulty: Difficulty): Decision {
  const r = rng((state.seed ^ (state.discard.length * 0x9e3779b9) ^ (state.hands[who].length * 2654435761)) >>> 0);

  if (state.awaitingSuit) return { type: 'suit', suit: pickSuit(state, who, difficulty, r) };

  if (state.pendingDraw > 0) {
    const counter = state.hands[who].filter((c) => canPlay(state, c));
    if (counter.length) {
      // stack it back — always right, it moves the penalty across the table
      return { type: 'play', card: counter.sort((a, b) => cardValue(b) - cardValue(a))[0] };
    }
    return { type: 'take' };
  }

  const options = playable(state, who);
  if (options.length) {
    // a beginner just plays something legal — that is the whole difference
    if (difficulty === 'beginner') return { type: 'play', card: options[Math.floor(r() * options.length)] };
    let best = options[0];
    let bestScore = -Infinity;
    for (const c of options) {
      const s = scorePlay(state, who, c, difficulty, r);
      if (s > bestScore) { bestScore = s; best = c; }
    }
    return { type: 'play', card: best };
  }

  if (state.drawnThisTurn < state.config.drawLimit && state.stock.length + state.discard.length > 1) {
    return { type: 'draw' };
  }
  return { type: 'pass' };
}
