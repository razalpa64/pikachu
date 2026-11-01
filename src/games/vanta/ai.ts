import type { Slot } from '../types';
import {
  MAX_ENERGY, PREDICTIONS, RELAYS, RELAY_WIN_COUNT, CENTRE, CORES,
  agentAt, cloneState, neighbours, objectiveById, resolveRound, targetsFor, territoryCount,
  RELAYS as ALL_RELAYS,
  vantaRules, type Prediction, type VantaAction, type VantaPlan, type VantaState,
} from './rules';

/**
 * The practice opponent.
 *
 * Not a random-action bot dressed up as one: every candidate plan is *played out*
 * through the real engine (with the opponent standing still) and the resulting
 * position is scored on the things that actually decide VANTA — influence,
 * relays, how many of their core's four approach squares you own, how many of
 * yours they own, energy in hand, and objective progress. The chosen plan is the
 * best of that list, with the amount of noise set by the difficulty.
 *
 * The read is separate and deliberately honest about its limits: in a
 * simultaneous game the opponent's plan is not knowable, so the AI builds a
 * distribution from what is public — their energy, their influence gap, their
 * last few actions (which the round report makes public) and the threat your
 * agents pose to their core — then picks the most likely category. At
 * `beginner` it guesses; at `expert` it is reading the same information a good
 * human would use.
 */

export type VantaStrength = 'beginner' | 'casual' | 'intermediate' | 'advanced' | 'expert';

interface Weights {
  /** how much noise goes into choosing the plan: 0 = always best, 1 = anything */
  noise: number;
  /** how many of the top candidates are in play */
  shortlist: number;
  /** how often the read follows the informed distribution rather than a coin */
  read: number;
}

const WEIGHTS: Record<VantaStrength, Weights> = {
  beginner: { noise: 0.9, shortlist: 9, read: 0.25 },
  casual: { noise: 0.55, shortlist: 6, read: 0.45 },
  intermediate: { noise: 0.28, shortlist: 4, read: 0.7 },
  advanced: { noise: 0.1, shortlist: 2, read: 0.85 },
  expert: { noise: 0, shortlist: 1, read: 1 },
};

const other = (s: Slot): Slot => (s === 0 ? 1 : 0);

/** Small deterministic RNG so the same board plays the same way twice. */
function hash(seed: number): number {
  let x = (seed >>> 0) || 0x2545f491;
  x ^= x << 13; x >>>= 0;
  x ^= x >> 17;
  x ^= x << 5; x >>>= 0;
  return x || 0x2545f491;
}
function rngFrom(seed: number) {
  let s = (seed >>> 0) || 0x2545f491;
  return () => {
    s = hash(s);
    return s / 0x100000000;
  };
}

const stateSeed = (s: VantaState, slot: Slot) => (
  s.rng ^ (s.round * 7919) ^ (slot * 104729) ^ (s.influence[slot] * 31) ^ (s.energy[slot] * 17)
);

const dist = (a: number, b: number) => Math.abs(Math.floor(a / 7) - Math.floor(b / 7)) + Math.abs((a % 7) - (b % 7));

/**
 * What the position is *about to* be worth: an agent is only as good as the
 * squares it can reach next round. Without this term the AI would claim its own
 * neighbourhood forever, because a claim scores today and a move only scores
 * tomorrow — so the term prices tomorrow.
 */
function potential(s: VantaState, slot: Slot): number {
  const foe = other(slot);
  const relays = RELAYS.filter((r) => s.owner[r] !== slot);
  const ring = neighbours(CORES[foe]).filter((n) => s.owner[n] !== slot);
  let v = 0;
  for (const a of s.agents[slot]) {
    if (a < 0) continue;
    for (const n of neighbours(a)) {
      if (s.owner[n] === null || s.relay[n]) v += 0.42;
      else if (s.owner[n] === foe && !s.anchored[n]) v += 0.55;
      else if (s.anchored[n] && s.owner[n] === slot) v += 0.1;
    }
    if (relays.length) v += Math.max(0, 4 - Math.min(...relays.map((r) => dist(a, r)))) * 0.32;
    if (ring.length) v += Math.max(0, 5 - Math.min(...ring.map((n) => dist(a, n)))) * 0.26;
  }
  return v;
}

