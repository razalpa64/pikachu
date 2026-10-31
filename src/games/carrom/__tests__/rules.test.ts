import { describe, expect, it } from 'vitest';
import { BASELINE_Y, simulateShot } from '../physics';
import type { Coin, CoinKind } from '../physics';
import { applyShot, carromRules, createInitial, liveOf, pocketedOf, type CarromState } from '../rules';

const mk = (list: [CoinKind, number, number][]): Coin[] =>
  list.map(([kind, x, y], i) => ({ id: i, kind, x, y, alive: true }));

/** A board built for one shot: the assertion is about the rules, not the aiming. */
const board = (coins: Coin[], patch: Partial<CarromState> = {}): CarromState => ({
  ...createInitial(), coins, ...patch,
});

/** These two shots were found against the simulation and then frozen here. */
const SINK_CORNER = { x: 30, angle: (-105 * Math.PI) / 180, power: 1 };
const INTO_POCKET = { x: 30, angle: (-110 * Math.PI) / 180, power: 1 };
const MISS = { x: 30, angle: 0, power: 0.5 };

describe('turns', () => {
  it('opens with white, and a clean hit that sinks nothing passes the turn', () => {
    const start = createInitial();
    expect(carromRules.currentPlayer(start)).toBe(0);
    const after = applyShot(start, 0, { x: 50, angle: -Math.PI / 2, power: 0.95 });
    expect(after.turn).toBe(1);
    expect(after.lastShot?.contact).toBe(true);
    expect(after.lastShot?.pocketed).toEqual([]);
  });

  it('refuses a shot from the player who is not to shoot', () => {
    const start = createInitial();
    expect(applyShot(start, 1, SINK_CORNER)).toBe(start);
  });

  it('clamps a shot to the board instead of trusting it', () => {
    const after = applyShot(createInitial(), 0, { x: 9999, angle: Number.NaN, power: 40 });
    expect(after.shots).toBe(1);
    expect(Number.isFinite(after.strikerX)).toBe(true);
  });
});

describe('sinking', () => {
  it('earns another shot when you sink your own coin', () => {
    const state = board(mk([['white', 9.5, 9.5], ['white', 88, 50], ['black', 12, 50]]));
    const after = applyShot(state, 0, SINK_CORNER);
    expect(after.lastShot?.pocketed).toEqual(['white']);
    expect(after.turn).toBe(0);
    expect(pocketedOf(after, 0)).toBe(1);
  });

  it('gives the point to the opponent when you sink theirs, and ends your turn', () => {
    const state = board(mk([['black', 9.5, 9.5], ['white', 88, 50], ['black', 12, 50]]));
    const after = applyShot(state, 0, SINK_CORNER);
    expect(after.lastShot?.pocketed).toEqual(['black']);
    expect(after.turn).toBe(1);
    expect(pocketedOf(after, 1)).toBe(1);
    expect(pocketedOf(after, 0)).toBe(0);
  });
});

describe('fouls', () => {
  it('counts a striker in the pocket, sends one of your coins back, and passes the turn', () => {
    const coins = mk([['white', 60, 40]]);
    coins.push({ id: 1, kind: 'white', x: 61, y: 44, alive: false });
    const state = board(coins);
    const after = applyShot(state, 0, INTO_POCKET);
    expect(after.fouls[0]).toBe(1);
    expect(after.turn).toBe(1);
    const revived = after.coins.filter((c) => c.alive).length;
    expect(revived).toBe(2);
    const back = after.coins.find((c) => c.alive && Math.abs(c.x - 50) < 3 && Math.abs(c.y - 50) < 3);
    expect(back, 'the returned coin goes to the centre').toBeTruthy();
  });

  it('sends a coin back only if you have one down', () => {
    const state = board(mk([['black', 60, 40]]));
    const after = applyShot(state, 0, INTO_POCKET);
    expect(after.fouls[0]).toBe(1);
    expect(after.coins.filter((c) => c.alive)).toHaveLength(1);
  });

  it('counts a shot that touches nothing', () => {
    const state = board(mk([['white', 9.5, 9.5]]));
    const after = applyShot(state, 0, MISS);
    expect(after.fouls[0]).toBe(1);
    expect(after.turn).toBe(1);
  });
});

