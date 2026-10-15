import { describe, expect, it } from 'vitest';
import {
  sketchRules as R, pickWords, maskOf, isHit, normalise, pointsFor,
  PALETTE, BRUSHES, MAX_POINTS, MAX_STROKES, DRAW_MS, WORD_BANK,
  type SketchState,
} from '../sketch/rules';

const mk = (rounds = 4, seed = 12345) => R.createInitialState({ rounds }, seed) as SketchState;

describe('Guess & Draw — word bank', () => {
  it('only contains lowercase, drawable, text-free words', () => {
    for (const tier of WORD_BANK) {
      for (const w of tier) {
        expect(w, `"${w}" should be lowercase`).toBe(w.toLowerCase());
        expect(w.trim(), `"${w}" has stray whitespace`).toBe(w);
        expect(/^[a-z ]+$/.test(w), `"${w}" has characters you cannot draw`).toBe(true);
      }
    }
  });

  it('has no duplicates across tiers', () => {
    const all = WORD_BANK.flat();
    expect(new Set(all).size).toBe(all.length);
  });

  it('picks distinct words and ramps difficulty', () => {
    for (const seed of [1, 7, 99, 40321]) {
      const words = pickWords(8, seed);
      expect(words).toHaveLength(8);
      expect(new Set(words).size, `seed ${seed} repeated a word`).toBe(8);
      // the last word should come from a harder tier than the first
      const tierOf = (w: string) => WORD_BANK.findIndex((t) => t.includes(w));
      expect(tierOf(words[7])).toBeGreaterThanOrEqual(tierOf(words[0]));
    }
  });

  it('never runs short even past the bank size', () => {
    const words = pickWords(12, 5);
    expect(words).toHaveLength(12);
    expect(new Set(words).size).toBe(12);
  });

  it('is deterministic for a seed', () => {
    expect(pickWords(6, 777)).toEqual(pickWords(6, 777));
    expect(pickWords(6, 777)).not.toEqual(pickWords(6, 778));
  });
});

describe('Guess & Draw — guess matching', () => {
  it('accepts the exact word regardless of case and punctuation', () => {
    expect(isHit('Umbrella', 'umbrella')).toBe(true);
    expect(isHit('  umbrella!  ', 'umbrella')).toBe(true);
    expect(isHit('ICE CREAM CONE', 'ice cream cone')).toBe(true);
  });

  it('forgives a single typo on longer words', () => {
    expect(isHit('umbrela', 'umbrella')).toBe(true);     // dropped letter
    expect(isHit('umbrellla', 'umbrella')).toBe(true);   // doubled letter
    expect(isHit('umbrelka', 'umbrella')).toBe(true);    // wrong letter
  });

  it('does NOT forgive a typo on a short word, where it would be a different word', () => {
    expect(isHit('bat', 'cat')).toBe(false);
    expect(isHit('car', 'cat')).toBe(false);
    expect(isHit('sun', 'fun')).toBe(false);
  });

  it('accepts dropping a leading article', () => {
    expect(isHit('grapes', 'bunch of grapes')).toBe(true);
    expect(isHit('glasses', 'pair of glasses')).toBe(true);
  });

  it('rejects empty and unrelated guesses', () => {
    expect(isHit('', 'cat')).toBe(false);
    expect(isHit('   ', 'cat')).toBe(false);
    expect(isHit('helicopter', 'cat')).toBe(false);
  });

  it('normalise collapses whitespace and strips symbols', () => {
    expect(normalise('  Hot   AIR-balloon!! ')).toBe('hot airballoon');
  });
});

describe('Guess & Draw — the word is hidden information', () => {
  it('masks the word with underscores, preserving word breaks', () => {
    expect(maskOf('cat')).toBe('___');
    expect(maskOf('ice cream cone')).toBe('___ _____ ____');
  });

  it('never sends the word bank to anyone', () => {
    const s = mk();
    for (const who of [0, 1, 'spectator'] as const) {
      const r = R.redact!(s, who) as SketchState;
      expect(r.words, `${who} received the bank`).toEqual([]);
    }
  });

  it('gives the word to the drawer and withholds it from the guesser', () => {
    const s = mk();
    const drawer = R.redact!(s, s.drawer) as SketchState;
    const guesser = R.redact!(s, (s.drawer === 0 ? 1 : 0)) as SketchState;
    expect(drawer.word).toBe(s.words[0]);
    expect(guesser.word).toBeNull();
    expect(guesser.hint).toBe(maskOf(s.words[0]));
  });

  it('withholds the word from a spectator too, while the round is live', () => {
    const s = mk();
    expect((R.redact!(s, 'spectator') as SketchState).word).toBeNull();
  });

  it('reveals the word to everyone once the round is over', () => {
    let s = mk();
    s = R.applyMove(s, s.drawer, { t: 'skip' });
    expect(s.phase).toBe('reveal');
    for (const who of [0, 1, 'spectator'] as const) {
      expect((R.redact!(s, who) as SketchState).word).toBe(s.words[0]);
    }
  });

  it('does not leak the word through the guess log', () => {
    const s = mk();
    const guesser = (s.drawer === 0 ? 1 : 0) as 0 | 1;
    const after = R.applyMove(s, guesser, { t: 'guess', text: 'something wrong' });
    const seen = R.redact!(after, guesser) as SketchState;
    expect(JSON.stringify(seen)).not.toContain(s.words[0]);
  });
});

