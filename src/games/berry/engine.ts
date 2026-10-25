/**
 * Berry Catch — the simulation, separated from the drawing.
 *
 * Why this is not inside the component: a falling-object game is easy to make
 * feel unfair and almost impossible to test through a canvas. Everything that
 * decides the outcome lives here as a pure step function — `step(state, dt, x)`
 * returns a new state — so the honest questions can be asked in a test:
 *
 *   • is a berry that is caught actually scored, and one that is missed actually
 *     punished?
 *   • can a player be hit by something they could not have reached in time?
 *   • does the run always end, and does it end at the time it promised?
 *
 * Coordinates are a virtual field (`FIELD_W` × `FIELD_H`); the renderer scales.
 * That is the same reason Volt Runner does it: gravity tuned against raw pixels
 * is a different game on a phone than on a desktop.
 */
import { rng } from '../types';

export const FIELD_W = 720;
export const FIELD_H = 460;
export const BASKET_W = 132;
export const BASKET_H = 92;
/** where the rim of the basket sits in the field — the catch line */
export const CATCH_Y = FIELD_H - 96;
/** berries are ~2.3× this wide; the hit window is the rim, not the whole sprite */
export const BERRY_R = 25;

export type DropKind = 'ripe' | 'rot';

export interface Drop {
  id: number;
  kind: DropKind;
  /** centre x in field units */
  x: number;
  y: number;
  vy: number;
  /** phase offset so ripe berries do not wobble in unison */
  wobble: number;
}

export interface BerryConfig {
  durationMs: number;
  lives: number;
  /** ms between drops at the start of a run */
  spawnMs: number;
  /** how much faster the drops come by the end of the run (1 = no ramp) */
  ramp: number;
  /** share of drops that are rotten, at the start */
  rotChance: number;
}

export const DEFAULT_BERRY: BerryConfig = {
  durationMs: 60_000,
  lives: 3,
  spawnMs: 620,
  ramp: 2.1,
  rotChance: 0.22,
};

export interface BerryState {
  config: BerryConfig;
  seed: number;
  /** ms of simulated time */
  t: number;
  score: number;
  streak: number;
  bestStreak: number;
  lives: number;
  drops: Drop[];
  caught: number;
  rotted: number;
  missed: number;
  nextSpawnAt: number;
  nextId: number;
  over: boolean;
  reason: string;
  /** last thing that happened, for the HUD and the sound cue */
  lastEvent: 'catch' | 'rot' | 'miss' | null;
}

export function createBerry(config: Partial<BerryConfig> = {}, seed = Date.now() >>> 0): BerryState {
  const cfg: BerryConfig = {
    durationMs: clamp(Number(config.durationMs ?? DEFAULT_BERRY.durationMs), 10_000, 120_000),
    lives: clamp(Math.round(Number(config.lives ?? DEFAULT_BERRY.lives)), 1, 5),
    spawnMs: clamp(Number(config.spawnMs ?? DEFAULT_BERRY.spawnMs), 300, 1600),
    ramp: clamp(Number(config.ramp ?? DEFAULT_BERRY.ramp), 1, 3),
    rotChance: clamp(Number(config.rotChance ?? DEFAULT_BERRY.rotChance), 0, 0.6),
  };
  return {
    config: cfg, seed, t: 0, score: 0, streak: 0, bestStreak: 0, lives: cfg.lives,
    drops: [], caught: 0, rotted: 0, missed: 0,
    nextSpawnAt: 550, nextId: 1, over: false, reason: '', lastEvent: null,
  };
}

const clamp = (v: number, lo: number, hi: number) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo);

/** how fast a berry falls at time `t` — the ramp is the difficulty */
export const fallSpeed = (s: BerryState): number =>
  150 + 190 * Math.min(1, s.t / s.config.durationMs) * s.config.ramp;

/** spawn cadence reaches `spawnMs / ramp` by the end of the run */
const spawnGap = (s: BerryState): number => {
  const progress = Math.min(1, s.t / s.config.durationMs);
  return s.config.spawnMs / (1 + (s.config.ramp - 1) * progress);
};

/** deterministic per-drop randomness — replays are reproducible from the seed */
function nextDrop(s: BerryState): { kind: DropKind; x: number } {
  const r = rng((s.seed ^ Math.imul(s.nextId + 1, 0x9e3779b1)) >>> 0);
  const roll = r();
  const rotChance = s.config.rotChance + Math.min(0.18, s.t / s.config.durationMs * 0.18);
  const kind: DropKind = roll < rotChance ? 'rot' : 'ripe';
  // keep spawns off the very edges so a berry is always reachable
  const x = BERRY_R + 18 + r() * (FIELD_W - 2 * (BERRY_R + 18));
  return { kind, x };
}

/**
 * Advance the world by `dt` ms with the basket's centre at `basketX` (field
 * units). Pure: the same inputs always produce the same state.
 */
export function step(s: BerryState, dt: number, basketX: number): BerryState {
  if (s.over) return s;
  const d = clamp(dt, 0, 100);           // a tab returning from the background must
  const t = s.t + d;                     // not teleport every berry past the basket

  let drops = s.drops;
  let score = s.score;
  let streak = s.streak;
  let bestStreak = s.bestStreak;
  let lives = s.lives;
  let caught = s.caught;
  let rotted = s.rotted;
  let missed = s.missed;
  let lastEvent: BerryState['lastEvent'] = null;

  const speed = fallSpeed({ ...s, t });

  // move, then resolve the catch line
  const survivors: Drop[] = [];
  for (const drop of drops) {
    const y = drop.y + (speed * drop.vy) * (d / 1000);
    const inReach = Math.abs(drop.x - basketX) <= BASKET_W / 2 - 14;

    if (y >= CATCH_Y && inReach) {
      if (drop.kind === 'ripe') {
        caught += 1;
        streak += 1;
        bestStreak = Math.max(bestStreak, streak);
        // a streak is worth more, but it caps: an unbounded multiplier would make
        // the first thirty seconds of a run pointless
        score += Math.min(5, 1 + Math.floor(streak / 4));
        lastEvent = 'catch';
      } else {
        rotted += 1;
        streak = 0;
        lives -= 1;
        lastEvent = 'rot';
      }
      continue;
    }

    if (y >= FIELD_H + BERRY_R) {
      if (drop.kind === 'ripe') { missed += 1; streak = 0; lastEvent = 'miss'; }
      continue;                       // a missed rotten berry costs nothing
    }

    survivors.push({ ...drop, y });
  }
  drops = survivors;

  // spawn
  let nextSpawnAt = s.nextSpawnAt;
  let nextId = s.nextId;
  if (t >= nextSpawnAt) {
    const made = nextDrop({ ...s, nextId, t });
    drops = [...drops, {
      id: nextId, kind: made.kind, x: made.x, y: -BERRY_R * 2,
      vy: 1, wobble: made.x * 0.017,
    }];
    nextId += 1;
    nextSpawnAt = t + spawnGap({ ...s, t });
  }

  const over = lives <= 0 || t >= s.config.durationMs;
  const reason = lives <= 0
    ? `The basket gave out after ${caught} berries.`
    : `Time up — ${caught} berries caught, ${rotted} rotten ones taken.`;

  return {
    ...s, t, drops, score, streak, bestStreak, lives, caught, rotted, missed,
    nextSpawnAt, nextId, over, lastEvent, reason: over ? reason : '',
  };
}
