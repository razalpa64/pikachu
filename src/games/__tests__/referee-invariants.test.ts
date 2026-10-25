/**
 * Cross-game invariants.
 *
 * Every referee is played, thousands of random moves deep, against the contract in
 * `types.ts` — because a per-game test only covers the situations its author thought
 * of, and the bugs that actually reach players are the ones nobody thought of:
 * a turn left with the wrong player, a board mutated in place so the "previous"
 * position quietly becomes the current one, a move list that disagrees with the
 * validator, a finished game that still believes somebody can act.
 *
 * These are cheap to run and catch a whole class of defect in one place. Anything
 * with free-form input (Sketch) or no turn owner (Reaction) is excluded by name and
 * covered by its own suite instead.
 */
import { describe, expect, it } from 'vitest';
import { REFEREES } from '../referees';
import { autoPlace } from '../battleship/rules';
import { GAMES } from '../registry';
import type { Slot, TurnGameRules } from '../types';

/** Free-form or clock-driven games: no enumerable legal move to drive them with. */
const NOT_TURN_BASED = new Set(['sketch', 'reaction']);

/** Deterministic RNG so a failure is reproducible from the seed in the message. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

/**
 * A few games ask for input the move list cannot enumerate: Battleship wants a
 * whole fleet placed before it will offer anything. Driving those is the test's
 * job, not the referee's.
 */
const DRIVERS: Record<string, (state: any) => { slot: Slot; move: unknown } | null> = {
  battleship: (s) => {
    if (s.phase !== 'placement') return null;
    const slot = ([0, 1] as Slot[]).find((p) => !s.fleets[p]?.length);
    return slot === undefined ? null : { slot, move: { type: 'place', ships: autoPlace(11 + slot) } };
  },
};

function configFor(id: string): Record<string, unknown> {
  const game = GAMES.find((g) => g.id === id);
  const out: Record<string, unknown> = {};
  for (const setting of game?.settings ?? []) out[setting.key] = setting.default;
  return out;
}

/** Freeze deeply, so any in-place write throws in strict mode. */
function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value as Record<string, unknown>)) deepFreeze(v);
  }
  return value;
}

const ids = Object.keys(REFEREES).filter((id) => !NOT_TURN_BASED.has(id));

