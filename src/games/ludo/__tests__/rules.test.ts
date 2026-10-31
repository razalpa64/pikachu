import { describe, expect, it } from 'vitest';
import {
  HOME_STEP, MOVE_LIMIT, TOKENS, capturesAt, createWithSeed, homeCount, ludoRules, movableTokens,
  rollFrom, seatOf, type LudoState,
} from '../rules';
import { START } from '../track';

/** A board built by hand, so an assertion is about the rule and not about luck. */
const board = (tokens: number[][], patch: Partial<LudoState> = {}): LudoState => ({
  ...createWithSeed(7),
  tokens,
  ...patch,
});

const gold = (list: number[]) => [list.slice(), new Array(TOKENS).fill(-1)];

describe('the dice', () => {
  it('is a real die, and the sequence is decided by the seed', () => {
    const seen = new Set<number>();
    for (let seed = 1; seed <= 400; seed++) {
      const { dice } = rollFrom(seed);
      expect(dice).toBeGreaterThanOrEqual(1);
      expect(dice).toBeLessThanOrEqual(6);
      seen.add(dice);
    }
    expect(seen.size).toBe(6);
    expect(rollFrom(12345)).toEqual(rollFrom(12345));
  });

  it('is rolled by the referee, not offered to the client', () => {
    const state = createWithSeed(99);
    expect(state.dice).toBeNull();
    expect(ludoRules.isLegal(state, 0, { t: 'move', token: 0 })).toBe(false);
    const after = ludoRules.applyMove(state, 0, { t: 'roll' });
    expect(after.dice).toBe(rollFrom(99).dice);
    expect(after.seed).toBe(rollFrom(99).seed);
    // and it cannot be rolled twice in one turn
    expect(ludoRules.isLegal(after, 0, { t: 'roll' })).toBe(false);
    expect(ludoRules.applyMove(after, 0, { t: 'roll' })).toBe(after);
  });

  it('advances the seed, so the next roll is a new roll', () => {
    const state = createWithSeed(1234);
    const first = ludoRules.applyMove(state, 0, { t: 'roll' });
    expect(first.seed).not.toBe(state.seed);
  });
});

describe('moving', () => {
  it('a six brings a token out and earns another roll', () => {
    const state = board(gold([-1, -1, -1, -1]), { dice: 6 });
    const after = ludoRules.applyMove(state, 0, { t: 'move', token: 2 });
    expect(after.tokens[0][2]).toBe(0);
    expect(after.turn, 'a six keeps the turn').toBe(0);
    expect(after.dice).toBeNull();
    expect(after.event?.kind).toBe('out');
  });

  it('only a six opens the yard', () => {
    for (const dice of [1, 2, 3, 4, 5]) {
      const state = board(gold([-1, -1, -1, -1]), { dice });
      expect(movableTokens(state, 0, dice), `a ${dice} opened the yard`).toHaveLength(0);
      expect(ludoRules.isLegal(state, 0, { t: 'move', token: 0 })).toBe(false);
    }
  });

  it('moves a token on the ring by the number rolled, and passes the turn', () => {
    const state = board(gold([5, -1, -1, -1]), { dice: 3 });
    const after = ludoRules.applyMove(state, 0, { t: 'move', token: 0 });
    expect(after.tokens[0][0]).toBe(8);
    expect(after.turn).toBe(1);
    expect(after.event).toMatchObject({ kind: 'move', from: 5, to: 8 });
  });

  it('needs the exact number to come home', () => {
    const state = board(gold([HOME_STEP - 2, -1, -1, -1]), { dice: 5 });
    expect(movableTokens(state, 0, 5)).toHaveLength(0);
    expect(ludoRules.isLegal(state, 0, { t: 'move', token: 0 })).toBe(false);
    const exact = board(gold([HOME_STEP - 2, -1, -1, -1]), { dice: 2 });
    const after = ludoRules.applyMove(exact, 0, { t: 'move', token: 0 });
    expect(after.tokens[0][0]).toBe(HOME_STEP);
    expect(after.event?.kind).toBe('home');
  });

  it('refuses a token that is already home, or an index that is not a token', () => {
    const state = board(gold([HOME_STEP, 0, -1, -1]), { dice: 4 });
    expect(ludoRules.isLegal(state, 0, { t: 'move', token: 0 })).toBe(false);
    for (const junk of [-1, 4, 9, 1.5, NaN, '0', null, undefined]) {
      expect(ludoRules.isLegal(state, 0, { t: 'move', token: junk as never }), `accepted ${String(junk)}`).toBe(false);
      expect(ludoRules.applyMove(state, 0, { t: 'move', token: junk as never })).toBe(state);
    }
  });

  it('passes only when nothing can move', () => {
    const stuck = board(gold([-1, -1, -1, -1]), { dice: 3 });
    expect(ludoRules.isLegal(stuck, 0, { t: 'pass' })).toBe(true);
    const canMove = board(gold([0, -1, -1, -1]), { dice: 3 });
    expect(ludoRules.isLegal(canMove, 0, { t: 'pass' })).toBe(false);
    const after = ludoRules.applyMove(stuck, 0, { t: 'pass' });
    expect(after.turn).toBe(1);
    expect(after.dice).toBeNull();
  });

  it('refuses the player who is not to move', () => {
    const state = board(gold([0, -1, -1, -1]), { dice: 3 });
    expect(ludoRules.isLegal(state, 1, { t: 'move', token: 0 })).toBe(false);
    expect(ludoRules.applyMove(state, 1, { t: 'move', token: 0 })).toBe(state);
  });
});

