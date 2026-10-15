/**
 * Snake Arena — pure grid engine.
 *
 * No React, no timers inside: the view owns the clock and calls `step()`.
 * That keeps it testable and lets the loop be paused/throttled when the tab is hidden.
 */
import { rng } from '../types';
import type { Difficulty } from '../types';

export type Dir = 'up' | 'down' | 'left' | 'right';
export const DIRS: Record<Dir, { x: number; y: number }> = {
  up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 },
};
export const OPPOSITE: Record<Dir, Dir> = { up: 'down', down: 'up', left: 'right', right: 'left' };

export interface Pickup { i: number; kind: 'charge' | 'bolt' | 'berry' }
export interface Serpent {
  body: number[];          // head first
  dir: Dir;
  queued: Dir[];           // input buffer, max 2 — prevents dropped turns on fast ticks
  alive: boolean;
  score: number;
  grow: number;
  boostUntil: number;      // tick index while the bolt speed boost lasts
}

export interface SnakeState {
  cols: number; rows: number;
  snakes: Serpent[];
  pickups: Pickup[];
  walls: number[];
  tick: number;
  over: boolean;
  winner: number | null;   // index into snakes, null = draw / solo run
  reason: string;
  seed: number;
}

export interface SnakeConfig {
  cols?: number; rows?: number;
  players?: 1 | 2;
  withAi?: boolean;
  maze?: boolean;
  wrap?: boolean;
}

const idx = (x: number, y: number, cols: number) => y * cols + x;
export const xy = (i: number, cols: number) => ({ x: i % cols, y: Math.floor(i / cols) });

export function createSnake(cfg: SnakeConfig, seed: number): SnakeState {
  const cols = cfg.cols ?? 23, rows = cfg.rows ?? 17;
  const r = rng(seed);
  const walls: number[] = [];
  if (cfg.maze) {
    // symmetric pillar maze — always leaves the border ring and the spawn lanes clear
    for (let y = 3; y < rows - 3; y += 3) {
      for (let x = 4; x < cols - 4; x += 4) {
        if (r() < 0.65) { walls.push(idx(x, y, cols)); walls.push(idx(cols - 1 - x, rows - 1 - y, cols)); }
      }
    }
  }
  const count = (cfg.players ?? 1) + (cfg.withAi ? 1 : 0);
  const midY = Math.floor(rows / 2);
  const snakes: Serpent[] = [];
  for (let s = 0; s < count; s++) {
    const y = count === 1 ? midY : s === 0 ? midY - 3 : midY + 3;
    const x = count === 1 ? Math.floor(cols / 2) : s === 0 ? 4 : cols - 5;
    const dir: Dir = count === 1 || s === 0 ? 'right' : 'left';
    const d = DIRS[dir];
    snakes.push({
      body: [idx(x, y, cols), idx(x - d.x, y - d.y, cols), idx(x - d.x * 2, y - d.y * 2, cols)],
      dir, queued: [], alive: true, score: 0, grow: 0, boostUntil: -1,
    });
  }
  const st: SnakeState = {
    cols, rows, snakes, walls, pickups: [], tick: 0, over: false, winner: null, reason: '', seed,
  };
  spawnPickup(st, seed);
  spawnPickup(st, seed ^ 0x9e3779b9);
  return st;
}

function occupied(s: SnakeState) {
  const set = new Set<number>(s.walls);
  for (const sn of s.snakes) for (const b of sn.body) set.add(b);
  for (const p of s.pickups) set.add(p.i);
  return set;
}

export function spawnPickup(s: SnakeState, seed: number) {
  const taken = occupied(s);
  const free: number[] = [];
  for (let i = 0; i < s.cols * s.rows; i++) if (!taken.has(i)) free.push(i);
  if (!free.length) return;
  const r = rng((seed ^ (s.tick * 2654435761)) >>> 0);
  const i = free[Math.floor(r() * free.length)];
  const roll = r();
  s.pickups.push({ i, kind: roll < 0.1 ? 'bolt' : roll < 0.22 ? 'berry' : 'charge' });
}

