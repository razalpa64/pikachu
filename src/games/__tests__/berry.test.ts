/**
 * Berry Catch — the rules, out of the canvas.
 *
 * A falling-object game gets its fairness from three numbers (fall speed, spawn
 * cadence, catch window) and it is impossible to feel whether they are honest
 * while playing. Here they are asserted:
 *
 *   • a berry is only caught inside the rim, and only scores once;
 *   • the run always ends, at the time it promised, and never before;
 *   • nothing spawns outside the reachable field;
 *   • the simulation is pure — the same seed and the same inputs replay exactly.
 */
import { describe, expect, it } from 'vitest';
import {
  BASKET_W, BERRY_R, CATCH_Y, DEFAULT_BERRY, FIELD_W, createBerry, fallSpeed, step, type BerryState,
} from '../berry/engine';

const cfg = { ...DEFAULT_BERRY, durationMs: 12_000, lives: 3, spawnMs: 500, ramp: 2, rotChance: 0 };
const start = (over: Partial<typeof cfg> = {}, seed = 42) => createBerry({ ...cfg, ...over }, seed);

/** run the sim at a fixed 16 ms step with the basket parked somewhere */
function run(s: BerryState, ms: number, basketX = FIELD_W / 2, hz = 60) {
  let state = s;
  const dt = 1000 / hz;
  for (let t = 0; t < ms && !state.over; t += dt) state = step(state, dt, basketX);
  return state;
}

/** place a single berry right above the rim, so the next step lands it */
function withDrop(s: BerryState, kind: 'ripe' | 'rot', x: number, y = CATCH_Y - 1): BerryState {
  return { ...s, drops: [{ id: 99, kind, x, y, vy: 1, wobble: 0 }], nextSpawnAt: 1e9 };
}

describe('berry catch simulation', () => {
  it('opens with a full basket, no score and a clock that has not started', () => {
    const s = start();
    expect(s.lives).toBe(3);
    expect(s.score).toBe(0);
    expect(s.t).toBe(0);
    expect(s.over).toBe(false);
    expect(s.drops).toHaveLength(0);
  });

  it('catches a ripe berry inside the rim, scores it, and counts the streak', () => {
    let s = withDrop(start(), 'ripe', FIELD_W / 2);
    s = step(s, 16, FIELD_W / 2);
    expect(s.caught).toBe(1);
    expect(s.score).toBe(1);
    expect(s.streak).toBe(1);
    expect(s.drops, 'the caught berry is gone').toHaveLength(0);
    expect(s.lastEvent).toBe('catch');
  });

  it('does not catch one that is out of reach — and a dropped ripe berry resets the streak', () => {
    let s = withDrop(start(), 'ripe', 40);
    s = run(s, 4000, FIELD_W / 2);
    expect(s.caught).toBe(0);
    expect(s.missed).toBe(1);
    expect(s.streak).toBe(0);
    expect(s.lives, 'missing a ripe berry is a miss, not a life').toBe(3);
  });

  it('costs a life for a rotten berry taken in the basket, and nothing for one dropped', () => {
    let s = withDrop(start(), 'rot', FIELD_W / 2);
    s = step(s, 16, FIELD_W / 2);
    expect(s.lives).toBe(2);
    expect(s.rotted).toBe(1);
    expect(s.score).toBe(0);

    let d = withDrop(start(), 'rot', 30);
    d = run(d, 4000, FIELD_W / 2);
    expect(d.lives).toBe(3);
    expect(d.rotted).toBe(0);
  });

  it('ends when the basket is empty, and says why', () => {
    let s = withDrop(start({ lives: 1 }), 'rot', FIELD_W / 2);
    s = step(s, 16, FIELD_W / 2);
    expect(s.over).toBe(true);
    expect(s.reason).toMatch(/basket gave out/i);
    expect(step(s, 16, 0)).toBe(s);
  });

  it('always ends when the clock runs out, whatever the basket', () => {
    const s = run(start({ durationMs: 12_000 }), 15_000, 0);
    expect(s.over).toBe(true);
    expect(s.t).toBeGreaterThanOrEqual(12_000);
    expect(s.reason).toMatch(/time up/i);
  });

  it('spawns only inside the field', () => {
    let s = start({ lives: 5, durationMs: 20_000 });
    for (let i = 0; i < 600 && !s.over; i++) {
      s = step(s, 16, 0);
      for (const d of s.drops) {
        expect(d.x).toBeGreaterThanOrEqual(BERRY_R);
        expect(d.x).toBeLessThanOrEqual(FIELD_W - BERRY_R);
        expect(d.kind === 'ripe' || d.kind === 'rot').toBe(true);
      }
    }
    expect(s.caught + s.missed + s.rotted).toBeGreaterThan(0);
  });

  it('gives more as the run goes on, never less', () => {
    const early = fallSpeed({ ...start(), t: 0 });
    const late = fallSpeed({ ...start(), t: cfg.durationMs });
    expect(late).toBeGreaterThan(early);
  });

  it('replays exactly from the same seed and the same inputs', () => {
    const a = run(start({}, 7), 5000, 300);
    const b = run(start({}, 7), 5000, 300);
    expect(a).toEqual(b);
    const c = run(start({}, 8), 5000, 300);
    expect(c.drops.map((d) => Math.round(d.x))).not.toEqual(a.drops.map((d) => Math.round(d.x)));
  });

  it('is not fooled by a huge dt (a tab coming back from the background)', () => {
    const s = step(start(), 30_000, FIELD_W / 2);
    expect(s.t).toBeLessThanOrEqual(100);
  });

  it('the catch window is the rim, not the whole screen', () => {
    const half = BASKET_W / 2 - 14;
    const inside = withDrop(start(), 'ripe', FIELD_W / 2 + half - 1);
    const outside = withDrop(start(), 'ripe', FIELD_W / 2 + half + 4);
    expect(step(inside, 16, FIELD_W / 2).caught).toBe(1);
    expect(step(outside, 16, FIELD_W / 2).caught).toBe(0);
  });
});
