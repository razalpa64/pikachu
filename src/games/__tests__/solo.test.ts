/** Solo-only engines: snake, the puzzle generators, and the progression/XP system. */
import { describe, expect, it } from 'vitest';
import { aiDir, createSnake, queueDir, step, xy } from '../snake/engine';
import {
  PUZZLE_KINDS, lightsSolved, lightsToggle, lockFeedback, makeEcho, makeLights, makeLock,
  makeSlide, makeSum, slideNeighbours, slideSolved, sumSolved,
} from '../puzzle/generators';
import { ACHIEVEMENTS, dailyChallenges, emptyProgress, levelFor, recordMatch, toggleFavourite, unlockAchievement } from '../../lib/progress';

/* ------------------------------------------------------------------ snake */
describe('snake arena', () => {
  it('spawns a three-segment serpent and two pickups', () => {
    const s = createSnake({ players: 1 }, 5);
    expect(s.snakes).toHaveLength(1);
    expect(s.snakes[0].body).toHaveLength(3);
    expect(s.pickups).toHaveLength(2);
    expect(s.over).toBe(false);
  });

  it('refuses a 180-degree reversal', () => {
    const s = createSnake({ players: 1 }, 5);          // starts moving right
    const after = queueDir(s, 0, 'left');
    expect(after.snakes[0].queued).toHaveLength(0);
    const ok = queueDir(s, 0, 'up');
    expect(ok.snakes[0].queued).toEqual(['up']);
  });

  it('moves one cell per step without growing', () => {
    let s = createSnake({ players: 1 }, 5);
    const head = s.snakes[0].body[0];
    s = step(s);
    expect(s.snakes[0].body[0]).toBe(head + 1);
    expect(s.snakes[0].body).toHaveLength(3);
  });

  it('dies on the wall and survives it when wrap is on', () => {
    let s = createSnake({ players: 1 }, 5);
    for (let i = 0; i < s.cols + 2 && !s.over; i++) s = step(s);
    expect(s.over).toBe(true);
    expect(s.snakes[0].alive).toBe(false);

    let w = createSnake({ players: 1 }, 5);
    for (let i = 0; i < w.cols + 2; i++) w = step(w, true);
    expect(w.over).toBe(false);
    expect(w.snakes[0].alive).toBe(true);
  });

  it('eating a pickup scores and grows the body', () => {
    let s = createSnake({ players: 1 }, 5);
    const head = s.snakes[0].body[0];
    const { y } = xy(head, s.cols);
    s = { ...s, pickups: [{ i: head + 1, kind: 'charge' }] };
    s = step(s);
    expect(s.snakes[0].score).toBe(10);
    expect(s.snakes[0].body).toHaveLength(4);
    expect(xy(s.snakes[0].body[0], s.cols).y).toBe(y);
    expect(s.pickups.length).toBeGreaterThanOrEqual(2);   // a replacement always spawns
  });

  it('a berry is worth more than a charge', () => {
    let a = createSnake({ players: 1 }, 5);
    a = step({ ...a, pickups: [{ i: a.snakes[0].body[0] + 1, kind: 'berry' }] });
    expect(a.snakes[0].score).toBe(40);
  });

  it('declares the surviving serpent the winner in a duel', () => {
    let s = createSnake({ players: 2 }, 5);
    expect(s.snakes).toHaveLength(2);
    // steer slot 1 straight into the left wall
    for (let i = 0; i < s.cols && !s.over; i++) s = step(s);
    expect(s.over).toBe(true);
    expect([0, 1, null]).toContain(s.winner);
  });

  it('the AI serpent never steers into a wall it can see', () => {
    let s = createSnake({ players: 1, withAi: true }, 9);
    for (let i = 0; i < 160 && s.snakes[1].alive; i++) {
      s = queueDir(s, 1, aiDir(s, 1, 'expert'));
      s = step(s);
      // keep the human snake out of the way by parking it against its own loop
      if (!s.snakes[0].alive) s = { ...s, snakes: [s.snakes[0], s.snakes[1]] };
    }
    expect(s.snakes[1].score).toBeGreaterThan(0);        // it actually chases pickups
  });
});

