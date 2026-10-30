/**
 * Carrom, as a physical object rather than a set of animations.
 *
 * The whole game rests on one function: `simulateShot`. Given where every coin
 * is, where the striker sits, an angle and a power, it returns where everything
 * ended up. That single function is what the referee runs on the server, what
 * the board animates in the browser, and what the AI uses to look ahead — so a
 * shot can never mean one thing to the player who took it and another thing to
 * the person watching.
 *
 * The coordinate space is the board itself: 0–100 on both axes, y downwards,
 * so a board drawn at any size only has to multiply. Units are "one hundredth
 * of the playing surface", which makes the constants below readable: a coin is
 * 3.1 across, the striker 4.1, and a pocket swallows anything 6.2 wide.
 *
 * Nothing here is random. Two identical inputs give two identical outputs, on
 * any machine, which is the property the server depends on.
 */
export const BOARD = 100;
export const COIN_R = 1.55;
export const STRIKER_R = 2.05;
/**
 * The pockets are the *corners*: on a real board the frame is cut away there, so
 * the mouth opens onto both rails and a coin that reaches the corner falls in.
 * Modelling them as little circles floating inside the board looked right and
 * played wrong — a coin pressed into the corner could never be swallowed.
 */
export const POCKETS: { x: number; y: number }[] = [
  { x: 0, y: 0 }, { x: BOARD, y: 0 },
  { x: 0, y: BOARD }, { x: BOARD, y: BOARD },
];
export const POCKET_R = 5.2;
/**
 * How far from a corner the rail is cut away. Without this the wall clamps a
 * coin at 1 coin-radius out and the pocket is a decoration you can never reach:
 * a ball aimed into the corner bounces off the rail and stays on the board. The
 * mouth is what makes the corner a hole.
 */
export const POCKET_MOUTH = 7.2;
/** the two baselines, one per player, and the legal span of the striker on each */
export const BASELINE_Y = [82, 18];
export const BASELINE_X = [20.5, 79.5];

/** physics constants, in board units and seconds */
/* 120 Hz, not 240: at the fastest the striker moves one and a half board units
   per step against a coin three units across, so it cannot pass through one, and
   halving the step count halves the cost of every shot — which matters because
   the AI simulates dozens of them and the referee simulates them on every move. */
const HZ = 120;
const STEP = 1 / HZ;
const MAX_STEPS = HZ * 12;           // a shot that has not settled in 12 s is over
const FRICTION = 0.9838;             // per step: a full-power shot crosses most of the board
const STOP_SPEED = 0.55;
const WALL_RESTITUTION = 0.72;
const COIN_RESTITUTION = 0.94;
const STRIKER_MASS = 1.55;
const MAX_SPEED = 175;

export type CoinKind = 'white' | 'black' | 'queen';
export interface Coin { id: number; kind: CoinKind; x: number; y: number; alive: boolean }
export interface Vec { x: number; y: number }
export interface Shot { x: number; angle: number; power: number }
export interface Frame { coins: { x: number; y: number; alive: boolean }[]; striker: Vec; alive: boolean }

export interface SimResult {
  coins: Coin[];
  striker: Vec;
  /** ids of coins sunk this shot, and whether the striker followed one in */
  pocketed: number[];
  strikerPocketed: boolean;
  /** true if the striker touched any coin at all */
  contact: boolean;
  /** distance travelled by the striker, for "did it actually move" checks */
  travelled: number;
  frames: Frame[];
}

/**
 * The opening position, packed the way a carrom board is packed: the queen on
 * the centre spot, six coins around her, twelve more around those — alternating
 * colours so neither side is ever handed the middle.
 */