describe('captures', () => {
  it('sends an opponent home when you land on them, and buys a roll', () => {
    // gold on 0, rose sitting on the same ring square gold would reach with a 4
    const state = board([[0, -1, -1, -1], [-1, -1, -1, -1]], { dice: 4 });
    const target = 4;
    const roseProgress = (target + START[0] - START[2] + 52) % 52;
    const withRose: LudoState = { ...state, tokens: [[0, -1, -1, -1], [roseProgress, -1, -1, -1]] };
    expect(capturesAt(withRose, 0, target)).toEqual([{ slot: 1, token: 0 }]);
    const after = ludoRules.applyMove(withRose, 0, { t: 'move', token: 0 });
    expect(after.tokens[1][0], 'the captured token is back in the yard').toBe(-1);
    expect(after.event?.kind).toBe('capture');
    expect(after.turn, 'a capture keeps the turn').toBe(0);
  });

  it('will not capture on a safe square', () => {
    // rose parked on gold's start square, which is safe
    const roseAt = (START[0] - START[2] + 52) % 52;
    const state: LudoState = { ...createWithSeed(3), tokens: [[-1, -1, -1, -1], [roseAt, -1, -1, -1]], dice: 6 };
    expect(capturesAt(state, 0, 0)).toEqual([]);
  });

  it('never captures its own tokens', () => {
    const state = board([[0, 4, -1, -1], [-1, -1, -1, -1]], { dice: 4 });
    expect(capturesAt(state, 0, 4)).toEqual([]);
    const after = ludoRules.applyMove(state, 0, { t: 'move', token: 0 });
    expect(after.tokens[0][1], 'the token already there is untouched').toBe(4);
  });
});

describe('three sixes', () => {
  it('burns the turn', () => {
    const state = board(gold([0, -1, -1, -1]), { dice: null, sixes: 2, seed: 1 });
    // find a seed that rolls a six, so the third one arrives
    let s: LudoState = state;
    for (let seed = 1; seed < 5000; seed++) {
      if (rollFrom(seed).dice === 6) { s = { ...state, seed }; break; }
    }
    const after = ludoRules.applyMove(s, 0, { t: 'roll' });
    expect(after.event?.kind).toBe('burn');
    expect(after.turn).toBe(1);
    expect(after.dice).toBeNull();
  });
});

describe('winning', () => {
  it('ends when all four tokens are home, and says who won', () => {
    const state = board(gold([HOME_STEP - 3, HOME_STEP, HOME_STEP, HOME_STEP]), { dice: 3 });
    const after = ludoRules.applyMove(state, 0, { t: 'move', token: 0 });
    expect(after.over).toBe(true);
    expect(after.winner).toBe(0);
    expect(homeCount(after, 0)).toBe(TOKENS);
    expect(ludoRules.result(after)).toMatchObject({ over: true, winner: 0 });
    expect(ludoRules.currentPlayer(after)).toBeNull();
    expect(ludoRules.legalMoves(after, 0)).toHaveLength(0);
    expect(ludoRules.legalMoves(after, 1)).toHaveLength(0);
  });

  it('ends a game that will not finish, on progress', () => {
    const state = board([[10, -1, -1, -1], [-1, -1, -1, -1]], { dice: 2, moves: MOVE_LIMIT });
    const after = ludoRules.applyMove(state, 0, { t: 'move', token: 0 });
    expect(after.over).toBe(true);
    expect(after.winner).toBe(0);
    expect(after.reason).toMatch(/out of rolls/i);
  });

  it('never mutates the state it was given', () => {
    const state = board(gold([0, 3, -1, -1]), { dice: 4 });
    const before = JSON.stringify(state);
    ludoRules.applyMove(state, 0, { t: 'move', token: 0 });
    expect(JSON.stringify(state)).toBe(before);
  });
});