/** Score a position from `slot`'s point of view. Used on real resolved states. */
export function evaluate(s: VantaState, slot: Slot): number {
  const foe = other(slot);
  if (s.over) {
    if (s.winner === slot) return 10_000;
    if (s.winner === foe) return -10_000;
    return 0;
  }
  const mine = territoryCount(s, slot);
  const theirs = territoryCount(s, foe);
  const myRelays = ALL_RELAYS.filter((r) => s.owner[r] === slot).length;
  const theirRelays = ALL_RELAYS.filter((r) => s.owner[r] === foe).length;
  const pressureOnThem = neighbours(CORES[foe]).filter((n) => s.owner[n] === slot).length;
  const pressureOnMe = neighbours(CORES[slot]).filter((n) => s.owner[n] === foe).length;

  let score = 0;
  score += (s.influence[slot] - s.influence[foe]) * 6;
  /* A relay sweep is a match win, not a score line: once three are held, the
     fourth is worth far more than the arithmetic says. */
  /* a bolt is what a relay is actually worth: only bolted posts count toward
     the sweep, so an unbolted relay is a queue position, not a hold */
  const myBolted = ALL_RELAYS.filter((r) => s.owner[r] === slot && s.anchored[r]).length;
  const theirBolted = ALL_RELAYS.filter((r) => s.owner[r] === foe && s.anchored[r]).length;
  if (myBolted >= RELAY_WIN_COUNT) score += 12;
  if (theirBolted >= RELAY_WIN_COUNT) score -= 14;
  else if (theirBolted === RELAY_WIN_COUNT - 1) score -= 7;
  else if (theirBolted === RELAY_WIN_COUNT - 2) score -= 2.4;
  score += (myBolted - theirBolted) * 4;
  /* the streak is a countdown on the wall, not a score line: once it is running
     only breaking a bolt stops it, so the clock has to be in the evaluation or
     the AI will happily play a good-looking round while it loses the match */
  score += s.relayStreak[slot] ** 2 * 6;
  score -= s.relayStreak[foe] ** 2 * 6;
  if (myRelays >= RELAY_WIN_COUNT) score += 9;
  else if (myRelays === RELAY_WIN_COUNT - 1) score += 3.5;
  /* and the mirror of it: if they are one post from a sweep, breaking it is the
     most valuable thing on the board */
  if (theirRelays >= RELAY_WIN_COUNT) score -= 14;
  else if (theirRelays === RELAY_WIN_COUNT - 1) score -= 7;
  else if (theirRelays === RELAY_WIN_COUNT - 2) score -= 2.4;
  score += (myRelays - theirRelays) * 7.5;
  score += myRelays === ALL_RELAYS.length ? 6 : 0;
  score += (mine - theirs) * 0.6;
  score += (s.energy[slot] - s.energy[foe]) * 0.5;
  score += pressureOnThem * 3.2;
  score -= pressureOnMe * 4.1;          // losing your own core ring loses the game
  if (!s.objectiveDone[slot]) score += Math.min(2, s.objectiveProgress[slot] * 0.3);
  if (s.objectiveDone[slot]) score += 0.6;
  score += potential(s, slot);
  /* keeping a healthy reserve matters more than one flashy anchor */
  if (s.energy[slot] === 0) score -= 1.5;
  /* near the line: closing out beats anything else */
  if (s.influence[slot] >= 10) score += 3;
  return score;
}

/** Every plan the seat could send, with the action variety intact. */
export function candidatePlans(s: VantaState, slot: Slot): VantaPlan[] {
  const out: VantaPlan[] = [];
  const legal = vantaRules.legalMoves(s, slot);
  for (const m of legal) out.push({ ...m, predict: 'move' });
  if (!out.length) out.push({ agent: 0, action: 'hold', to: null, predict: 'move' });
  return out;
}

/**
 * A concrete guess at what the opponent will do this round, built from the same
 * public information a person would use: if they are low on energy they cannot
 * anchor or snare; the square they most want is the best relay, ring or owning
 * square next to one of their agents.
 */
function foeGuess(s: VantaState, slot: Slot): VantaPlan {
  const foe = other(slot);
  const dist = readDistribution(s, slot);
  const action: Prediction = PREDICTIONS.reduce((best, p) => (dist[p] > dist[best] ? p : best), PREDICTIONS[0]);
  /* a guess that names an action they cannot afford is worse than no guess */
  if (action === 'anchor' || action === 'snare' ? s.energy[foe] < 2 : s.energy[foe] < 1 && action !== 'move') {
    return { agent: 0, action: 'hold', to: null, predict: 'claim' };
  }
  let bestAgent = 0;
  let bestTo: number | null = null;
  let bestScore = -Infinity;
  for (let a = 0; a < 3; a++) {
    if (s.stunned[foe].includes(a)) continue;
    for (const n of neighbours(s.agents[foe][a])) {
      if (!targetsFor(s, foe, a, action === 'feint' ? 'feint' : action).includes(n)) continue;
      let v = 0;
      if (s.owner[n] === slot) v += 2.2;      // they want what is mine
      if (s.relay[n]) v += 2.6;
      if (neighbours(CORES[slot]).includes(n)) v += 1.8;
      if (s.anchored[n] && s.owner[n] === slot) v -= 1.6;   // bolt: dear, not impossible
      if (v > bestScore) { bestScore = v; bestAgent = a; bestTo = n; }
    }
  }
  if (bestTo === null) return { agent: 0, action: 'hold', to: null, predict: 'claim' };
  return {
    agent: bestAgent,
    action,
    to: bestTo,
    predict: 'claim',
  };
}