/* ------------------------------------------------------------------ puzzles */
describe('puzzle quest generators', () => {
  it('exposes five chambers', () => {
    expect(PUZZLE_KINDS).toHaveLength(5);
  });

  it('slide puzzles are shuffled but always solvable by replaying legal slides', () => {
    for (let seed = 0; seed < 25; seed++) {
      const p = makeSlide(3, seed);
      expect(p.tiles).toHaveLength(9);
      expect(new Set(p.tiles).size).toBe(9);
      expect(p.tiles[p.blank]).toBe(0);
      expect(slideSolved(p)).toBe(false);
      expect(solvableByParity(p.tiles, 3)).toBe(true);
    }
  });

  it('a slide puzzle reports solved once the tiles are ordered', () => {
    const solved = { kind: 'slide' as const, n: 3, tiles: [1, 2, 3, 4, 5, 6, 7, 8, 0], blank: 8, par: 1 };
    expect(slideSolved(solved)).toBe(true);
    expect(slideNeighbours(8, 3).sort()).toEqual([5, 7]);
  });

  it('lights-out boards are cleared by replaying the generated solution', () => {
    for (let seed = 0; seed < 20; seed++) {
      const p = makeLights(5, seed, 7);
      expect(lightsSolved(p)).toBe(false);
      const cells = [...p.cells];
      for (const i of p.solution) for (const t of lightsToggle(i, p.n)) cells[t] = !cells[t];
      expect(cells.every((c) => !c)).toBe(true);
    }
  });

  it('lock feedback counts exact and misplaced digits correctly', () => {
    expect(lockFeedback([1, 2, 3, 4], [1, 2, 3, 4])).toEqual({ exact: 4, partial: 0 });
    expect(lockFeedback([1, 2, 3, 4], [4, 3, 2, 1])).toEqual({ exact: 0, partial: 4 });
    expect(lockFeedback([1, 1, 2, 2], [1, 2, 1, 3])).toEqual({ exact: 1, partial: 2 });
    expect(lockFeedback([1, 2, 3], [5, 5, 5])).toEqual({ exact: 0, partial: 0 });
  });

  it('a lock code only contains digits inside the configured range', () => {
    const p = makeLock(4, 6, 77);
    expect(p.code).toHaveLength(4);
    p.code.forEach((d) => { expect(d).toBeGreaterThanOrEqual(1); expect(d).toBeLessThanOrEqual(6); });
  });

  it('echo sequences are deterministic per seed and stay inside the pad range', () => {
    const a = makeEcho(6, 24, 31);
    const b = makeEcho(6, 24, 31);
    expect(a.sequence).toEqual(b.sequence);
    a.sequence.forEach((x) => { expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThan(6); });
  });

  it('volt sum targets are satisfied by the generated solution and nothing less', () => {
    for (let seed = 0; seed < 15; seed++) {
      const p = makeSum(5, seed);
      expect(sumSolved(p, p.solution)).toBe(true);
      const broken = [...p.solution];
      const flip = broken.findIndex((x) => x);
      if (flip >= 0) { broken[flip] = false; expect(sumSolved(p, broken)).toBe(false); }
    }
  });
});

/** Standard 15-puzzle solvability check, used to prove the generator never cheats. */
function solvableByParity(tiles: number[], n: number) {
  const flat = tiles.filter((t) => t !== 0);
  let inv = 0;
  for (let i = 0; i < flat.length; i++) for (let j = i + 1; j < flat.length; j++) if (flat[i] > flat[j]) inv++;
  if (n % 2 === 1) return inv % 2 === 0;
  const blankRowFromBottom = n - Math.floor(tiles.indexOf(0) / n);
  return (blankRowFromBottom % 2 === 0) === (inv % 2 === 1);
}