export function openingCoins(): Coin[] {
  const coins: Coin[] = [];
  const push = (kind: CoinKind, x: number, y: number) => {
    coins.push({ id: coins.length, kind, x, y, alive: true });
  };
  const d = COIN_R * 2;                    // touching distance
  push('queen', BOARD / 2, BOARD / 2);
  const inner: CoinKind[] = ['white', 'black', 'white', 'black', 'white', 'black'];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i - Math.PI / 2;
    push(inner[i], BOARD / 2 + Math.cos(a) * d, BOARD / 2 + Math.sin(a) * d);
  }
  const outer: CoinKind[] = ['black', 'white', 'black', 'white', 'black', 'white', 'black', 'white', 'black', 'white', 'black', 'white'];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i - Math.PI / 2;
    push(outer[i * 2], BOARD / 2 + Math.cos(a) * d * 2, BOARD / 2 + Math.sin(a) * d * 2);
    const b = a + Math.PI / 6;
    push(outer[i * 2 + 1], BOARD / 2 + Math.cos(b) * d * Math.sqrt(3), BOARD / 2 + Math.sin(b) * d * Math.sqrt(3));
  }
  return coins;
}

/** Does the striker at `x` overlap a live coin? Used to keep placement legal. */
export function strikerBlocked(coins: Coin[], player: 0 | 1, x: number): boolean {
  const y = BASELINE_Y[player];
  return coins.some((c) => c.alive && Math.hypot(c.x - x, c.y - y) < COIN_R + STRIKER_R + 0.05);
}

/** Slide the striker along the baseline to the nearest legal spot to `x`. */
export function legalStrikerX(coins: Coin[], player: 0 | 1, x: number): number {
  const clamped = Math.min(BASELINE_X[1], Math.max(BASELINE_X[0], x));
  if (!strikerBlocked(coins, player, clamped)) return clamped;
  for (let step = 0.5; step <= 32; step += 0.5) {
    for (const dir of [-1, 1]) {
      const t = clamped + dir * step;
      if (t >= BASELINE_X[0] && t <= BASELINE_X[1] && !strikerBlocked(coins, player, t)) return t;
    }
  }
  return clamped;
}

interface Body { id: number; x: number; y: number; vx: number; vy: number; mass: number; alive: boolean; coin: number }

function stepBodies(bodies: Body[], collect: boolean): {
  pocketed: number[]; strikerPocketed: boolean; contact: boolean; travelled: number; frames: Frame[];
} {
  const frames: Frame[] = [];
  const pocketed: number[] = [];
  let strikerPocketed = false;
  let contact = false;
  let travelled = 0;
  const striker = bodies[bodies.length - 1];

  for (let step = 0; step < MAX_STEPS; step++) {
    let moving = false;
    for (const b of bodies) {
      if (!b.alive) continue;
      if (b.vx || b.vy) moving = true;
      b.x += b.vx * STEP;
      b.y += b.vy * STEP;
      b.vx *= FRICTION; b.vy *= FRICTION;
      if (b.vx * b.vx + b.vy * b.vy < STOP_SPEED * STOP_SPEED) { b.vx = 0; b.vy = 0; }
      if (b === striker) travelled += Math.hypot(b.vx, b.vy) * STEP;
    }
    if (!moving) break;

    // pockets first: a coin whose centre is inside a pocket mouth is gone, and a
    // ball that has gone is not there to bounce off anything afterwards
    for (const b of bodies) {
      if (!b.alive) continue;
      whenMoving: for (const p of POCKETS) {
        /* Leaving the playing surface is itself proof of a pocket: the rail is
           solid everywhere except the four mouths, so the only way out is down a
           hole. Without this a fast ball can cross the corner between two steps
           and be clamped back onto the board, which looks like a cheat. */
        const escaped = b.x < 0 || b.y < 0 || b.x > BOARD || b.y > BOARD;
        if (escaped || Math.hypot(b.x - p.x, b.y - p.y) < POCKET_R) {
          b.alive = false; b.vx = 0; b.vy = 0;
          if (b === striker) strikerPocketed = true; else pocketed.push(b.coin);
          break whenMoving;
        }
      }
    }

    // walls, with the four mouths left open
    const inMouth = (v: number) => v < POCKET_MOUTH || v > BOARD - POCKET_MOUTH;
    for (const b of bodies) {
      if (!b.alive) continue;
      const r = b === striker ? STRIKER_R : COIN_R;
      if (b.x < r && !inMouth(b.y)) { b.x = r; b.vx = Math.abs(b.vx) * WALL_RESTITUTION; }
      if (b.x > BOARD - r && !inMouth(b.y)) { b.x = BOARD - r; b.vx = -Math.abs(b.vx) * WALL_RESTITUTION; }
      if (b.y < r && !inMouth(b.x)) { b.y = r; b.vy = Math.abs(b.vy) * WALL_RESTITUTION; }
      if (b.y > BOARD - r && !inMouth(b.x)) { b.y = BOARD - r; b.vy = -Math.abs(b.vy) * WALL_RESTITUTION; }
    }

    // collisions, twice per step so a packed triangle resolves instead of jittering
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < bodies.length; i++) {
        const a = bodies[i];
        if (!a.alive) continue;
        for (let j = i + 1; j < bodies.length; j++) {
          const b = bodies[j];
          if (!b.alive) continue;
          /* nothing can happen between two bodies that are both asleep: they
             were separated on the step they stopped */
          if (!(a.vx || a.vy || b.vx || b.vy)) continue;
          const ra = a === striker ? STRIKER_R : COIN_R;
          const rb = b === striker ? STRIKER_R : COIN_R;
          const dx = b.x - a.x, dy = b.y - a.y;
          const min = ra + rb;
          const dist2 = dx * dx + dy * dy;
          if (dist2 === 0 || dist2 >= min * min) continue;
          const dist = Math.sqrt(dist2);
          if (a === striker || b === striker) contact = true;
          const nx = dx / dist, ny = dy / dist;
          // separate
          const overlap = min - dist;
          const invA = 1 / a.mass, invB = 1 / b.mass, invSum = invA + invB;
          a.x -= nx * overlap * (invA / invSum); a.y -= ny * overlap * (invA / invSum);
          b.x += nx * overlap * (invB / invSum); b.y += ny * overlap * (invB / invSum);
          // exchange normal velocities
          const rvx = b.vx - a.vx, rvy = b.vy - a.vy;
          const sep = rvx * nx + rvy * ny;
          if (sep > 0) continue;
          const impulse = (-(1 + COIN_RESTITUTION) * sep) / invSum;
          a.vx -= impulse * invA * nx; a.vy -= impulse * invA * ny;
          b.vx += impulse * invB * nx; b.vy += impulse * invB * ny;
        }
      }
    }

    if (collect && step % 2 === 0) {
      frames.push({
        coins: bodies.slice(0, -1).map((b) => ({ x: b.x, y: b.y, alive: b.alive })),
        striker: { x: striker.x, y: striker.y },
        alive: striker.alive,
      });
    }
  }

  return { pocketed, strikerPocketed, contact, travelled, frames };
}