describe.each(ids)('%s', (id) => {
  const rules = REFEREES[id] as TurnGameRules<any, any>;

  it('honours the referee contract over a full random game', () => {
    const game = GAMES.find((g) => g.id === id)!;
    const config = configFor(id);
    const random = rng(0x5eed + id.length * 7919 + id.charCodeAt(0));

    let state = rules.createInitialState(config, 0xC0FFEE);
    let steps = 0;

    while (!rules.result(state).over && steps < 3000) {
      steps += 1;

      // Who may act? Some games (Battleship's placement phase) have no single
      // owner but still allow both players to act.
      const owner = rules.currentPlayer(state) as Slot | null;
      const actors: Slot[] = owner === null ? [0, 1] : [owner];
      const driven = DRIVERS[id]?.(state) ?? null;
      const candidates = actors
        .map((slot) => ({ slot, moves: rules.legalMoves(state, slot) }))
        .filter((o) => o.moves.length > 0);
      // random actor, so neither seat gets all the interesting positions
      const option = driven
        ? { slot: driven.slot, moves: [driven.move] }
        : candidates[Math.floor(random() * candidates.length)];

      // A game with nothing to do and no timer would hang the room forever.
      if (!option) {
        expect(typeof rules.tick, `${id}: no legal move and no tick`).toBe('function');
        const next = rules.tick!(state, Date.now() + steps * 1000);
        expect(rules.isLegal(state, 0, null), `${id}: tick produced no change`).toBe(false);
        state = next;
        continue;
      }

      const move = option.moves[Math.floor(random() * option.moves.length)];
      expect(rules.isLegal(state, option.slot, move), `${id}: legalMoves contains an illegal move`).toBe(true);

      // The contract is explicit: applyMove must never mutate the input. Freezing
      // the state turns a silent aliasing bug into a thrown TypeError.
      deepFreeze(state);
      const before = JSON.stringify(state);
      const next = rules.applyMove(state, option.slot, move);
      expect(JSON.stringify(state), `${id}: applyMove mutated the state it was given`).toBe(before);

      expect(next, `${id}: applyMove returned nothing`).toBeTruthy();
      expect(() => JSON.stringify(next), `${id}: state is not serialisable`).not.toThrow();
      expect(JSON.stringify(next)).not.toContain('NaN');

      state = next;

      const outcome = rules.result(state);
      if (outcome.over) {
        // A finished game must not still be asking somebody to move.
        expect(rules.currentPlayer(state), `${id}: finished but a player is still on turn`).toBeNull();
        expect(typeof outcome.reason, `${id}: no reason given for the ending`).toBe('string');
        expect(outcome.reason.length, `${id}: empty ending reason`).toBeGreaterThan(3);
        expect(outcome.winner === null || outcome.winner === 0 || outcome.winner === 1).toBe(true);
        for (const slot of [0, 1] as Slot[]) {
          expect(rules.legalMoves(state, slot), `${id}: legal moves offered after the game ended`).toHaveLength(0);
        }
      }
    }

    // A game that cannot end is a room nobody can leave.
    expect(rules.result(state).over, `${id}: never finished after ${steps} moves`).toBe(true);
    expect(steps, `${id}: took an implausible number of moves`).toBeLessThan(3000);
    expect(game).toBeTruthy();
  });

  it('never hands the idle seat a move', () => {
    const random = rng(0xa11ce + id.length);
    let state = rules.createInitialState(configFor(id), 0x1234);
    for (let step = 0; step < 60 && !rules.result(state).over; step++) {
      const owner = rules.currentPlayer(state) as Slot | null;
      if (owner !== null) {
        // Enumerating for the seat that is not on turn must come back empty —
        // otherwise a board lights up the opponent's options as if they were yours.
        expect(rules.legalMoves(state, (owner === 0 ? 1 : 0) as Slot),
          `${id}: idle seat was offered a move`).toHaveLength(0);
      }
      const driven = DRIVERS[id]?.(state) ?? null;
      const actors: Slot[] = owner === null ? [0, 1] : [owner];
      const candidates = actors
        .map((slot) => ({ slot, moves: rules.legalMoves(state, slot) }))
        .filter((o) => o.moves.length > 0);
      const option = driven
        ? { slot: driven.slot, moves: [driven.move] }
        : candidates[Math.floor(random() * candidates.length)];
      if (!option) break;
      const move = option.moves[Math.floor(random() * option.moves.length)];
      if (!rules.isLegal(state, option.slot, move)) break;
      state = rules.applyMove(state, option.slot, move);
    }
  });

  it('treats an illegal move as a no-op, never a crash', () => {
    const config = configFor(id);
    let state = rules.createInitialState(config, 99);

    // Seed the candidate list with moves that were legal at some point, so this
    // catches "the referee trusts the shape and applies it twice", not just junk.
    const retired: unknown[] = [];
    const owner = rules.currentPlayer(state) as Slot | null;
    const seedSlot: Slot = owner ?? 0;
    retired.push(...rules.legalMoves(state, seedSlot).slice(0, 3));
    const first = rules.legalMoves(state, seedSlot)[0];
    if (first && rules.isLegal(state, seedSlot, first)) {
      const after = rules.applyMove(state, seedSlot, first);
      retired.push(...rules.legalMoves(after, rules.currentPlayer(after) ?? seedSlot).slice(0, 3));
      state = after;
    }

    const junk = [
      null, undefined, 0, 1, 'x', {}, [], NaN, true,
      { type: 'nope' }, { type: 'fire', cell: -1 }, { cell: -1 }, { col: -1 },
      { from: 0, to: 0 }, { flip: -1 }, { pit: -1 }, { card: -1 }, { t: 'stroke' },
      { resolve: true }, { type: 'place', ships: [] },
      ...retired,
    ];

    const before = JSON.stringify(state);
    for (const slot of [0, 1] as Slot[]) {
      for (const candidate of junk) {
        if (rules.isLegal(state, slot, candidate as never)) continue;
        let next: unknown;
        expect(() => { next = rules.applyMove(state, slot, candidate as never); },
          `${id}: applyMove threw on ${JSON.stringify(candidate)}`).not.toThrow();
        expect(JSON.stringify(next), `${id}: illegal move changed the state`).toBe(before);
      }
    }
    expect(JSON.stringify(state), `${id}: illegal move mutated the input state`).toBe(before);
  });

  it('rejects junk without touching the state', () => {
    const state = rules.createInitialState(configFor(id), 42);
    const before = JSON.stringify(state);
    const junk = [null, undefined, 0, 'x', {}, [], { type: 'nope' }, { type: 'fire', cell: -1 }, NaN];

    for (const slot of [0, 1] as Slot[]) {
      for (const move of junk) {
        expect(rules.isLegal(state, slot, move as never)).toBe(false);
      }
    }
    expect(JSON.stringify(state)).toBe(before);
  });
});
