/**
 * Word Bomb — the fuse, the shape check, and the two ways a match can end.
 *
 * The engine is where the unfairness would hide: a clock that belongs to the
 * client, a word accepted twice, a strike given to the wrong seat. All three are
 * cheap to test and invisible in a screenshot.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WB, checkWord, wordBombRules, type WbState, type WbMove,
} from '../wordbomb/rules';
import { wordsStartingWith } from '../wordbomb/words';

const config = { ...DEFAULT_WB, turnMs: 15_000, strikes: 2, rounds: 8 };
const start = (seed = 1234): WbState => wordBombRules.createInitialState(config, seed) as WbState;

/** a word the referee will accept right now */
const playable = (s: WbState) => wordsStartingWith(s.letter).find((w) => !s.used.includes(w))!;

describe('word bomb', () => {
  it('opens on a real letter, deterministically', () => {
    const a = start(77);
    const b = start(77);
    expect(a.letter).toBe(b.letter);
    expect(a.letter).toMatch(/^[a-z]$/);
    expect(wordsStartingWith(a.letter).length, 'the opening letter must be answerable').toBeGreaterThan(2);
    expect(a.turn).toBe(0);
    expect(a.config.rounds).toBe(8);
  });

  it('accepts a word that fits, scores it, and hands the fuse on by its last letter', () => {
    const s = start();
    const word = playable(s);
    const next = wordBombRules.applyMove(s, 0, { type: 'word', word }) as WbState;

    expect(next.score).toEqual([1, 0]);
    expect(next.used).toEqual([word]);
    expect(next.letter).toBe(word[word.length - 1]);
    expect(next.turn).toBe(1);
    expect(next.turnEndsAt).toBeGreaterThan(Date.now());
    expect(next.history[0]).toMatchObject({ seat: 0, word });
  });

  it('explains exactly why a word is refused', () => {
    const s = start();
    const good = playable(s);
    const wrongLetter = wordsStartingWith('a')[0][0] === s.letter ? wordsStartingWith('b')[0] : wordsStartingWith('a')[0];

    expect(checkWord(s, '')).toMatchObject({ ok: false });
    expect(checkWord(s, 'ab')).toMatchObject({ ok: false, why: expect.stringMatching(/three or more/i) });
    expect(checkWord(s, 'two words')).toMatchObject({ ok: false });
    expect(checkWord(s, 'w0rd')).toMatchObject({ ok: false });
    expect(checkWord(s, wrongLetter)).toMatchObject({ ok: false, why: expect.stringMatching(/start with/i) });

    const withUsed = wordBombRules.applyMove(s, 0, { type: 'word', word: good }) as WbState;
    expect(checkWord({ ...withUsed, letter: good[0], turn: 1 }, good)).toMatchObject({ ok: false, why: expect.stringMatching(/already/i) });
  });

  it('only accepts a move from the seat on turn, and only once', () => {
    const s = start();
    const word = playable(s);
    expect(wordBombRules.isLegal(s, 1, { type: 'word', word })).toBe(false);
    expect(wordBombRules.isLegal(s, 0, { type: 'word', word })).toBe(true);
    expect(wordBombRules.legalMoves(s, 1)).toHaveLength(0);
    expect(wordBombRules.legalMoves(s, 0).length).toBeGreaterThan(0);

    const after = wordBombRules.applyMove(s, 0, { type: 'word', word }) as WbState;
    expect(wordBombRules.isLegal(after, 0, { type: 'word', word: playable(after) })).toBe(false);
  });

  it('strikes the seat that let the clock run out, and gives the bomb a new light', () => {
    const s = start();
    const burnt = wordBombRules.tick!(s, s.turnEndsAt + 1) as WbState;
    expect(burnt.strikes).toEqual([1, 0]);
    expect(burnt.turn).toBe(1);
    expect(burnt.letter).not.toBe(s.letter);
    expect(burnt.history[0]).toMatchObject({ seat: 0, word: null });
    expect(burnt.over).toBe(false);
  });

  it('goes off on the second strike, and the holder loses whatever the score says', () => {
    let s = start();
    s = wordBombRules.applyMove(s, 0, { type: 'word', word: playable(s) }) as WbState;
    const burn = () => { s = wordBombRules.tick!(s, s.turnEndsAt + 1) as WbState; };
    burn();                                    // seat 1 — first strike
    expect(s.strikes).toEqual([0, 1]);
    burn();                                    // seat 0 — first strike
    expect(s.over).toBe(false);
    burn();                                    // seat 1 — out
    expect(s.over).toBe(true);
    expect(s.winner).toBe(0);
    expect(s.reason).toMatch(/held the bomb too long/i);
    expect(wordBombRules.legalMoves(s, 1)).toHaveLength(0);
  });

  it('does not hand the next player the letter that just beat somebody', () => {
    const s = start();
    const burnt = wordBombRules.tick!(s, s.turnEndsAt + 1) as WbState;
    expect(burnt.letter).not.toBe(s.letter);
    expect(wordsStartingWith(burnt.letter).length).toBeGreaterThan(1);
  });

  it('loses the bomb for the seat that holds it, not for the leader', () => {
    let s = start();
    const burn = () => { s = wordBombRules.tick!(s, s.turnEndsAt + 1) as WbState; };
    burn(); burn(); burn(); burn();
    expect(s.over).toBe(true);
    expect(s.winner).not.toBeNull();
  });

  it('ends cleanly when the turns run out', () => {
    let s = start(909);
    let guard = 0;
    while (!s.over && guard++ < 40) {
      const word = playable(s);
      if (!word) break;
      s = wordBombRules.applyMove(s, s.turn, { type: 'word', word }) as WbState;
    }
    expect(s.over, 'a match with a turn limit always finishes').toBe(true);
    expect(s.history.length).toBeLessThanOrEqual(s.config.rounds);
    expect(s.reason.length).toBeGreaterThan(3);
    expect(s.score[0] + s.score[1]).toBeGreaterThan(0);
  });

  it('never mutates the state it is given', () => {
    const s = start();
    const before = JSON.stringify(s);
    const word = playable(s);
    wordBombRules.applyMove(s, 0, { type: 'word', word } as WbMove);
    expect(JSON.stringify(s)).toBe(before);
  });
});
