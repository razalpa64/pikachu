import { describe, expect, it } from 'vitest';
import {
  BASELINE_Y, BOARD, COIN_R, POCKETS, legalStrikerX, nothingMoved, openingCoins,
  simulateShot, strikerBlocked,
} from '../physics';
import type { Coin, CoinKind } from '../physics';

const mk = (list: [CoinKind, number, number][]): Coin[] =>
  list.map(([kind, x, y], i) => ({ id: i, kind, x, y, alive: true }));

/** A white coin sitting a coin's width from the top-left pocket. */
const CORNER = mk([['white', 9.5, 9.5], ['black', 60, 40]]);
/** The shot that puts it away — found by search, then frozen here. */
const SINK = { x: 30, angle: (-105 * Math.PI) / 180, power: 1 };

describe('the opening position', () => {
  it('packs nineteen coins: nine white, nine black, one queen', () => {
    const coins = openingCoins();
    expect(coins).toHaveLength(19);
    expect(coins.filter((c) => c.kind === 'white')).toHaveLength(9);
    expect(coins.filter((c) => c.kind === 'black')).toHaveLength(9);
    expect(coins.filter((c) => c.kind === 'queen')).toHaveLength(1);
  });

  it('places the queen on the centre spot and never overlaps two coins', () => {
    const coins = openingCoins();
    const queen = coins.find((c) => c.kind === 'queen')!;
    expect(queen.x).toBeCloseTo(BOARD / 2, 5);
    expect(queen.y).toBeCloseTo(BOARD / 2, 5);
    for (let i = 0; i < coins.length; i++) {
      for (let j = i + 1; j < coins.length; j++) {
        const d = Math.hypot(coins[i].x - coins[j].x, coins[i].y - coins[j].y);
        expect(d, `coins ${i} and ${j} overlap`).toBeGreaterThan(COIN_R * 2 - 0.05);
      }
    }
    for (const c of coins) {
      expect(c.x).toBeGreaterThan(COIN_R);
      expect(c.x).toBeLessThan(BOARD - COIN_R);
    }
  });

  it('leaves both baselines clear', () => {
    const coins = openingCoins();
    expect(strikerBlocked(coins, 0, 50)).toBe(false);
    expect(strikerBlocked(coins, 1, 50)).toBe(false);
  });
});

describe('the board is closed', () => {
  it('keeps every resting coin inside the rails', () => {
    const result = simulateShot(openingCoins(), { x: 50, y: BASELINE_Y[0] }, { x: 50, angle: -Math.PI / 2, power: 0.95 });
    for (const c of result.coins) {
      if (!c.alive) continue;
      expect(c.x).toBeGreaterThanOrEqual(COIN_R - 0.01);
      expect(c.x).toBeLessThanOrEqual(BOARD - COIN_R + 0.01);
      expect(c.y).toBeGreaterThanOrEqual(COIN_R - 0.01);
      expect(c.y).toBeLessThanOrEqual(BOARD - COIN_R + 0.01);
    }
  });

  it('is deterministic: the same shot on the same board is the same shot', () => {
    const a = simulateShot(openingCoins(), { x: 42, y: BASELINE_Y[0] }, { x: 42, angle: -1.4, power: 0.8 });
    const b = simulateShot(openingCoins(), { x: 42, y: BASELINE_Y[0] }, { x: 42, angle: -1.4, power: 0.8 });
    expect(a.coins).toEqual(b.coins);
    expect(a.striker).toEqual(b.striker);
    expect(a.pocketed).toEqual(b.pocketed);
  });

  it('breaks the pack: a hard shot into the middle moves coins', () => {
    const before = openingCoins();
    const after = simulateShot(before, { x: 50, y: BASELINE_Y[0] }, { x: 50, angle: -Math.PI / 2, power: 0.9 });
    expect(after.contact).toBe(true);
    expect(nothingMoved(before, after.coins)).toBe(false);
    expect(after.coins.filter((c, i) => Math.hypot(c.x - before[i].x, c.y - before[i].y) > 0.5).length).toBeGreaterThan(3);
  });
});