describe('Guess & Draw — legality is server-side', () => {
  it('only the drawer may draw, and only while drawing', () => {
    const s = mk();
    const other = (s.drawer === 0 ? 1 : 0) as 0 | 1;
    const stroke = { t: 'stroke' as const, p: [10, 10, 20, 20], c: 0, w: 1 };
    expect(R.isLegal(s, s.drawer, stroke)).toBe(true);
    expect(R.isLegal(s, other, stroke)).toBe(false);
    const revealed = R.applyMove(s, s.drawer, { t: 'skip' });
    expect(R.isLegal(revealed, revealed.drawer, stroke)).toBe(false);
  });

  it('only the guesser may guess', () => {
    const s = mk();
    const other = (s.drawer === 0 ? 1 : 0) as 0 | 1;
    expect(R.isLegal(s, other, { t: 'guess', text: 'cat' })).toBe(true);
    expect(R.isLegal(s, s.drawer, { t: 'guess', text: 'cat' })).toBe(false);
  });

  it('rejects malformed stroke payloads rather than trusting the client', () => {
    const s = mk();
    const d = s.drawer;
    const bad: unknown[] = [
      null, undefined, 42, 'stroke', {},
      { t: 'stroke', p: [1, 2], c: 99, w: 0 },                 // colour out of range
      { t: 'stroke', p: [1, 2], c: 0, w: 99 },                 // brush out of range
      { t: 'stroke', p: [1, 2, 3], c: 0, w: 0 },               // odd length
      { t: 'stroke', p: [], c: 0, w: 0 },                      // empty
      { t: 'stroke', p: [-5, 10], c: 0, w: 0 },                // off canvas
      { t: 'stroke', p: [10, 1001], c: 0, w: 0 },              // off canvas
      { t: 'stroke', p: ['a', 'b'], c: 0, w: 0 },              // not numbers
      { t: 'stroke', p: [NaN, 1], c: 0, w: 0 },                // NaN
      { t: 'stroke', p: Array(MAX_POINTS * 2 + 4).fill(1), c: 0, w: 0 },  // too many points
      { t: 'nonsense' },
    ];
    for (const m of bad) expect(R.isLegal(s, d, m), `accepted ${JSON.stringify(m)}`).toBe(false);
    expect(R.isLegal(s, d, { t: 'stroke', p: [0, 0, 1000, 1000], c: PALETTE.length - 1, w: BRUSHES.length - 1 })).toBe(true);
  });

  it('refuses an empty guess and caps the length', () => {
    const s = mk();
    const g = (s.drawer === 0 ? 1 : 0) as 0 | 1;
    expect(R.isLegal(s, g, { t: 'guess', text: '' })).toBe(false);
    expect(R.isLegal(s, g, { t: 'guess', text: '   ' })).toBe(false);
    expect(R.isLegal(s, g, { t: 'guess', text: '!!!' })).toBe(false);
    expect(R.isLegal(s, g, { t: 'guess', text: 'x'.repeat(65) })).toBe(false);
  });

  it('caps the stroke count so a client cannot flood the room', () => {
    let s = mk();
    const d = s.drawer;
    for (let i = 0; i < MAX_STROKES; i++) s = R.applyMove(s, d, { t: 'stroke', p: [1, 1, 2, 2], c: 0, w: 0 });
    expect(s.strokes).toHaveLength(MAX_STROKES);
    expect(R.isLegal(s, d, { t: 'stroke', p: [1, 1, 2, 2], c: 0, w: 0 })).toBe(false);
  });

  it('undo and clear need something to remove', () => {
    const s = mk();
    expect(R.isLegal(s, s.drawer, { t: 'undo' })).toBe(false);
    const drawn = R.applyMove(s, s.drawer, { t: 'stroke', p: [1, 1, 2, 2], c: 0, w: 0 });
    expect(R.isLegal(drawn, drawn.drawer, { t: 'undo' })).toBe(true);
    expect(R.applyMove(drawn, drawn.drawer, { t: 'clear' }).strokes).toEqual([]);
  });
});