export const PICKUP_VALUE = { charge: 10, bolt: 25, berry: 40 } as const;
export const PICKUP_GROW = { charge: 1, bolt: 1, berry: 3 } as const;

export function queueDir(s: SnakeState, snakeIdx: number, dir: Dir): SnakeState {
  const sn = s.snakes[snakeIdx];
  if (!sn || !sn.alive) return s;
  const last = sn.queued.length ? sn.queued[sn.queued.length - 1] : sn.dir;
  if (dir === last || dir === OPPOSITE[last]) return s;
  if (sn.queued.length >= 2) return s;
  const snakes = s.snakes.slice();
  snakes[snakeIdx] = { ...sn, queued: [...sn.queued, dir] };
  return { ...s, snakes };
}

/** One world tick. Pure: returns a new state. */
export function step(s: SnakeState, wrap = false): SnakeState {
  if (s.over) return s;
  const cols = s.cols, rows = s.rows;
  const snakes = s.snakes.map((sn) => ({ ...sn, body: sn.body.slice(), queued: sn.queued.slice() }));
  const pickups = s.pickups.slice();
  const tick = s.tick + 1;

  const heads: (number | null)[] = snakes.map((sn) => {
    if (!sn.alive) return null;
    if (sn.queued.length) sn.dir = sn.queued.shift()!;
    const { x, y } = xy(sn.body[0], cols);
    const d = DIRS[sn.dir];
    let nx = x + d.x, ny = y + d.y;
    if (wrap) { nx = (nx + cols) % cols; ny = (ny + rows) % rows; }
    if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) return -1;    // wall death
    return idx(nx, ny, cols);
  });

  // bodies that will still exist after the move (tails free up unless growing)
  const bodySet = new Set<number>(s.walls);
  snakes.forEach((sn) => {
    if (!sn.alive) return;
    const keep = sn.grow > 0 ? sn.body : sn.body.slice(0, -1);
    keep.forEach((b) => bodySet.add(b));
  });

  snakes.forEach((sn, i) => {
    if (!sn.alive) return;
    const h = heads[i];
    if (h === -1) { sn.alive = false; return; }
    if (h === null) return;
    if (bodySet.has(h)) { sn.alive = false; return; }
    const headOn = heads.findIndex((o, j) => j !== i && o === h);
    if (headOn >= 0) { sn.alive = false; snakes[headOn].alive = false; return; }
  });

  snakes.forEach((sn, i) => {
    if (!sn.alive) return;
    const h = heads[i]!;
    sn.body.unshift(h);
    const pIdx = pickups.findIndex((p) => p.i === h);
    if (pIdx >= 0) {
      const p = pickups[pIdx];
      pickups.splice(pIdx, 1);
      sn.score += PICKUP_VALUE[p.kind];
      sn.grow += PICKUP_GROW[p.kind];
      if (p.kind === 'bolt') sn.boostUntil = tick + 34;
    }
    if (sn.grow > 0) sn.grow -= 1; else sn.body.pop();
  });

  const next: SnakeState = { ...s, snakes, pickups, tick };
  while (next.pickups.length < 2) spawnPickup(next, s.seed + tick);

  const alive = snakes.filter((sn) => sn.alive);
  if (alive.length === 0) {
    next.over = true; next.winner = null;
    next.reason = snakes.length > 1 ? 'Both serpents crashed' : 'You crashed';
  } else if (snakes.length > 1 && alive.length === 1) {
    next.over = true;
    next.winner = snakes.indexOf(alive[0]);
    next.reason = 'Last serpent standing';
  }
  return next;
}

/* ---------- AI serpent: BFS to the best pickup with a survivability guard ---------- */

const AI_PROFILE: Record<Difficulty, { lookahead: number; mistake: number; safety: number }> = {
  beginner: { lookahead: 0, mistake: 0.3, safety: 0 },
  casual: { lookahead: 1, mistake: 0.17, safety: 6 },
  intermediate: { lookahead: 1, mistake: 0.08, safety: 14 },
  advanced: { lookahead: 2, mistake: 0.03, safety: 26 },
  expert: { lookahead: 2, mistake: 0, safety: 40 },
};