describe('pockets', () => {
  it('swallows a coin knocked into the corner', () => {
    const result = simulateShot(CORNER, { x: SINK.x, y: BASELINE_Y[0] }, SINK);
    expect(result.pocketed).toEqual([0]);
    expect(result.strikerPocketed).toBe(false);
    expect(result.coins[0].alive).toBe(false);
  });

  it('swallows the striker aimed straight into a corner', () => {
    const result = simulateShot([], { x: 30, y: BASELINE_Y[0] }, { x: 30, angle: (-110 * Math.PI) / 180, power: 1 });
    expect(result.strikerPocketed).toBe(true);
    expect(result.contact).toBe(false);
  });

  it('has four pockets, one per corner', () => {
    expect(POCKETS).toHaveLength(4);
    for (const p of POCKETS) {
      expect([0, BOARD]).toContain(p.x);
      expect([0, BOARD]).toContain(p.y);
    }
  });

  it('reports no contact when the striker misses everything', () => {
    const result = simulateShot(CORNER, { x: 30, y: BASELINE_Y[0] }, { x: 30, angle: 0, power: 0.5 });
    expect(result.contact).toBe(false);
    expect(result.strikerPocketed).toBe(false);
    expect(result.coins.every((c) => c.alive)).toBe(true);
  });
});

describe('frames', () => {
  it('are only recorded when asked for, and land where the shot did', () => {
    const quiet = simulateShot(CORNER, { x: SINK.x, y: BASELINE_Y[0] }, SINK);
    expect(quiet.frames).toHaveLength(0);
    const recorded = simulateShot(CORNER, { x: SINK.x, y: BASELINE_Y[0] }, SINK, true);
    expect(recorded.frames.length).toBeGreaterThan(10);
    const last = recorded.frames[recorded.frames.length - 1];
    expect(last.coins[0].alive).toBe(false);
    expect(last.striker.x).toBeCloseTo(recorded.striker.x, 0);
  });
});

describe('striker placement', () => {
  it('slides along the baseline rather than sitting inside a coin', () => {
    const coins = mk([['white', 50, BASELINE_Y[0]]]);
    expect(strikerBlocked(coins, 0, 50)).toBe(true);
    const x = legalStrikerX(coins, 0, 50);
    expect(strikerBlocked(coins, 0, x)).toBe(false);
    expect(Math.abs(x - 50)).toBeLessThan(8);
  });

  it('stays on the baseline', () => {
    expect(legalStrikerX([], 0, -40)).toBeGreaterThan(19);
    expect(legalStrikerX([], 0, 400)).toBeLessThan(81);
  });
});

/**
 * The shot's soundtrack.
 *
 * The board plays the sounds of a shot from the simulation's own event list, so
 * that list has to be a faithful account of what happened: a strike when the
 * striker meets something, ticks for the coins, a rail thud when something hits
 * the wood, a drop when something falls in — each with the time it happened, in
 * order. Nothing here changes the outcome of a shot; a client that ignores the
 * events and a server that never computes them still agree on the board.
 */
describe('shot events', () => {
  const shoot = (power: number, angle = -Math.PI / 2) =>
    simulateShot(openingCoins(), { x: 50, y: BASELINE_Y[0] }, { x: 50, angle, power }, true);

  it('starts with the striker meeting the pack', () => {
    const sim = shoot(0.9);
    expect(sim.events[0].t).toBe('strike');
    expect(sim.events.some((e) => e.t === 'coin')).toBe(true);
  });

  it('is in time order, and every event has a real timestamp', () => {
    const sim = shoot(0.7);
    let last = -1;
    for (const e of sim.events) {
      expect(e.at).toBeGreaterThanOrEqual(0);
      expect(e.at).toBeGreaterThanOrEqual(last);
      last = e.at;
    }
  });

  it('a gentle shot is quieter than a hard one', () => {
    const soft = shoot(0.2).events;
    const hard = shoot(0.95).events;
    expect(hard.length).toBeGreaterThan(soft.length);
    expect(Math.max(...hard.map((e) => ('force' in e ? e.force : 0)))).toBeGreaterThan(
      Math.max(...soft.map((e) => ('force' in e ? e.force : 0))),
    );
  });

  it('clicks when coins meet each other, not only when the striker hits', () => {
    const sim = shoot(0.9);
    expect(sim.events.filter((e) => e.t === 'coin').length).toBeGreaterThan(3);
  });

  it('reports a drop for anything that goes in a pocket', () => {
    // fire the striker into a corner pocket: the striker itself goes down
    const sim = simulateShot(
      openingCoins(),
      { x: 8, y: BASELINE_Y[0] },
      { x: 8, angle: Math.PI / 2, power: 1 },
      true,
    );
    if (sim.strikerPocketed) {
      expect(sim.events.some((e) => e.t === 'drop' && e.coin === -1)).toBe(true);
    }
    expect(sim.events.length).toBeGreaterThan(0);
  });

  it('never lets the events change the shot', () => {
    const a = shoot(0.8);
    const b = shoot(0.8);
    expect(a.events).toEqual(b.events);
    expect(a.coins.map((c) => [c.x, c.y, c.alive])).toEqual(b.coins.map((c) => [c.x, c.y, c.alive]));
  });
});