/** Play the plan out through the engine against the best guess at their reply. */
function project(s: VantaState, slot: Slot, plan: VantaPlan, foe: VantaPlan): VantaState {
  const trial = cloneState(s);
  trial.plans = slot === 0 ? [{ ...plan }, { ...foe }] : [{ ...foe }, { ...plan }];
  const after = resolveRound(trial);
  return after;
}

/** Where would this plan land, for a human-readable reason? */
function actionPrior(s: VantaState, slot: Slot, plan: VantaPlan): number {
  const foe = other(slot);
  const square = plan.action === 'anchor' ? s.agents[slot][plan.agent] : plan.to;
  let prior = 0;
  if (square !== null && square !== undefined) {
    if (RELAYS.includes(square)) prior += 2.6;
    /* finishing a sweep */
    if (RELAYS.includes(square) && s.owner[square] !== slot) {
      const held = RELAYS.filter((r) => s.owner[r] === slot).length;
      if (held >= RELAY_WIN_COUNT - 1) prior += 4;
    }
    if (square === CENTRE) prior += 0.8;
    if (neighbours(CORES[foe]).includes(square)) prior += 1.4;
    if (neighbours(CORES[slot]).includes(square)) prior += 0.9;
  }
  if (plan.action === 'claim' && square !== null && s.owner[square] === foe) prior += 1.2;
  if (plan.action === 'claim' && square !== null && RELAYS.includes(square) && s.owner[square] === null) {
    prior += 2.4;
    /* an empty relay is a free relay for whoever gets there first: deny it */
    if (RELAYS.filter((r) => s.owner[r] === foe).length >= RELAY_WIN_COUNT - 1) prior += 3.2;
  }
  /* take a relay back off them — more urgent the closer they are to the sweep */
  if (plan.action === 'claim' && square !== null && RELAYS.includes(square) && s.owner[square] === foe) {
    const theirs = RELAYS.filter((r) => s.owner[r] === foe).length;
    prior += theirs >= RELAY_WIN_COUNT - 1 ? 6.5 : theirs >= RELAY_WIN_COUNT - 2 ? 4 : 2.2;
  }
  /* breaking a bolt is expensive, so it needs to be worth more than a plain
     steal — otherwise a bolted relay reads as a wall and the AI just dies to
     three bolts */
  if (plan.action === 'claim' && square !== null && s.anchored[square] && s.owner[square] === foe) prior += 1.8;
  /* a parked agent is the cheapest wall in the game: shoving it off a post is
     the only way a held relay comes loose, so price it like the win it denies */
  if (plan.action === 'claim' && square !== null && agentAt(s, square)?.slot === foe) {
    const theirs = RELAYS.filter((r) => s.owner[r] === foe).length;
    if (RELAYS.includes(square)) prior += theirs >= RELAY_WIN_COUNT - 1 ? 8 : theirs >= RELAY_WIN_COUNT - 2 ? 4.5 : 1.6;
    else prior += 0.8;
  }
  /* a cheap bolt on a relay we hold is worth a round */
  if (plan.action === 'anchor' && square !== null && RELAYS.includes(square) && s.owner[square] === slot && !s.anchored[square]) prior += 2.4;
  if (plan.action === 'snare') {
    /* a trap is worth more where they are likely to walk: relays and the ring */
    const near = square === null ? 0 : neighbours(square).filter((n) => agentAt(s, n)?.slot === foe).length;
    prior += near * 1.5;
    if (s.energy[slot] < 3) prior -= 1.1;      // do not spend the last of the pool
  }
  if (plan.action === 'anchor' && s.anchored[s.agents[slot][plan.agent]]) prior -= 2.2; // already anchored
  if (plan.action === 'feint' && s.energy[slot] < 2) prior -= 0.6;
  if (plan.action === 'hold') prior -= 1.4;
  return prior;
}

/**
 * What will they play? Built from public facts only: their energy, the score
 * line, the two seats' core pressure, and their last few revealed actions.
 */
