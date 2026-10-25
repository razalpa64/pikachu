/**
 * Would You Rather — the referee, tested where it can actually go wrong.
 *
 * Four properties carry the game:
 *   1. the roles really do alternate, so neither player is always the guesser;
 *   2. a round scores exactly one point, to exactly one player, and a round where
 *      the chooser never answered scores nobody;
 *   3. while a round is open, neither client is told the other's side (otherwise
 *      the guesser could simply read the answer);
 *   4. the clock advances the game, so an abandoned room still reaches an ending.
 */
import { describe, expect, it } from 'vitest';
import { DILEMMAS } from '../wyr/deck';
import { chooserFor, wyrRules, buildOrder, DEFAULT_WYR, type WyrState, type Side } from '../wyr/rules';
import type { Slot } from '../types';

const config = { ...DEFAULT_WYR, rounds: 6 };

const start = (seed = 4242): WyrState => wyrRules.createInitialState(config, seed) as WyrState;

/** both seats answer, in whichever order, and the round resolves */
function playRound(s: WyrState, a: Side, b: Side): WyrState {
  let next = wyrRules.applyMove(s, 0, { type: 'pick', side: a }) as WyrState;
  next = wyrRules.applyMove(next, 1, { type: 'pick', side: b }) as WyrState;
  return next;
}

/** advance past a reveal window without waiting in real time */
const afterReveal = (s: WyrState) => wyrRules.tick!(s, s.phaseEndsAt + 1) as WyrState;

describe('would you rather', () => {
  it('alternates the chooser every round, starting with seat 0', () => {
    expect([0, 1, 2, 3].map(chooserFor)).toEqual([0, 1, 0, 1]);
  });

  it('gives the point to the guesser when the read lands', () => {
    const s = start();
    // round 0: slot 0 chooses, slot 1 guesses
    const after = playRound(s, 'a', 'a');
    expect(after.phase).toBe('reveal');
    expect(after.score).toEqual([0, 1]);
    expect(after.history[0]).toMatchObject({ chooser: 0, choice: 'a', guess: 'a', hit: true, points: 1 });
  });

  it('gives the point to the chooser when the guess misses', () => {
    const after = playRound(start(), 'a', 'b');
    expect(after.score).toEqual([1, 0]);
    expect(after.history[0]).toMatchObject({ hit: false, points: 0 });
  });

  it('never scores a round the chooser did not answer', () => {
    const s = start();
    let next = wyrRules.applyMove(s, 1, { type: 'pick', side: 'a' }) as WyrState;   // guesser only
    // the clock closes the round
    next = wyrRules.tick!(next, next.phaseEndsAt + 1) as WyrState;
    expect(next.phase).toBe('reveal');
    expect(next.score).toEqual([0, 0]);
    expect(next.history[0]).toMatchObject({ choice: null, hit: false, points: null });
  });

  it('keeps both sides secret until the reveal', () => {
    let s = start();
    s = wyrRules.applyMove(s, 0, { type: 'pick', side: 'b' }) as WyrState;

    const forOne = wyrRules.redact!(s, 1) as WyrState & { lockedIn: [boolean, boolean] };
    // slot 1 is the guesser: it must not see slot 0's answer, but it must know one exists
    expect(forOne.picked[0], 'the chooser answer leaks to the guesser').toBeNull();
    expect(forOne.lockedIn[0]).toBe(true);
    expect(forOne.lockedIn[1]).toBe(false);

    const forZero = wyrRules.redact!(s, 0) as WyrState;
    expect(forZero.picked[0], 'you always see your own pick').toBe('b');

    const done = playRound(s, 'b', 'a');
    const revealed = wyrRules.redact!(done, 1) as WyrState;
    expect(revealed.picked).toEqual(['b', 'a']);
  });

  it('does not let a client read the rounds it has not reached', () => {
    const s = start(7);
    const view = wyrRules.redact!(s, 0) as WyrState & { total: number };
    expect(view.order).toHaveLength(1);
    expect(view.total).toBe(6);
  });

  it('refuses a second answer, a bad side and a pick after the reveal', () => {
    let s = start();
    s = wyrRules.applyMove(s, 0, { type: 'pick', side: 'a' }) as WyrState;
    expect(wyrRules.isLegal(s, 0, { type: 'pick', side: 'b' })).toBe(false);
    expect(wyrRules.isLegal(s, 1, { type: 'pick', side: 'c' })).toBe(false);
    expect(wyrRules.isLegal(s, 1, null)).toBe(false);

    const revealed = playRound(start(), 'a', 'b');
    expect(revealed.phase).toBe('reveal');
    expect(wyrRules.isLegal(revealed, 0, { type: 'pick', side: 'a' })).toBe(false);
    expect(wyrRules.legalMoves(revealed, 0)).toHaveLength(0);
  });

  it('is deterministic from the seed, and only uses real dilemmas', () => {
    const a = buildOrder(99, 6);
    const b = buildOrder(99, 6);
    expect(a).toEqual(b);
    expect(new Set(a).size).toBe(a.length);          // no repeat within a game
    for (const id of a) expect(DILEMMAS.some((d) => d.id === id)).toBe(true);
    // a different seed is a different evening
    expect(buildOrder(100, 6)).not.toEqual(a);
  });

  it('plays a whole game to an ending, with no moves left afterwards', () => {
    let s = start(11);
    let guard = 0;
    while (!wyrRules.result(s).over && guard++ < 200) {
      if (s.phase === 'reveal') { s = afterReveal(s); continue; }
      s = playRound(s, 'a', guard % 2 === 0 ? 'a' : 'b');
    }
    const outcome = wyrRules.result(s);
    expect(outcome.over).toBe(true);
    if (outcome.over) {
      expect(outcome.reason.length).toBeGreaterThan(3);
      expect([0, 1, null]).toContain(outcome.winner);
      const total = s.score[0] + s.score[1];
      expect(total).toBeGreaterThan(0);
      expect(total).toBeLessThanOrEqual(6);
    }
    for (const slot of [0, 1] as Slot[]) {
      expect(wyrRules.legalMoves(s, slot)).toHaveLength(0);
    }
  });
});