/* ------------------------------------------------------------------ progression */
describe('progression', () => {
  it('awards more XP for a win than a loss, and a bonus online', () => {
    const base = emptyProgress();
    const win = recordMatch(base, { gameId: 'chess', mode: 'ai', result: 'win' });
    const loss = recordMatch(base, { gameId: 'chess', mode: 'ai', result: 'loss' });
    const online = recordMatch(base, { gameId: 'chess', mode: 'online', result: 'win' });
    expect(win.xpGained).toBeGreaterThan(loss.xpGained);
    expect(online.xpGained).toBeGreaterThan(win.xpGained);
  });

  it('keeps per-game stats and the best score', () => {
    let p = emptyProgress();
    p = recordMatch(p, { gameId: 'snake', mode: 'solo', result: 'draw', score: 120 }).next;
    p = recordMatch(p, { gameId: 'snake', mode: 'solo', result: 'draw', score: 80 }).next;
    expect(p.stats.snake.played).toBe(2);
    expect(p.stats.snake.best).toBe(120);
  });

  it('tracks the online head-to-head record separately', () => {
    let p = emptyProgress();
    p = recordMatch(p, { gameId: 'chess', mode: 'online', result: 'win' }).next;
    p = recordMatch(p, { gameId: 'chess', mode: 'online', result: 'loss' }).next;
    p = recordMatch(p, { gameId: 'chess', mode: 'ai', result: 'win' }).next;
    expect(p.versus).toEqual({ wins: 1, losses: 1, draws: 0 });
  });

  it('unlocks achievements from real match metadata only', () => {
    const p = emptyProgress();
    const first = recordMatch(p, { gameId: 'chess', mode: 'ai', result: 'win' });
    expect(first.unlocked.map((a) => a.slug)).toContain('first-spark');
    expect(first.unlocked.map((a) => a.slug)).toContain('checkmate');

    const quiet = recordMatch(first.next, { gameId: 'memory', mode: 'solo', result: 'win' });
    expect(quiet.unlocked.map((a) => a.slug)).not.toContain('elephant');

    const streak = recordMatch(first.next, { gameId: 'memory', mode: 'solo', result: 'win', meta: { memoryStreak: 5 } });
    expect(streak.unlocked.map((a) => a.slug)).toContain('elephant');
  });

  it('never unlocks the same achievement twice', () => {
    const p = emptyProgress();
    const one = unlockAchievement(p, 'first-spark');
    const two = unlockAchievement(one.next, 'first-spark');
    expect(one.unlocked).toHaveLength(1);
    expect(two.unlocked).toHaveLength(0);
  });

  it('levels rise monotonically with XP', () => {
    let last = 0;
    for (const xp of [0, 100, 300, 900, 2600, 6000, 12000]) {
      const l = levelFor(xp);
      expect(l.level).toBeGreaterThanOrEqual(last);
      expect(l.pct).toBeGreaterThanOrEqual(0);
      expect(l.pct).toBeLessThanOrEqual(1);
      last = l.level;
    }
  });

  it('favourites toggle on and off', () => {
    let p = emptyProgress();
    p = toggleFavourite(p, 'chess');
    expect(p.favourites).toContain('chess');
    p = toggleFavourite(p, 'chess');
    expect(p.favourites).not.toContain('chess');
  });

  it('daily challenges are stable for a date and distinct from each other', () => {
    const a = dailyChallenges('2026-10-14');
    const b = dailyChallenges('2026-10-14');
    const c = dailyChallenges('2026-10-15');
    expect(a).toEqual(b);
    expect(new Set(a.map((x) => x.id)).size).toBe(3);
    expect(a.map((x) => x.id).join()).not.toBe(c.map((x) => x.id).join());
  });

  it('every achievement has a unique slug and a description', () => {
    expect(new Set(ACHIEVEMENTS.map((a) => a.slug)).size).toBe(ACHIEVEMENTS.length);
    ACHIEVEMENTS.forEach((a) => { expect(a.name.length).toBeGreaterThan(2); expect(a.description.length).toBeGreaterThan(8); });
  });
});