function blockedSet(s: SnakeState, selfIdx: number) {
  const set = new Set<number>(s.walls);
  s.snakes.forEach((sn, i) => {
    if (!sn.alive) return;
    const body = i === selfIdx ? sn.body.slice(0, -1) : sn.body;
    body.forEach((b) => set.add(b));
    if (i !== selfIdx) {                       // treat the rival's next squares as hot
      const { x, y } = xy(sn.body[0], s.cols);
      const d = DIRS[sn.dir];
      const nx = x + d.x, ny = y + d.y;
      if (nx >= 0 && ny >= 0 && nx < s.cols && ny < s.rows) set.add(idx(nx, ny, s.cols));
    }
  });
  return set;
}

function neighbours(i: number, s: SnakeState): { i: number; dir: Dir }[] {
  const { x, y } = xy(i, s.cols);
  const out: { i: number; dir: Dir }[] = [];
  (Object.keys(DIRS) as Dir[]).forEach((dir) => {
    const d = DIRS[dir];
    const nx = x + d.x, ny = y + d.y;
    if (nx < 0 || ny < 0 || nx >= s.cols || ny >= s.rows) return;
    out.push({ i: idx(nx, ny, s.cols), dir });
  });
  return out;
}

function bfsPath(s: SnakeState, from: number, targets: Set<number>, blocked: Set<number>): Dir | null {
  const prev = new Map<number, { i: number; dir: Dir }>();
  const q = [from];
  const seen = new Set<number>([from]);
  let found: number | null = null;
  while (q.length) {
    const cur = q.shift()!;
    if (targets.has(cur) && cur !== from) { found = cur; break; }
    for (const n of neighbours(cur, s)) {
      if (seen.has(n.i) || blocked.has(n.i)) continue;
      seen.add(n.i); prev.set(n.i, { i: cur, dir: n.dir }); q.push(n.i);
    }
  }
  if (found === null) return null;
  let cur = found;
  let dir: Dir | null = null;
  while (prev.has(cur)) { const p = prev.get(cur)!; dir = p.dir; cur = p.i; if (cur === from) break; }
  return dir;
}

function floodSize(s: SnakeState, from: number, blocked: Set<number>, cap: number) {
  const q = [from]; const seen = new Set<number>([from]); let n = 0;
  while (q.length && n < cap) {
    const cur = q.shift()!; n++;
    for (const nb of neighbours(cur, s)) {
      if (seen.has(nb.i) || blocked.has(nb.i)) continue;
      seen.add(nb.i); q.push(nb.i);
    }
  }
  return n;
}

export function aiDir(s: SnakeState, selfIdx: number, difficulty: Difficulty): Dir {
  const self = s.snakes[selfIdx];
  const p = AI_PROFILE[difficulty] ?? AI_PROFILE.intermediate;
  const blocked = blockedSet(s, selfIdx);
  const head = self.body[0];

  const safe = neighbours(head, s).filter((n) => !blocked.has(n.i) && n.dir !== OPPOSITE[self.dir]);
  if (!safe.length) return self.dir;

  if (Math.random() < p.mistake) return safe[Math.floor(Math.random() * safe.length)].dir;

  const targets = new Set(s.pickups.map((x) => x.i));
  const want = bfsPath(s, head, targets, blocked);

  if (p.safety === 0) return want ?? safe[0].dir;

  // reject a greedy move that walks the serpent into a pocket it cannot escape
  const scored = safe.map((n) => {
    const b2 = new Set(blocked); b2.add(n.i);
    const room = floodSize(s, n.i, b2, p.safety + self.body.length);
    const greedy = n.dir === want ? 1 : 0;
    return { dir: n.dir, score: room * 2 + greedy * p.safety };
  }).sort((a, b) => b.score - a.score);

  return scored[0].dir;
}