function toBodies(coins: Coin[], striker: Vec, shot: Shot): Body[] {
  const bodies: Body[] = coins.map((c) => ({
    id: c.id, x: c.x, y: c.y, vx: 0, vy: 0, mass: 1, alive: c.alive, coin: c.id,
  }));
  const power = Math.min(1, Math.max(0, shot.power));
  const speed = 22 + power * (MAX_SPEED - 22);
  bodies.push({
    id: -1, x: striker.x, y: striker.y,
    vx: Math.cos(shot.angle) * speed, vy: Math.sin(shot.angle) * speed,
    mass: STRIKER_MASS, alive: true, coin: -1,
  });
  return bodies;
}

/** Run a shot to rest. `collect` is off by default: the server does not want 700 frames. */
export function simulateShot(coins: Coin[], striker: Vec, shot: Shot, collect = false): SimResult {
  const bodies = toBodies(coins, striker, shot);
  const out = stepBodies(bodies, collect);
  const result: Coin[] = bodies.slice(0, -1).map((b, i) => ({ ...coins[i], x: b.x, y: b.y, alive: b.alive }));
  return {
    coins: result,
    striker: { x: bodies[bodies.length - 1].x, y: bodies[bodies.length - 1].y },
    pocketed: out.pocketed,
    strikerPocketed: out.strikerPocketed,
    contact: out.contact,
    travelled: out.travelled,
    frames: out.frames,
  };
}

/** Every coin at rest where it started — used to detect a shot that changed nothing. */
export function nothingMoved(before: Coin[], after: Coin[]): boolean {
  return before.every((c, i) => Math.abs(c.x - after[i].x) < 0.01 && Math.abs(c.y - after[i].y) < 0.01 && c.alive === after[i].alive);
}
