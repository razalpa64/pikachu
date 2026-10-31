import { describe, expect, it } from 'vitest';
import {
  DIALS, ROUNDS, STRIKES, SYMBOL_DIGIT, betweenUsRules, codeOf, createInitial, isCorrect, viewFor,
  type BetweenUsState,
} from '../rules';

const start = (seed = 42) => createInitial(seed);
const turnDial = (s: BetweenUsState, index: number, delta: number) =>
  betweenUsRules.applyMove(s, 1, { t: 'dial', index, delta }) as BetweenUsState;
const pull = (s: BetweenUsState) => betweenUsRules.applyMove(s, 1, { t: 'pull' }) as BetweenUsState;

/** Set all three dials to the code by turning them, exactly as a player would. */
const solve = (s: BetweenUsState): BetweenUsState => {
  let out = s;
  codeOf(out).forEach((digit, i) => {
    for (let k = 0; k < digit; k++) out = turnDial(out, i, 1);
  });
  return out;
};

describe('the room', () => {
  it('opens on round one, with every dial at zero and nobody struck', () => {
    const s = start();
    expect(s.round).toBe(1);
    expect(s.rounds).toBe(ROUNDS);
    expect(s.dials).toEqual([0, 0, 0]);
    expect(s.strikes).toBe(0);
    expect(s.over).toBe(false);
    expect(s.code).toHaveLength(DIALS);
  });

  it('gives three different glyphs, so no round is solvable by a lucky guess', () => {
    for (let seed = 1; seed < 200; seed++) {
      const s = start(seed);
      expect(new Set(s.code).size).toBe(DIALS);
      for (const g of s.code) expect(g).toBeGreaterThanOrEqual(0), expect(g).toBeLessThan(SYMBOL_DIGIT.length);
    }
  });

  it('is the same room again from the same seed', () => {
    expect(start(7).code).toEqual(start(7).code);
    expect(start(7).code).not.toEqual(start(8).code);
  });
});

describe('the two stations', () => {
  it('will not let the listener touch the console', () => {
    const s = start();
    expect(betweenUsRules.isLegal(s, 0, { t: 'dial', index: 0, delta: 1 })).toBe(false);
    expect(betweenUsRules.isLegal(s, 0, { t: 'pull' })).toBe(false);
    expect(betweenUsRules.applyMove(s, 0, { t: 'dial', index: 0, delta: 1 })).toBe(s);
    expect(betweenUsRules.applyMove(s, 0, { t: 'pull' })).toBe(s);
  });

  it('gives the operator a console', () => {
    const s = start();
    expect(betweenUsRules.isLegal(s, 1, { t: 'dial', index: 0, delta: 1 })).toBe(true);
    expect(betweenUsRules.isLegal(s, 1, { t: 'pull' })).toBe(true);
  });

  it('refuses a dial that does not exist, and junk', () => {
    const s = start();
    for (const index of [-1, 3, 9, 1.5, NaN]) {
      expect(betweenUsRules.isLegal(s, 1, { t: 'dial', index, delta: 1 }), `accepted index ${index}`).toBe(false);
    }
    for (const junk of [null, undefined, 'pull', 42, {}]) {
      expect(betweenUsRules.isLegal(s, 1, junk as never), `accepted ${String(junk)}`).toBe(false);
    }
  });
});

describe('the dials', () => {
  it('wrap round from 7 to 0 and back, like a real dial with eight positions', () => {
    let s = start();
    for (let i = 0; i < 8; i++) s = turnDial(s, 0, 1);
    expect(s.dials[0]).toBe(0);
    s = turnDial(s, 0, -1);
    expect(s.dials[0]).toBe(7);
  });

  it('do not touch the other two', () => {
    const s = turnDial(start(), 1, 1);
    expect(s.dials).toEqual([0, 1, 0]);
  });
});