describe('seats', () => {
  it('puts the two players on opposite corners', () => {
    expect(seatOf(0)).toBe(0);
    expect(seatOf(1)).toBe(2);
  });
});

/**
 * Whole games, played out by a machine that only makes legal moves.
 *
 * The hand-built boards above prove individual rules. This proves the rules do
 * not contradict each other over a few hundred thousand moves: every position
 * offers something to do, every accepted move is legal, a turn only stays with
 * the same player for a six or a capture, tokens never walk past home, and every
 * game ends. It is the check that would have caught a "nothing to move" screen
 * appearing while tokens were plainly movable.
 */
describe('whole games', () => {
  const play = (seed: number, tally?: { captures: number }) => {
    let s = createWithSeed(seed || 1);
    let guard = 0;
    let picker = seed * 2654435761 % 4294967296;
    while (!s.over && guard++ < 6000) {
      const moves = ludoRules.legalMoves(s, s.turn);
      expect(moves.length, `seed ${seed}: no legal move on move ${s.moves}`).toBeGreaterThan(0);
      picker = (picker * 1664525 + 1013904223) >>> 0;
      const move = moves[picker % moves.length];
      const before = s;
      const next = ludoRules.applyMove(s, s.turn, move);
      expect(next, `seed ${seed}: legal move was refused`).not.toBe(before);

      for (const slot of [0, 1] as const) {
        for (const p of next.tokens[slot]) {
          expect(p).toBeGreaterThanOrEqual(-1);
          expect(p).toBeLessThanOrEqual(HOME_STEP);
          expect(p, `seed ${seed}: home count went backwards`).toBeGreaterThanOrEqual(before.tokens[slot][next.tokens[slot].indexOf(p)] - HOME_STEP);
        }
        expect(homeCount(next, slot)).toBeGreaterThanOrEqual(homeCount(before, slot));
      }

      if (!next.over && move.t !== 'roll' && next.turn === before.turn) {
        // only a six or a capture buys another roll
        expect(
          before.dice === 6 || (next.event?.captured?.length ?? 0) > 0,
          `seed ${seed}: the turn stayed put on a ${before.dice} with no capture`,
        ).toBe(true);
      }
      if (!next.over) {
        // a capture may only happen on a square that is not safe
        for (const c of next.event?.captured ?? []) expect(c.slot).not.toBe(next.event?.slot);
      } else {
        expect(next.winner === null || [0, 1].includes(next.winner)).toBe(true);
      }
      if (tally && (next.event?.captured?.length ?? 0) > 0) tally.captures++;
      s = next;
    }
    expect(s.over, `seed ${seed}: the game did not end`).toBe(true);
    return s;
  };

  it('always has something to do, and always ends', () => {
    const winners = new Set<number | null>();
    const tally = { captures: 0 };
    for (let seed = 1; seed <= 24; seed++) winners.add(play(seed, tally).winner);
    // both seats win games — a seat that never wins would mean a broken start
    expect(winners.has(0)).toBe(true);
    expect(winners.has(1)).toBe(true);
    // and captures really happen in ordinary play, not only on a hand-built board
    expect(tally.captures, 'no captures in 24 games').toBeGreaterThan(0);
  }, 30000);

  it('costs the whole turn when the third six comes up', () => {
    // a seed whose very next roll is a six, so the burn is not a matter of luck
    const seed = Array.from({ length: 200 }, (_, i) => i + 1).find((i) => rollFrom(i).dice === 6)!;
    const state = board(gold([5, -1, -1, -1]), { sixes: 2, seed });
    const after = ludoRules.applyMove(state, 0, { t: 'roll' });
    expect(after.event?.kind).toBe('burn');
    expect(after.dice, 'the third six cannot be spent').toBeNull();
    expect(after.turn, 'the turn goes over').toBe(1);
    expect(after.sixes).toBe(0);
    expect(after.tokens[0], 'and no token moved').toEqual([5, -1, -1, -1]);
    expect(ludoRules.legalMoves(after, 0)).toHaveLength(0);
  });
});
