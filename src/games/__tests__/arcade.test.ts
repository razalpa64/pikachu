import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Volt Runner guards.
 *
 * The runner's collision boxes are derived from hard-coded sprite aspect ratios
 * (see OB_SPEC in SoloView.tsx) because the simulation has to size an obstacle
 * at spawn time, before any image has decoded. That is fine right up until
 * someone re-exports a sprite at a new aspect, at which point the drawn pixels
 * and the hitbox silently drift apart and the game starts eating "but I clearly
 * jumped that" complaints. These tests re-read the real files and fail loudly.
 */

const ART = resolve(__dirname, '../../../public/art/run');

/** Minimal PNG/WebP header readers — no image library needed for dimensions. */
function pngSize(buf: Buffer) {
  expect(buf.subarray(1, 4).toString('ascii')).toBe('PNG');
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}
function webpSize(buf: Buffer) {
  expect(buf.subarray(0, 4).toString('ascii')).toBe('RIFF');
  expect(buf.subarray(8, 12).toString('ascii')).toBe('WEBP');
  const fmt = buf.subarray(12, 16).toString('ascii');
  if (fmt === 'VP8X') return { w: (buf.readUIntLE(24, 3) & 0xffffff) + 1, h: (buf.readUIntLE(27, 3) & 0xffffff) + 1 };
  if (fmt === 'VP8L') {
    const b = buf.readUInt32LE(21);
    return { w: (b & 0x3fff) + 1, h: ((b >> 14) & 0x3fff) + 1 };
  }
  // lossy VP8: dimensions live after the 3-byte start code at offset 26
  return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff };
}
const size = (name: string) => {
  const p = resolve(ART, name);
  expect(existsSync(p), `${name} is missing`).toBe(true);
  const buf = readFileSync(p);
  expect(buf.length, `${name} is empty`).toBeGreaterThan(400);
  return name.endsWith('.png') ? pngSize(buf) : webpSize(buf);
};

/* Mirrors OB_SPEC in src/games/arcade/SoloView.tsx. */
const OB_SPEC = {
  tree: { h: 56, aspect: 227 / 220, file: 'tree.webp' },
  wall: { h: 40, aspect: 450 / 200, file: 'wall.webp' },
  'drone-low': { h: 40, aspect: 167 / 160, file: 'drone.webp' },
  'drone-high': { h: 40, aspect: 167 / 160, file: 'drone.webp' },
  charge: { h: 34, aspect: 77 / 106, file: 'charge.webp' },
};

/* Physics constants, mirrored from SoloView.tsx. */
const GRAVITY = 2650, JUMP_V = 860, AIR_TIME = (2 * JUMP_V) / GRAVITY;
const STAND_H = 64, DUCK_H = 38;
const HIT_PLAYER_X = 0.62, HIT_PLAYER_Y = 0.92, HIT_OB = 0.84, STAND_W = 54;

/** How long a jump holds the player's feet above `h`. */
function timeAbove(h: number) {
  const disc = JUMP_V * JUMP_V - 2 * GRAVITY * h;
  if (disc <= 0) return 0;
  return (2 * Math.sqrt(disc)) / GRAVITY;
}

describe('Volt Runner sprites', () => {
  it('every sprite file exists and is a real image', () => {
    for (const f of ['runner.png', 'charge.webp', 'drone.webp', 'tree.webp', 'wall.webp']) {
      const s = size(f);
      expect(s.w, `${f} width`).toBeGreaterThan(8);
      expect(s.h, `${f} height`).toBeGreaterThan(8);
    }
  });

  it('declared hitbox aspects still match the files on disk', () => {
    for (const [kind, spec] of Object.entries(OB_SPEC)) {
      const s = size(spec.file);
      const real = s.w / s.h;
      expect(Math.abs(real - spec.aspect), `${kind}: ${spec.file} is ${s.w}x${s.h} (${real.toFixed(3)}) but OB_SPEC says ${spec.aspect.toFixed(3)}`)
        .toBeLessThan(0.02);
    }
  });

  it('the runner sheet divides cleanly into four frames', () => {
    const s = size('runner.png');
    expect(s.w % 4, 'sheet width must divide by RUNNER_FRAMES').toBe(0);
    const fw = s.w / 4;
    expect(fw / s.h).toBeGreaterThan(0.7);
    expect(fw / s.h).toBeLessThan(2.2);
  });
});

describe('Volt Runner is physically fair', () => {
  it('a jump clears every grounded obstacle with time to spare', () => {
    for (const kind of ['tree', 'wall'] as const) {
      const spec = OB_SPEC[kind];
      const obH = spec.h * HIT_OB;
      const obW = spec.h * spec.aspect * HIT_OB;
      const above = timeAbove(obH);
      expect(above, `${kind} is taller than a jump`).toBeGreaterThan(0);
      // worst case is the slowest pace: the obstacle spends longest beside you
      const slowest = 300;
      const overlap = (obW + STAND_W * HIT_PLAYER_X) / slowest;
      expect(above - overlap, `${kind}: only ${(above - overlap).toFixed(3)}s of timing slack`)
        .toBeGreaterThan(0.12);
    }
  });

  it('the double-tree cluster is still clearable', () => {
    const spec = OB_SPEC.tree;
    const w = spec.h * spec.aspect;
    const span = (w + (w - 6)) * HIT_OB;      // two trees, second offset by w-6
    const above = timeAbove(spec.h * HIT_OB);
    const overlap = (span + STAND_W * HIT_PLAYER_X) / 300;
    expect(above - overlap).toBeGreaterThan(0.05);
  });

  it('a low flyer forces a duck and a duck actually clears it', () => {
    const base = 40;
    expect(STAND_H * HIT_PLAYER_Y, 'standing should collide with a low flyer').toBeGreaterThan(base);
    expect(DUCK_H * HIT_PLAYER_Y, 'ducking should slip under a low flyer').toBeLessThan(base);
  });

  it('a high flyer is safe on the ground but punishes a careless jump', () => {
    const base = 88, top = base + OB_SPEC['drone-high'].h * HIT_OB;
    expect(STAND_H * HIT_PLAYER_Y, 'running under a high flyer must be free').toBeLessThan(base);
    const apex = (JUMP_V * JUMP_V) / (2 * GRAVITY);
    expect(apex, 'a full jump should clear it rather than be unavoidable').toBeGreaterThan(top);
  });

  it('the minimum spawn gap leaves room to land and jump again', () => {
    // mirrors tickWorld: minSec = AIR_TIME + 0.46 - ramp*0.11, ramp maxing at 1
    const tightest = AIR_TIME + 0.46 - 0.11;
    expect(tightest).toBeGreaterThan(AIR_TIME);
    // after landing from obstacle A you must still be able to start B's jump
    const slackAfterLanding = tightest - AIR_TIME;
    expect(slackAfterLanding, 'no time to react between obstacles').toBeGreaterThan(0.25);
  });

  it('a charge sits inside a normal jump arc', () => {
    const apex = (JUMP_V * JUMP_V) / (2 * GRAVITY);
    const lowest = 70, highest = 100;
    expect(lowest).toBeGreaterThan(STAND_H * HIT_PLAYER_Y);      // not grabbable on the ground
    expect(highest).toBeLessThan(apex);                           // but always reachable
  });
});