export function readDistribution(s: VantaState, slot: Slot): Record<Prediction, number> {
  const foe = other(slot);
  const base: Record<Prediction, number> = { move: 0.3, claim: 0.3, anchor: 0.12, feint: 0.16, snare: 0.12 };
  const energy = s.energy[foe];
  if (energy <= 1) { base.anchor = 0.02; base.snare = 0.02; base.claim += 0.1; base.feint += 0.08; }
  if (energy >= 4) { base.anchor += 0.1; base.snare += 0.08; base.claim -= 0.05; }
  if (s.influence[foe] < s.influence[slot] - 3) { base.claim += 0.12; base.anchor += 0.05; base.feint -= 0.04; }
  const myPressure = neighbours(CORES[foe]).filter((n) => s.owner[n] === slot).length;
  if (myPressure >= 2) { base.anchor += 0.14; base.claim += 0.08; base.snare += 0.04; }
  const theirPressure = neighbours(CORES[slot]).filter((n) => s.owner[n] === foe).length;
  if (theirPressure >= 2) { base.claim += 0.14; base.move -= 0.05; }

  /* what they actually played in the last three rounds — public in the report */
  const recent = s.history.slice(0, 3).map((r) => r.results[foe].plan.action);
  for (const action of recent) {
    if (action === 'hold') continue;
    if ((PREDICTIONS as string[]).includes(action)) base[action as Prediction] += 0.16;
  }
  const total = Object.values(base).reduce((n, v) => n + v, 0);
  for (const key of PREDICTIONS) base[key] = Math.max(0.01, base[key] / total);
  return base;
}

export function choosePrediction(s: VantaState, slot: Slot, strength: VantaStrength, roll = Math.random): Prediction {
  const weights = WEIGHTS[strength] ?? WEIGHTS.intermediate;
  const dist = readDistribution(s, slot);
  if (roll() > weights.read) {
    /* a blind guess — this is what separates the levels */
    return PREDICTIONS[Math.floor(roll() * PREDICTIONS.length) % PREDICTIONS.length];
  }
  let best = PREDICTIONS[0];
  let bestScore = -1;
  for (const p of PREDICTIONS) {
    const score = dist[p] * (0.7 + roll() * 0.6);   // never perfectly deterministic
    if (score > bestScore) { best = p; bestScore = score; }
  }
  return best;
}

/**
 * Choose a plan for `slot`.
 *
 * `strength` decides how much of the top of the shortlist is in play and how
 * often the read is informed. The result is always legal by construction —
 * candidates come from the same enumeration the validator uses — and it always
 * carries a prediction.
 */
export function choosePlan(
  s: VantaState,
  slot: Slot,
  strength: VantaStrength = 'intermediate',
  roll = rngFrom(stateSeed(s, slot)),
): VantaPlan {
  if (s.over) return { agent: 0, action: 'hold', to: null, predict: 'move' };
  const weights = WEIGHTS[strength] ?? WEIGHTS.intermediate;
  const candidates = candidatePlans(s, slot).filter((p) => vantaRules.isLegal(s, slot, { ...p, predict: 'move' }));

  const guess = foeGuess(s, slot);
  const ranked = candidates
    .map((plan) => {
      const after = project(s, slot, plan, guess);
      return { plan, score: evaluate(after, slot) + actionPrior(s, slot, plan) };
    })
    .sort((a, b) => b.score - a.score);

  let picked = ranked[0]?.plan ?? { agent: 0, action: 'hold' as VantaAction, to: null, predict: 'move' as Prediction };
  if (weights.shortlist > 1 && ranked.length > 1) {
    const span = Math.min(weights.shortlist, ranked.length);
    const spread = Math.max(0.5, Math.abs(ranked[0].score - ranked[span - 1].score) || 1);
    const noise = roll() * weights.noise * spread;
    /* walk down the list until the noise budget is spent — a soft-max by hand */
    for (let i = 0; i < span; i++) {
      if (noise <= Math.abs(ranked[0].score - ranked[i].score) + 1e-6) { picked = ranked[i].plan; break; }
    }
  }

  return { ...picked, predict: choosePrediction(s, slot, strength, roll) };
}

/** Convenience for the solo screen: the opening advice line. */
export function aiLine(s: VantaState, slot: Slot, strength: VantaStrength): string {
  const objective = objectiveById(s.objective[slot]);
  const weights = WEIGHTS[strength] ?? WEIGHTS.intermediate;
  if (weights.read >= 0.85) return `Holding "${objective.title}". It reads your last move before it commits.`;
  return `Holding "${objective.title}". It plays the position, not the odds.`;
}

export { MAX_ENERGY, hash };