describe('Guess & Draw — scoring and flow', () => {
  it('a correct guess scores both players and ends the round', () => {
    const s = mk();
    const g = (s.drawer === 0 ? 1 : 0) as 0 | 1;
    const after = R.applyMove(s, g, { t: 'guess', text: s.words[0] });
    expect(after.phase).toBe('reveal');
    expect(after.solvedBy).toBe(g);
    expect(after.scores[g]).toBeGreaterThan(0);
    expect(after.scores[s.drawer]).toBeGreaterThan(0);
    expect(after.scores[g], 'the guesser should out-score the drawer').toBeGreaterThan(after.scores[s.drawer]);
  });

  it('a wrong guess costs nothing and keeps the round open', () => {
    const s = mk();
    const g = (s.drawer === 0 ? 1 : 0) as 0 | 1;
    const after = R.applyMove(s, g, { t: 'guess', text: 'definitely not it' });
    expect(after.phase).toBe('draw');
    expect(after.scores).toEqual([0, 0]);
    expect(after.guesses.at(-1)!.hit).toBe(false);
  });

  it('a faster guess is worth more', () => {
    const fast = pointsFor(DRAW_MS);
    const slow = pointsFor(1000);
    expect(fast.guesser).toBeGreaterThan(slow.guesser);
    expect(slow.guesser).toBeGreaterThanOrEqual(5);
  });

  it('swaps the drawer every round and gives a fresh canvas', () => {
    let s = mk(4);
    const first = s.drawer;
    s = R.applyMove(s, s.drawer, { t: 'stroke', p: [1, 1, 2, 2], c: 0, w: 0 });
    s = R.applyMove(s, s.drawer, { t: 'skip' });
    s = R.applyMove(s, 0, { t: 'next' });
    expect(s.drawer).not.toBe(first);
    expect(s.round).toBe(1);
    expect(s.strokes).toEqual([]);
    expect(s.guesses).toEqual([]);
    expect(s.phase).toBe('draw');
  });

  it('both players draw an equal number of times over an even match', () => {
    let s = mk(6);
    const drew = [0, 0];
    for (let i = 0; i < 6; i++) {
      drew[s.drawer] += 1;
      s = R.applyMove(s, s.drawer, { t: 'skip' });
      if (!s.over) s = R.applyMove(s, 0, { t: 'next' });
    }
    expect(drew[0]).toBe(drew[1]);
  });

  it('ends after the configured rounds and names a winner', () => {
    let s = mk(4);
    for (let i = 0; i < 4 && !s.over; i++) {
      const g = (s.drawer === 0 ? 1 : 0) as 0 | 1;
      if (i < 3) s = R.applyMove(s, g, { t: 'guess', text: s.words[s.round] });
      else s = R.applyMove(s, s.drawer, { t: 'skip' });
      if (!s.over) s = R.applyMove(s, 0, { t: 'next' });
    }
    expect(s.over).toBe(true);
    expect(s.phase).toBe('done');
    const r = R.result(s);
    expect(r.over).toBe(true);
  });

  it('a tie is a draw, not a win', () => {
    let s = mk(2);
    // nobody scores: both rounds time out
    for (let i = 0; i < 2 && !s.over; i++) {
      s = R.applyMove(s, s.drawer, { t: 'skip' });
      if (!s.over) s = R.applyMove(s, 0, { t: 'next' });
    }
    expect(s.over).toBe(true);
    expect(s.winner).toBeNull();
    expect(R.result(s)).toEqual({ over: true, winner: null, reason: expect.any(String) });
  });

  it('nobody may act once the match is over', () => {
    let s = mk(2);
    for (let i = 0; i < 2 && !s.over; i++) {
      s = R.applyMove(s, s.drawer, { t: 'skip' });
      if (!s.over) s = R.applyMove(s, 0, { t: 'next' });
    }
    expect(s.over).toBe(true);
    for (const p of [0, 1] as const) {
      expect(R.isLegal(s, p, { t: 'stroke', p: [1, 1, 2, 2], c: 0, w: 0 })).toBe(false);
      expect(R.isLegal(s, p, { t: 'guess', text: 'cat' })).toBe(false);
      expect(R.isLegal(s, p, { t: 'next' })).toBe(false);
    }
  });

  it('the clock ends a round on its own and rolls into the next', () => {
    const s = mk(4);
    const expired = R.tick!(s, s.endsAt + 1);
    expect(expired.phase).toBe('reveal');
    expect(expired.word).toBe(s.words[0]);
    expect(expired.solvedBy).toBeNull();
    const rolled = R.tick!(expired, expired.endsAt + 1);
    expect(rolled.phase).toBe('draw');
    expect(rolled.round).toBe(1);
  });

  it('tick is a no-op before the deadline', () => {
    const s = mk();
    expect(R.tick!(s, s.endsAt - 5000)).toBe(s);
  });

  it('never mutates the state it is given', () => {
    const s = mk();
    const snap = JSON.stringify(s);
    R.applyMove(s, s.drawer, { t: 'stroke', p: [1, 1, 2, 2], c: 0, w: 0 });
    R.applyMove(s, (s.drawer === 0 ? 1 : 0) as 0 | 1, { t: 'guess', text: s.words[0] });
    R.tick!(s, s.endsAt + 1);
    expect(JSON.stringify(s)).toBe(snap);
  });
});