describe('the queen', () => {
  it('is pending when sunk alone', () => {
    const state = board(mk([['queen', 9.5, 9.5], ['white', 88, 50], ['black', 12, 50]]));
    const after = applyShot(state, 0, SINK_CORNER);
    expect(after.lastShot?.pocketed).toEqual(['queen']);
    expect(after.queenPending).toBe(0);
    expect(after.queen).toBe('board');
    expect(after.turn).toBe(1);
  });

  it('becomes yours when covered on the next shot', () => {
    let state = board(mk([['queen', 9.5, 9.5], ['white', 60, 40], ['black', 60, 30]]));
    state = applyShot(state, 0, SINK_CORNER);
    expect(state.queenPending).toBe(0);
    expect(state.turn).toBe(1);
    // player 1 does nothing much, then player 0 sinks a white coin to cover
    state = applyShot(state, 1, MISS);
    expect(state.turn).toBe(0);
    const before = state.coins;
    const target = before.find((c) => c.kind === 'white' && c.alive)!;
    const covering = board(
      [{ ...target, x: 9.5, y: 9.5 }, { id: 9, kind: 'black', x: 60, y: 40, alive: true }],
      { turn: 0, queenPending: 0, fouls: state.fouls },
    );
    const after = applyShot(covering, 0, SINK_CORNER);
    expect(after.lastShot?.queenCovered).toBe(true);
    expect(after.queen).toBe('p0');
    expect(after.queenPending).toBeNull();
  });

  it('goes back to the centre if you fail to cover it', () => {
    const state = board(
      mk([['black', 9.5, 9.5], ['white', 88, 50], ['black', 12, 50], ['queen', 70, 70]])
        .map((c) => (c.kind === 'queen' ? { ...c, alive: false } : c)),
      { turn: 0, queenPending: 0, queen: 'board' },
    );
    const after = applyShot(state, 0, SINK_CORNER);
    expect(after.lastShot?.pocketed).toEqual(['black']);
    expect(after.queen).toBe('board');
    expect(after.queenPending).toBeNull();
    const queen = after.coins.find((c) => c.kind === 'queen')!;
    expect(queen.alive, 'the queen is back on the board').toBe(true);
    expect(Math.hypot(queen.x - 50, queen.y - 50)).toBeLessThan(16);
  });
});

describe('winning', () => {
  it('ends when a player has cleared their colour and taken the queen', () => {
    const coins = mk([['white', 9.5, 9.5], ['queen', 70, 70]]).map((c) => (c.kind === 'queen' ? { ...c, alive: false } : c));
    const state = board(coins, { queen: 'p0' });
    const after = applyShot(state, 0, SINK_CORNER);
    expect(after.over).toBe(true);
    expect(after.winner).toBe(0);
    expect(after.reason).toMatch(/cleared the board/i);
    expect(carromRules.result(after)).toMatchObject({ over: true, winner: 0 });
  });

  it('sends the last coin back while the queen is still on the board', () => {
    const coins = mk([['white', 9.5, 9.5], ['queen', 70, 70], ['black', 88, 50]]);
    const state = board(coins, { turn: 0 });
    const after = applyShot(state, 0, SINK_CORNER);
    expect(after.over).toBe(false);
    expect(after.lastShot?.foul).toBe('queen_due');
    expect(liveOf(after, 0), 'the last coin is back on the board').toBe(1);
    expect(after.turn).toBe(1);
  });

  it('does not end while the queen is still owed', () => {
    // white is already out of coins, but the queen is still uncovered, so the
    // board is not decided — a black foul must not hand white the win
    const state = board(mk([['black', 9.5, 9.5], ['queen', 60, 40]]), { turn: 1, queenPending: 0 });
    const after = applyShot(state, 1, MISS);
    expect(after.over).toBe(false);
  });
});