describe('carrying a frequency', () => {
  it('is right when the dials spell the code', () => {
    const s = start();
    expect(isCorrect(s)).toBe(false);
    expect(isCorrect(solve(s))).toBe(true);
  });

  it('moves to the next round, with new glyphs and reset dials', () => {
    const first = start();
    const after = pull(solve(first));
    expect(after.round).toBe(2);
    expect(after.dials).toEqual([0, 0, 0]);
    expect(after.code).not.toEqual(first.code);
    expect(after.over).toBe(false);
    expect(after.strikes).toBe(0);
  });

  it('takes exactly three to open the door, and then the game is over', () => {
    let s = start();
    for (let round = 1; round <= ROUNDS; round++) {
      expect(s.round).toBe(round);
      s = pull(solve(s));
    }
    expect(s.solved).toBe(true);
    expect(s.over).toBe(true);
    expect(betweenUsRules.result(s)).toMatchObject({ over: true });
    expect(s.reason).toMatch(/door is open/i);
  });
});

describe('a wrong pull', () => {
  it('costs a strike but not the round', () => {
    const s = pull(start());
    expect(s.strikes).toBe(1);
    expect(s.round).toBe(1);
    expect(s.over).toBe(false);
    expect(s.event?.kind).toBe('wrong');
  });

  it('ends the run on the third one', () => {
    let s = start();
    for (let i = 0; i < STRIKES; i++) {
      expect(s.over).toBe(false);
      s = pull(s);
    }
    expect(s.strikes).toBe(STRIKES);
    expect(s.over).toBe(true);
    expect(s.solved).toBe(false);
    expect(s.reason).toMatch(/went dark/i);
  });

  it('cannot be undone by a later correct pull on the same round', () => {
    const s = pull(solve(pull(start())));
    expect(s.strikes).toBe(1);
    expect(s.round).toBe(2);
  });
});

describe('what each player is allowed to see', () => {
  it('gives the listener the glyphs and no legend', () => {
    const s = start();
    const v = viewFor(s, 0);
    expect(v.station).toBe('listener');
    expect(v.code).toEqual(s.code);
    expect(v.legend).toEqual([]);
  });

  it('gives the operator the legend and no glyphs — the whole game', () => {
    const s = start();
    const v = viewFor(s, 1);
    expect(v.station).toBe('operator');
    expect(v.code).toEqual([]);
    expect(v.legend).toEqual([...SYMBOL_DIGIT]);
    // and nothing else in the view spells out the answer
    const wire = JSON.stringify(v);
    for (const digit of codeOf(s)) {
      expect(wire.includes(`'code':[${digit}`)).toBe(false);
    }
  });

  it('never sends the answer to the operator, whatever the round', () => {
    let s = start(9);
    for (let round = 1; round <= ROUNDS; round++) {
      const wire = JSON.stringify(viewFor(s, 1));
      const answer = codeOf(s).join(',');
      expect(wire.includes(`"code":[${answer}]`)).toBe(false);
      s = pull(solve(s));
    }
  });

  it('gives a spectator neither half', () => {
    const v = viewFor(start(), 'spectator');
    expect(v.code).toEqual([]);
    expect(v.legend).toEqual([]);
  });

  it('tells both players the dials, the strikes and how many rounds are left', () => {
    const s = turnDial(start(), 2, 1);
    for (const slot of [0, 1] as const) {
      const v = viewFor(s, slot);
      expect(v.dials).toEqual([0, 0, 1]);
      expect(v.strikesLeft).toBe(STRIKES);
      expect(v.rounds).toBe(ROUNDS);
    }
  });
});

describe('the referee contract', () => {
  it('never mutates the state it was handed', () => {
    const s = start();
    const before = JSON.stringify(s);
    betweenUsRules.applyMove(s, 1, { t: 'dial', index: 0, delta: 1 });
    betweenUsRules.applyMove(s, 1, { t: 'pull' });
    expect(JSON.stringify(s)).toBe(before);
  });

  it('stops accepting moves once the room is dark', () => {
    let s = start();
    for (let i = 0; i < STRIKES; i++) s = pull(s);
    expect(betweenUsRules.isLegal(s, 1, { t: 'pull' })).toBe(false);
    expect(betweenUsRules.applyMove(s, 1, { t: 'dial', index: 0, delta: 1 })).toBe(s);
  });

  it('is registered for the relay under the id the catalogue uses', () => {
    expect(betweenUsRules.id).toBe('betweenus');
  });
});
