/**
 * Bluff Trivia — the parts that would be a scandal if they were wrong.
 *
 * A hidden-information game has exactly one unforgivable bug: sending the answer
 * to the person who is supposed to be guessing it. Everything else here is
 * scoring arithmetic and deadline behaviour, which are the two ways a party game
 * stops being fun without anybody noticing why.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BLUFF, ballot, bluffRules, bluffable, buildBluffQueue, scoreBallot, type BluffState,
} from '../bluff/rules';

const config = { ...DEFAULT_BLUFF, rounds: 5 };
const start = (seed = 7): BluffState => bluffRules.createInitialState(config, seed) as BluffState;
const answerOf = (s: BluffState) => s.queue[s.index].a[0];

describe('bluff trivia — ballots and scoring', () => {
  it('puts the truth and both lies on one ballot, in an order nobody can predict for free', () => {
    const { options, owner } = ballot('Canberra', ['Sydney', 'Melbourne'], 11, 0);
    expect(options).toHaveLength(3);
    expect(options).toContain('Canberra');
    expect(owner.filter((o) => o === 'truth')).toHaveLength(1);
    expect(new Set(owner).size).toBe(3);
    expect(ballot('Canberra', ['Sydney', 'Melbourne'], 11, 0)).toEqual({ options, owner });
  });

  it('refuses to put the truth on the ballot twice, or the same lie twice', () => {
    expect(ballot('Canberra', ['Canberra', '  canberra. '], 3, 1).options).toHaveLength(1);
    expect(ballot('Canberra', ['Sydney', 'sydney'], 3, 1).options).toHaveLength(2);
    expect(ballot('Canberra', [null, 'Sydney'], 3, 1).options).toHaveLength(2);
  });

  it('pays two for the truth and one per stolen vote', () => {
    const owner: ('truth' | 0 | 1)[] = ['truth', 0, 1];
    expect(scoreBallot(['true', 'a lie', 'another lie'], owner, [0, 1])).toEqual([3, 0]);
    expect(scoreBallot(['true', 'a lie', 'another lie'], owner, [2, 1])).toEqual([1, 1]);
    expect(scoreBallot(['true', 'a lie', 'another lie'], owner, [0, 0])).toEqual([2, 2]);
  });

  it('never pays a player for voting for their own lie', () => {
    const owner: ('truth' | 0 | 1)[] = [0, 'truth', 1];
    expect(scoreBallot(['mine', 'true', 'theirs'], owner, [0, 0])).toEqual([1, 0]);
    expect(scoreBallot(['mine', 'true', 'theirs'], owner, [0, 2]), 'both voted for themselves').toEqual([0, 0]);
  });
});

describe('bluff trivia — the server rules', () => {
  it('opens on a write phase with a real question and nobody a liar yet', () => {
    const s = start();
    expect(s.phase).toBe('write');
    expect(s.lies).toEqual([null, null]);
    expect(s.queue[s.index].q.length).toBeGreaterThan(8);
    expect(bluffable().every((q) => q.cat !== 'maths')).toBe(true);
    expect(buildBluffQueue(5, 7)).toHaveLength(5);
  });

  it('refuses the real answer as a lie, and empty lies', () => {
    const s = start();
    const truth = answerOf(s);
    expect(bluffRules.isLegal(s, 0, { type: 'lie', text: truth })).toBe(false);
    expect(bluffRules.isLegal(s, 0, { type: 'lie', text: `  ${truth.toUpperCase()}  ` })).toBe(false);
    expect(bluffRules.isLegal(s, 0, { type: 'lie', text: '   ' })).toBe(false);
    expect(bluffRules.isLegal(s, 0, { type: 'lie', text: 'x'.repeat(200) })).toBe(false);
    expect(bluffRules.isLegal(s, 0, { type: 'lie', text: 'Sydney' })).toBe(true);
  });

  it('moves to the vote only when both players have written one', () => {
    let s = start();
    s = bluffRules.applyMove(s, 0, { type: 'lie', text: 'Sydney' }) as BluffState;
    expect(s.phase).toBe('write');
    s = bluffRules.applyMove(s, 1, { type: 'lie', text: 'Melbourne' }) as BluffState;
    expect(s.phase).toBe('vote');
    expect(s.options.length).toBe(3);
    expect(s.owner.filter((o) => o === 'truth')).toHaveLength(1);
  });

  it('will not let a player vote for their own invention', () => {
    let s = start();
    s = bluffRules.applyMove(s, 0, { type: 'lie', text: 'Sydney' }) as BluffState;
    s = bluffRules.applyMove(s, 1, { type: 'lie', text: 'Melbourne' }) as BluffState;
    const mine = s.owner.indexOf(0);
    expect(mine).toBeGreaterThanOrEqual(0);
    expect(bluffRules.isLegal(s, 0, { type: 'vote', option: mine })).toBe(false);
    expect(bluffRules.legalMoves(s, 0).map((m) => (m as { option: number }).option)).not.toContain(mine);
    const other = s.owner.findIndex((o) => o !== 0);
    expect(bluffRules.isLegal(s, 0, { type: 'vote', option: other })).toBe(true);
  });

  it('scores the round once both votes are in, and only then', () => {
    let s = start();
    s = bluffRules.applyMove(s, 0, { type: 'lie', text: 'Sydney' }) as BluffState;
    s = bluffRules.applyMove(s, 1, { type: 'lie', text: 'Melbourne' }) as BluffState;
    const truthIndex = s.owner.indexOf('truth');
    s = bluffRules.applyMove(s, 0, { type: 'vote', option: truthIndex }) as BluffState;
    expect(s.phase).toBe('vote');
    expect(s.score).toEqual([0, 0]);
    const notMine = s.owner.findIndex((o) => o !== 1);
    s = bluffRules.applyMove(s, 1, { type: 'vote', option: notMine }) as BluffState;
    expect(s.phase).toBe('reveal');
    expect(s.history).toHaveLength(1);
    expect(s.score[0]).toBeGreaterThan(0);
  });

  it('closes a phase that nobody finishes, so a walk-away loses a round not a match', () => {
    const s = start();
    const afterWrite = bluffRules.tick!(s, s.phaseEndsAt + 1) as BluffState;
    expect(afterWrite.phase).toBe('reveal');
    expect(afterWrite.history).toHaveLength(1);
    expect(afterWrite.history[0].empty).toBe(true);
    const next = bluffRules.tick!(afterWrite, afterWrite.phaseEndsAt + 1) as BluffState;
    expect(next.phase === 'write' || next.over).toBe(true);
  });

  it('closes a vote that only one player finished', () => {
    let s = start();
    s = bluffRules.applyMove(s, 0, { type: 'lie', text: 'Sydney' }) as BluffState;
    s = bluffRules.applyMove(s, 1, { type: 'lie', text: 'Melbourne' }) as BluffState;
    const truth = s.owner.indexOf('truth');
    s = bluffRules.applyMove(s, 0, { type: 'vote', option: truth }) as BluffState;
    expect(s.phase).toBe('vote');
    const closed = bluffRules.tick!(s, s.phaseEndsAt + 1) as BluffState;
    expect(closed.phase).toBe('reveal');
    expect(closed.score[0], 'the player who voted still scores the round').toBeGreaterThan(0);
  });

  it('runs a whole match to a verdict', () => {
    let s = start(99);
    let guard = 0;
    while (!s.over && guard++ < 200) s = bluffRules.tick!(s, s.phaseEndsAt + 1) as BluffState;
    expect(s.over).toBe(true);
    expect(s.history.length).toBe(config.rounds);
    expect(s.reason.length).toBeGreaterThan(5);
  });

  it('never mutates the state it is handed', () => {
    const s = start();
    const before = JSON.stringify(s);
    bluffRules.applyMove(s, 0, { type: 'lie', text: 'Sydney' });
    expect(JSON.stringify(s)).toBe(before);
  });
});

describe('bluff trivia — nothing leaks before the reveal', () => {
  it('hides the opponent’s lie while both are still writing', () => {
    let s = start();
    s = bluffRules.applyMove(s, 0, { type: 'lie', text: 'Sydney' }) as BluffState;
    const seenByOne = bluffRules.redact!(s, 1) as BluffState & { submitted: [boolean, boolean] };
    expect(seenByOne.lies[0]).toBeNull();
    expect(seenByOne.lies[1]).toBeNull();
    expect(seenByOne.submitted).toEqual([true, false]);
  });

  it('strips the answer key and the option owners while the vote is open', () => {
    let s = start();
    s = bluffRules.applyMove(s, 0, { type: 'lie', text: 'Sydney' }) as BluffState;
    s = bluffRules.applyMove(s, 1, { type: 'lie', text: 'Melbourne' }) as BluffState;
    const seen = bluffRules.redact!(s, 0) as BluffState;

    expect(seen.phase).toBe('vote');
    expect(seen.owner, 'owners would immediately identify the truth').toEqual([]);
    expect(seen.queue[seen.index].a.every((a) => a === ''), 'the answer key must be blank').toBe(true);
    expect(seen.queue[seen.index].note).toBeUndefined();
    expect(seen.options.length).toBeGreaterThanOrEqual(2);
    expect(seen.votes[1], 'the opponent’s vote stays hidden').toBeNull();
  });

  it('releases everything at the reveal', () => {
    let s = start();
    s = bluffRules.applyMove(s, 0, { type: 'lie', text: 'Sydney' }) as BluffState;
    s = bluffRules.applyMove(s, 1, { type: 'lie', text: 'Melbourne' }) as BluffState;
    const truthIndex = s.owner.indexOf('truth');
    s = bluffRules.applyMove(s, 0, { type: 'vote', option: truthIndex }) as BluffState;
    const notMine = s.owner.findIndex((o) => o !== 1);
    s = bluffRules.applyMove(s, 1, { type: 'vote', option: notMine }) as BluffState;

    const seen = bluffRules.redact!(s, 0) as BluffState;
    expect(seen.phase).toBe('reveal');
    expect(seen.owner).toEqual(s.owner);
    expect(seen.queue[seen.index].a[0]).toBe(s.queue[s.index].a[0]);
  });
});