describe('the referee', () => {
  it('offers legal opening shots, and every one of them is accepted and playable', () => {
    const start = createInitial();
    const moves = carromRules.legalMoves(start, 0);
    expect(moves.length).toBeGreaterThan(6);
    expect(carromRules.isLegal(start, 0, moves[0])).toBe(true);
    for (const m of moves.slice(0, 12)) {
      const after = carromRules.applyMove(start, 0, m);
      expect(carromRules.result(after).over).toBe(false);
      expect(after.shots).toBe(1);
    }
  });

  it('rejects nonsense', () => {
    const start = createInitial();
    expect(carromRules.isLegal(start, 1, { x: 50, angle: -1, power: 0.5 })).toBe(false);
    expect(carromRules.isLegal(start, 0, { x: 2, angle: -1, power: 0.5 })).toBe(false);
    expect(carromRules.isLegal(start, 0, { x: 50, angle: -1, power: 3 })).toBe(false);
    expect(carromRules.isLegal(start, 0, { x: 50, angle: -1, power: 0 })).toBe(false);
    expect(carromRules.isLegal(start, 0, null)).toBe(false);
    expect(carromRules.isLegal(start, 0, 'shot')).toBe(false);
  });

  it('reports the score honestly from the board, not from a counter', () => {
    const coins = mk([['white', 88, 50], ['white', 60, 40], ['black', 30, 60]]);
    for (let i = 0; i < 7; i++) coins.push({ id: coins.length, kind: 'white', x: 20 + i, y: 90, alive: false });
    const state = board(coins);
    expect(liveOf(state, 0)).toBe(2);
    expect(pocketedOf(state, 0)).toBe(7);
    expect(pocketedOf(state, 1)).toBe(0);
  });

  it('never mutates the state it was given', () => {
    const start = createInitial();
    const snapshot = JSON.stringify(start);
    applyShot(start, 0, { x: 50, angle: -Math.PI / 2, power: 0.9 });
    expect(JSON.stringify(start)).toBe(snapshot);
    expect(BASELINE_Y[0]).toBeGreaterThan(50);
  });
});

describe('the shot is recorded for the other player', () => {
  it('stores the clamped shot the referee actually ran', () => {
    const s = createInitial();
    // an absurd shot is clamped to something legal, and that is what is recorded
    const after = applyShot(s, 0, { x: 400, angle: 99, power: 12 });
    expect(after.lastMove).not.toBeNull();
    expect(after.lastMove!.id).toBe(1);
    expect(after.lastMove!.player).toBe(0);
    expect(after.lastMove!.shot.power).toBeLessThanOrEqual(1);
    expect(after.lastMove!.shot.power).toBeGreaterThan(0);
    expect(Number.isFinite(after.lastMove!.shot.angle)).toBe(true);
  });

  it('gives every shot a different id, so a replay runs exactly once', () => {
    let s = createInitial();
    const ids: number[] = [];
    for (let i = 0; i < 4; i++) {
      s = applyShot(s, s.turn, { x: 50, angle: s.turn === 0 ? -Math.PI / 2 : Math.PI / 2, power: 0.6 });
      ids.push(s.lastMove!.id);
    }
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('replays to exactly the state the referee produced', () => {
    // the whole promise of the feature: the opponent's board is not a different
    // simulation, it is the same one run again from the same starting position
    const before = createInitial();
    const after = applyShot(before, 0, { x: 46, angle: -Math.PI / 2 + 0.12, power: 0.85 });
    const move = after.lastMove!;
    const replayed = simulateShot(before.coins, { x: move.shot.x, y: BASELINE_Y[move.player] }, move.shot);
    expect(replayed.coins.map((c) => [c.x.toFixed(6), c.y.toFixed(6), c.alive])).toEqual(
      after.coins.map((c) => [c.x.toFixed(6), c.y.toFixed(6), c.alive]),
    );
  });

  it('asks for frames, so a replay has something to draw', () => {
    const s = createInitial();
    const sim = simulateShot(s.coins, { x: 50, y: BASELINE_Y[0] }, { x: 50, angle: -Math.PI / 2, power: 0.9 }, true);
    expect(sim.frames.length).toBeGreaterThan(20);
  });
});
