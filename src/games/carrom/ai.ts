/**
 * The opponent.
 *
 * Carrom has no move list to search, so the AI does what a person does at the
 * table: line up some shots in its head, watch each one play out, and pick the
 * one that leaves it happiest. `simulateShot` is the same function the referee
 * uses, so the AI cannot imagine a shot the game will not honour.
 *
 * Difficulty is expressed two ways, because either one alone is a cheat:
 *   • how many shots it bothers to imagine (a beginner looks at a handful);
 *   • how badly it aims (a beginner's angle is off by a few degrees).
 * Neither ever breaks a rule — a weak opponent is a careless one, not an
 * opponent that plays illegal carrom.
 */
import { BASELINE_X, BASELINE_Y, COIN_R, POCKETS, STRIKER_R, legalStrikerX, simulateShot } from './physics';
import type { Coin } from './physics';
import { colourOf, type CarromState } from './rules';
import { rng, type Difficulty, type Slot } from '../types';

export interface Candidate { x: number; angle: number; power: number; score: number }

/** How a shot scores. Big rewards for your own coins, real penalties for gifts. */
export function scoreShot(state: CarromState, player: Slot, coins: Coin[], contact: boolean, pocketed: string[], strikerIn: boolean): number {
  const mine = colourOf(player);
  const theirs = colourOf((player === 0 ? 1 : 0) as Slot);
  let score = 0;
  for (const kind of pocketed) {
    if (kind === mine) score += 12;
    else if (kind === theirs) score -= 9;   // you gave them a point
    else if (kind === 'queen') score += state.queenPending === player || state.queen === 'board' ? 14 : 0;
  }
  if (strikerIn) score -= 15;               // a coin comes back out
  if (!contact) score -= 13;
  if (pocketed.some((k) => k === mine)) score += 4; // keeping the turn is worth something
  // position: coins that end up near a pocket are coins that will go in
  for (const c of coins) {
    if (!c.alive || c.kind !== mine) continue;
    const near = Math.min(...POCKETS.map((p) => Math.hypot(c.x - p.x, c.y - p.y)));
    if (near < 14) score += (14 - near) * 0.18;
  }
  return score;
}

/**
 * A spread of plausible shots.
 *
 * Two kinds, because carrom needs both: shots aimed straight at a coin (which
 * break the pack and defend), and *cut* shots aimed at the ghost position — the
 * empty spot behind the coin on the line from the coin to a pocket. Without the
 * second kind an AI can pot all evening and never actually sink anything, which
 * is exactly what the first version of this did.
 */
function candidates(state: CarromState, player: Slot): { x: number; angle: number; power: number }[] {
  const strikerY = BASELINE_Y[player];
  const targets = state.coins.filter((c) => c.alive && (c.kind === colourOf(player) || c.kind === 'queen'));
  const xs = [0.2, 0.5, 0.8].map((f) => legalStrikerX(state.coins, player, BASELINE_X[0] + (BASELINE_X[1] - BASELINE_X[0]) * f));
  const out: { x: number; angle: number; power: number }[] = [];
  const reach = 82; // board units a full-power shot covers
  for (const x of new Set(xs)) {
    for (const t of targets) {
      const direct = Math.atan2(t.y - strikerY, t.x - x);
      const dist = Math.hypot(t.x - x, t.y - strikerY);
      for (const spread of [0, -0.04, 0.04]) {
        out.push({ x, angle: direct + spread, power: Math.min(1, Math.max(0.45, (dist + 12) / reach)) });
      }
      // ghost-ball cuts: hit the coin on the line it needs to travel to a pocket
      for (const p of POCKETS) {
        const dx = p.x - t.x, dy = p.y - t.y;
        const toPocket = Math.hypot(dx, dy);
        if (toPocket < 1) continue;
        const gx = t.x - (dx / toPocket) * (COIN_R + STRIKER_R);
        const gy = t.y - (dy / toPocket) * (COIN_R + STRIKER_R);
        const angle = Math.atan2(gy - strikerY, gx - x);
        const path = Math.hypot(gx - x, gy - strikerY) + toPocket * 0.9;
        for (const spread of [0, -0.02, 0.02]) {
          out.push({ x, angle: angle + spread, power: Math.min(1, Math.max(0.5, path / reach)) });
        }
      }
    }
  }
  return out;
}

const EFFORT: Record<Difficulty, number> = {
  beginner: 10, casual: 16, intermediate: 26, advanced: 36, expert: 52,
};
const WOBBLE: Record<Difficulty, number> = {
  beginner: 0.05, casual: 0.032, intermediate: 0.018, advanced: 0.008, expert: 0,
};

/**
 * Pick a shot. Deterministic for a given state and seed, so a replay of the same
 * match makes the same choices — but the wobble keeps two games from looking
 * identical.
 */
export function chooseShot(state: CarromState, player: Slot, difficulty: Difficulty = 'intermediate'): { x: number; angle: number; power: number } {
  const random = rng((state.shots + 1) * 2654435761 + (player + 1) * 97);
  const pool = candidates(state, player);
  if (!pool.length) return { x: 50, angle: player === 0 ? -Math.PI / 2 : Math.PI / 2, power: 0.7 };

  // sample the pool evenly rather than always the first N, so the AI does not
  // systematically ignore the right-hand side of the board
  const want = Math.min(pool.length, EFFORT[difficulty]);
  const step = pool.length / want;
  const sampled: Candidate[] = [];
  for (let i = 0; i < want; i++) {
    const shot = pool[Math.min(pool.length - 1, Math.round(i * step))];
    const sim = simulateShot(state.coins, { x: shot.x, y: BASELINE_Y[player] }, shot);
    const kinds = sim.pocketed.map((id) => state.coins[id]?.kind ?? '');
    sampled.push({
      ...shot,
      score: scoreShot(state, player, sim.coins, sim.contact, kinds, sim.strikerPocketed),
    });
  }
  sampled.sort((a, b) => b.score - a.score);

  const top = difficulty === 'beginner' ? 6 : difficulty === 'casual' ? 3 : difficulty === 'intermediate' ? 2 : 1;
  const pick = sampled[Math.min(sampled.length - 1, Math.floor(random() * top))];
  const wobble = (random() * 2 - 1) * WOBBLE[difficulty];
  return {
    x: legalStrikerX(state.coins, player, pick.x),
    angle: pick.angle + wobble,
    power: Math.min(1, Math.max(0.08, pick.power)),
  };
}

/** Used by the hint button: what the expert would do, without the wobble. */
export const bestShot = (state: CarromState, player: Slot) => chooseShot(state, player, 'expert');
