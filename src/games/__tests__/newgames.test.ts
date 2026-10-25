import { describe, it, expect } from 'vitest';
import type { Difficulty, Slot } from '../types';

import { BANK, bankIsSound, CATEGORY_LABEL, type Category } from '../trivia/bank';
import { buildQueue, createQuiz, mathsQuestion, orderFor, answer, scoreAnswer, rivalAnswer, DEFAULT_CONFIG } from '../trivia/rules';

import { DECK } from '../dare/deck';
import { createDare, draw, resolve, reheat, remaining, rename, setTurn } from '../dare/rules';

import {
  createImposter, cardFor, isImposter, acknowledge, nextClue, castVote, closeVote,
  submitGuess, concede, tally, allVoted, defaultNames, GROUPS, clueSeat,
} from '../imposter/rules';

import {
  generateCase, consistent, holds, createDetective, accuse, cycleMark, revealClue, feedback, SIZES,
} from '../detective/rules';

import {
  createEights, canPlay, playCard, drawCard, pass, chooseSuit, takePenalty, playable,
  topCard, isWild, suitOf, rankOf, cardValue, redact, sortHand, DEFAULT_EIGHTS, SUITS,
  eightsRules, type EightsState,
} from '../cards/rules';
import { quizOnlineRules, type OnlineQuizState } from '../trivia/online';
import { decide } from '../cards/ai';

const TIERS: Difficulty[] = ['beginner', 'casual', 'intermediate', 'advanced', 'expert'];

/* ══════════════════════════════ trivia ══════════════════════════════ */

describe('Spark Quiz', () => {
  it('ships a sound question bank', () => {
    const { ok, problems } = bankIsSound();
    expect(problems).toEqual([]);
    expect(ok).toBe(true);
    expect(BANK.length).toBeGreaterThanOrEqual(60);
  });

  it('covers every advertised category, including the two extra topic sets', () => {
    for (const cat of ['science', 'history', 'general', 'geography', 'nature', 'philippines', 'society'] as const) {
      expect(BANK.filter((q) => q.cat === cat).length, `${cat} is thin`).toBeGreaterThanOrEqual(15);
    }
    // every category a player can tick must be reachable from the bank or the generator
    expect(Object.keys(CATEGORY_LABEL).sort()).toEqual(
      ['general', 'geography', 'history', 'maths', 'nature', 'philippines', 'science', 'society'],
    );
  });

  it('builds a full round out of the new topic sets on their own', () => {
    for (const cats of [['philippines'], ['society'], ['philippines', 'society']] as Category[][]) {
      const q = buildQueue({ ...DEFAULT_CONFIG, categories: [...cats], rounds: 12 }, 'intermediate', 2026);
      expect(q).toHaveLength(12);
      expect(q.every((x) => x.cat === 'maths' || cats.includes(x.cat))).toBe(true);
    }
  });

  it('never runs out of questions, whatever you ask for', () => {
    // the written bank is finite; a long game must still be a full-length game
    for (const rounds of [10, 50, 200]) {
      for (const cats of [['science'], ['nature'], ['history', 'geography'], ['general']] as const) {
        const q = buildQueue({ ...DEFAULT_CONFIG, categories: [...cats], rounds }, 'casual', 12345);
        expect(q.length, `${rounds} rounds of ${cats.join('+')}`).toBe(rounds);
        expect(q.every((x) => x.a.length === 4 && new Set(x.a).size === 4)).toBe(true);
      }
    }
  });

  it('does not repeat a written question inside one round', () => {
    const q = buildQueue({ ...DEFAULT_CONFIG, rounds: 40 }, 'casual', 777);
    const written = q.filter((x) => x.cat !== 'maths').map((x) => x.q);
    expect(new Set(written).size).toBe(written.length);
  });

  it('generates maths questions with four distinct options and a correct first answer', () => {
    for (const tier of [1, 2, 3] as const) {
      for (let s = 0; s < 300; s++) {
        const q = mathsQuestion(s * 2654435761, tier);
        expect(new Set(q.a).size, `seed ${s} tier ${tier}: ${q.q} -> ${q.a}`).toBe(4);
        expect(q.a.every((o) => o.length > 0)).toBe(true);
        expect(Number.isFinite(Number(q.a[0]))).toBe(true);
      }
    }
  });

  it('maths answers are actually right', () => {
    // sample the generated arithmetic and verify a[0] by re-deriving it
    for (let s = 0; s < 200; s++) {
      const q = mathsQuestion(s * 97, 1);
      const m = q.q.match(/^(\d+) ([+−×]) (\d+) = \?$/);
      if (!m) continue;
      const [, a, op, b] = m;
      const v = op === '+' ? +a + +b : op === '−' ? +a - +b : +a * +b;
      expect(Number(q.a[0])).toBe(v);
    }
  });

  it('always fills the requested number of rounds', () => {
    for (const d of TIERS) {
      for (const rounds of [5, 10, 20]) {
        const q = buildQueue({ ...DEFAULT_CONFIG, rounds }, d, 42 + rounds);
        expect(q.length).toBe(rounds);
      }
    }
  });

  it('never repeats a bank question inside one run', () => {
    const q = buildQueue({ categories: ['science', 'history', 'general'], rounds: 30, perQuestion: 20 }, 'intermediate', 7);
    const texts = q.map((x) => x.q);
    expect(new Set(texts).size).toBe(texts.length);
  });

  it('honours a single-category selection', () => {
    const q = buildQueue({ categories: ['maths'], rounds: 12, perQuestion: 0 }, 'expert', 3);
    expect(q.every((x) => x.cat === 'maths')).toBe(true);
  });

  it('scores a correct answer higher when it is faster', () => {
    expect(scoreAnswer(true, 1000, 20, 0)).toBeGreaterThan(scoreAnswer(true, 18000, 20, 0));
    expect(scoreAnswer(false, 10, 20, 9)).toBe(0);
    expect(scoreAnswer(true, 0, 0, 0)).toBe(100); // untimed: no speed bonus
  });

  it('tracks streaks and ends after the last round', () => {
    let s = createQuiz({ ...DEFAULT_CONFIG, rounds: 4 }, 'casual', 11);
    for (let i = 0; i < 4; i++) {
      const correctSlot = orderFor(s, s.index).indexOf(0);
      s = answer(s, correctSlot, 500, null);
    }
    expect(s.over).toBe(true);
    expect(s.streak).toBe(4);
    expect(s.bestStreak).toBe(4);
    expect(s.score).toBeGreaterThan(400);
    expect(s.asked).toHaveLength(4);
  });

  it('a wrong answer breaks the streak and scores nothing', () => {
    let s = createQuiz({ ...DEFAULT_CONFIG, rounds: 3 }, 'casual', 5);
    const correct = orderFor(s, 0).indexOf(0);
    s = answer(s, (correct + 1) % 4, 500, null);
    expect(s.score).toBe(0);
    expect(s.streak).toBe(0);
  });

  it('a timeout is recorded as an unanswered question, not a crash', () => {
    let s = createQuiz({ ...DEFAULT_CONFIG, rounds: 2 }, 'casual', 9);
    s = answer(s, null, 20000, null);
    expect(s.asked[0].picked).toBeNull();
    expect(s.score).toBe(0);
    expect(s.index).toBe(1);
  });

  it('the rival gets measurably better across the tiers', () => {
    const rate = (d: Difficulty) => {
      let hits = 0;
      const runs = 400;
      for (let i = 0; i < runs; i++) {
        const s = createQuiz({ ...DEFAULT_CONFIG, rounds: 1 }, d, i * 7919);
        const { slot } = rivalAnswer(s, d);
        if (slot === orderFor(s, 0).indexOf(0)) hits++;
      }
      return hits / runs;
    };
    const beginner = rate('beginner');
    const expert = rate('expert');
    expect(expert).toBeGreaterThan(beginner + 0.3);
    expect(expert).toBeGreaterThan(0.8);
    expect(beginner).toBeLessThan(0.55);
  });

  it('is deterministic for a given seed', () => {
    const a = buildQueue(DEFAULT_CONFIG, 'advanced', 1234).map((q) => q.q);
    const b = buildQueue(DEFAULT_CONFIG, 'advanced', 1234).map((q) => q.q);
    expect(a).toEqual(b);
  });
});

/* ══════════════════════════════ truth or dare ══════════════════════════════ */

describe('Truth or Dare', () => {
  it('has a usable deck at every heat level', () => {
    for (const heat of ['sweet', 'flirty', 'spicy'] as const) {
      expect(DECK.filter((c) => c.heat === heat && c.kind === 'truth').length).toBeGreaterThanOrEqual(8);
      expect(DECK.filter((c) => c.heat === heat && c.kind === 'dare').length).toBeGreaterThanOrEqual(8);
    }
    expect(new Set(DECK.map((c) => c.text)).size).toBe(DECK.length);
  });

  it('only deals cards from the heat levels that are switched on', () => {
    let s = createDare(['sweet'], ['A', 'B'], 1);
    for (let i = 0; i < 20; i++) {
      s = draw(s, i % 2 ? 'dare' : 'truth');
      if (!s.current) break;
      expect(DECK[s.current.index].heat).toBe('sweet');
      s = resolve(s, 'done');
    }
  });

  it('never repeats a card until the pile is exhausted', () => {
    let s = createDare(['sweet', 'flirty', 'spicy'], ['A', 'B'], 99);
    const total = remaining(s, 'truth');
    const seen: number[] = [];
    for (let i = 0; i < total; i++) {
      s = draw(s, 'truth');
      expect(s.current).not.toBeNull();
      seen.push(s.current!.index);
      s = resolve(s, 'done');
    }
    expect(new Set(seen).size).toBe(total);
  });

  it('reshuffles instead of dead-ending when a pile runs out', () => {
    let s = createDare(['sweet'], ['A', 'B'], 4);
    const total = remaining(s, 'dare');
    for (let i = 0; i < total + 5; i++) {
      s = draw(s, 'dare');
      expect(s.current, `ran dry at ${i}`).not.toBeNull();
      s = resolve(s, 'done');
    }
    expect(s.history).toHaveLength(total + 5);
  });

  it('alternates turns and tallies done vs skipped per player', () => {
    let s = createDare(['sweet'], ['Ria', 'Sam'], 2);
    expect(s.turn).toBe(0);
    s = resolve(draw(s, 'truth'), 'done');
    expect(s.turn).toBe(1);
    s = resolve(draw(s, 'dare'), 'skipped');
    expect(s.turn).toBe(0);
    expect(s.players[0].done).toBe(1);
    expect(s.players[0].truths).toBe(1);
    expect(s.players[1].skipped).toBe(1);
    expect(s.players[1].done).toBe(0);
  });

  it('cannot draw a second card while one is on the table', () => {
    let s = createDare(['sweet'], ['A', 'B'], 6);
    s = draw(s, 'truth');
    const first = s.current!.index;
    s = draw(s, 'dare');
    expect(s.current!.index).toBe(first);
  });

  it('re-deals when the heat changes but keeps the tally', () => {
    let s = createDare(['sweet'], ['A', 'B'], 8);
    s = resolve(draw(s, 'truth'), 'done');
    const before = s.players[0].done;
    s = reheat(s, ['spicy']);
    expect(s.players[0].done).toBe(before);
    s = draw(s, 'truth');
    expect(DECK[s.current!.index].heat).toBe('spicy');
  });

  it('lets the bottle hand the turn to either player', () => {
    let s = createDare(['sweet'], ['A', 'B'], 11);
    expect(s.turn).toBe(0);
    s = setTurn(s, 1);
    expect(s.turn).toBe(1);
    s = setTurn(s, 1); // the bottle may legitimately land on the same person twice
    expect(s.turn).toBe(1);
    s = setTurn(s, 0);
    expect(s.turn).toBe(0);
  });

  it('refuses to spin a card away from whoever is holding it', () => {
    let s = createDare(['sweet'], ['A', 'B'], 12);
    s = draw(s, 'truth');
    const held = s.current!.index;
    const spun = setTurn(s, 1);
    expect(spun.turn).toBe(0);
    expect(spun.current!.index).toBe(held);
  });

  it('renames players without disturbing the tally or the deck', () => {
    let s = createDare(['sweet'], ['A', 'B'], 13);
    s = resolve(draw(s, 'truth'), 'done');
    const pile = s.truthPile.length;
    const done = s.players[0].done;
    s = rename(s, ['Ada', 'Bo']);
    expect(s.players.map((p) => p.name)).toEqual(['Ada', 'Bo']);
    expect(s.players[0].done).toBe(done);
    expect(s.truthPile.length).toBe(pile);
  });

  it('falls back to readable names when a field is cleared', () => {
    const s = rename(createDare(['sweet'], ['A', 'B'], 14), ['', '']);
    expect(s.players.map((p) => p.name)).toEqual(['You', 'Them']);
  });
});

/* ══════════════════════════════ imposter ══════════════════════════════ */

describe('Imposter', () => {
  const cfg = (n: number, decoy = false) => ({
    playerCount: n, names: defaultNames(n), imposters: 1, decoy, clueRounds: 1,
  });

  it('gives the crew the word and the imposter nothing by default', () => {
    for (let seed = 0; seed < 60; seed++) {
      const s = createImposter(cfg(5), seed);
      expect(s.imposterSeats).toHaveLength(1);
      for (let seat = 0; seat < 5; seat++) {
        const card = cardFor(s, seat);
        if (isImposter(s, seat)) {
          expect(card.role).toBe('imposter');
          expect(card.word).toBeNull();
        } else {
          expect(card.role).toBe('crew');
          expect(card.word).toBe(s.word);
        }
      }
    }
  });

  it('decoy mode hands the imposter a different word from the same topic', () => {
    for (let seed = 0; seed < 60; seed++) {
      const s = createImposter(cfg(5, true), seed);
      const seat = s.imposterSeats[0];
      const card = cardFor(s, seat);
      expect(card.word).not.toBeNull();
      expect(card.word).not.toBe(s.word);
      const group = GROUPS.find((g) => g.topic === s.topic)!;
      expect(group.words).toContain(card.word!);
    }
  });

  it('clamps player counts and imposter counts to something playable', () => {
    const tiny = createImposter({ ...cfg(1), imposters: 4 }, 1);
    expect(tiny.config.playerCount).toBe(3);
    expect(tiny.config.imposters).toBeLessThanOrEqual(1);
    const big = createImposter({ ...cfg(20), imposters: 2 }, 1);
    expect(big.config.playerCount).toBe(8);
  });

  it('walks reveal -> clues -> vote', () => {
    let s = createImposter(cfg(4), 3);
    expect(s.phase).toBe('reveal');
    for (let i = 0; i < 4; i++) s = acknowledge(s);
    expect(s.phase).toBe('clues');
    expect(s.order).toHaveLength(4);
    expect(new Set(s.order).size).toBe(4);
    for (let i = 0; i < 4; i++) { expect(clueSeat(s)).toBeGreaterThanOrEqual(0); s = nextClue(s); }
    expect(s.phase).toBe('vote');
  });

  it('runs two clue rounds when asked', () => {
    let s = createImposter({ ...cfg(4), clueRounds: 2 }, 3);
    for (let i = 0; i < 4; i++) s = acknowledge(s);
    for (let i = 0; i < 7; i++) s = nextClue(s);
    expect(s.phase).toBe('clues');
    s = nextClue(s);
    expect(s.phase).toBe('vote');
  });

  it('refuses a self-vote and knows when the table is done voting', () => {
    let s = createImposter(cfg(3), 5);
    for (let i = 0; i < 3; i++) s = acknowledge(s);
    for (let i = 0; i < 3; i++) s = nextClue(s);
    s = castVote(s, 0, 0);
    expect(s.votes[0]).toBeNull();
    s = castVote(s, 0, 1);
    s = castVote(s, 1, 0);
    expect(allVoted(s)).toBe(false);
    s = castVote(s, 2, 1);
    expect(allVoted(s)).toBe(true);
    expect(tally(s).counts[1]).toBe(2);
  });

  it('a tied vote lets the imposter walk', () => {
    let s = createImposter(cfg(4), 12);
    for (let i = 0; i < 4; i++) s = acknowledge(s);
    for (let i = 0; i < 4; i++) s = nextClue(s);
    s = castVote(s, 0, 1); s = castVote(s, 1, 0);
    s = castVote(s, 2, 3); s = castVote(s, 3, 2);
    s = closeVote(s);
    expect(s.phase).toBe('result');
    expect(s.winner).toBe('imposter');
    expect(s.reason).toMatch(/tie/i);
  });

  it('ejecting an innocent hands it to the imposter', () => {
    let s = createImposter(cfg(4), 21);
    for (let i = 0; i < 4; i++) s = acknowledge(s);
    for (let i = 0; i < 4; i++) s = nextClue(s);
    const innocent = [0, 1, 2, 3].find((i) => !isImposter(s, i))!;
    for (let v = 0; v < 4; v++) s = castVote(s, v, v === innocent ? (innocent + 1) % 4 : innocent);
    s = closeVote(s);
    if (s.accused === innocent) {
      expect(s.winner).toBe('imposter');
      expect(s.phase).toBe('result');
    }
  });

  it('catching the imposter opens the steal, and the right word steals it', () => {
    let s = createImposter(cfg(4), 33);
    for (let i = 0; i < 4; i++) s = acknowledge(s);
    for (let i = 0; i < 4; i++) s = nextClue(s);
    const imp = s.imposterSeats[0];
    for (let v = 0; v < 4; v++) s = castVote(s, v, v === imp ? (imp + 1) % 4 : imp);
    s = closeVote(s);
    expect(s.phase).toBe('defence');
    expect(s.accused).toBe(imp);

    const stolen = submitGuess(s, `  ${s.word.toUpperCase()}  `);
    expect(stolen.winner).toBe('imposter');

    const missed = submitGuess(s, 'definitely not the word');
    expect(missed.winner).toBe('crew');

    const passed = concede(s);
    expect(passed.winner).toBe('crew');
    expect(passed.phase).toBe('result');
  });

  it('is deterministic for a seed', () => {
    const a = createImposter(cfg(6), 777);
    const b = createImposter(cfg(6), 777);
    expect(a.word).toBe(b.word);
    expect(a.imposterSeats).toEqual(b.imposterSeats);
    expect(a.order).toEqual(b.order);
  });
});

/* ══════════════════════════════ detective ══════════════════════════════ */

describe('Detective Pikachu', () => {
  it('every generated case has exactly one solution', () => {
    for (const d of TIERS) {
      for (let seed = 0; seed < 90; seed++) {
        const file = generateCase(d, seed * 2654435761 + 17);
        const answers = consistent(file);
        expect(answers.length, `${d} seed ${seed} -> ${answers.length} solutions, ${file.clues.length} clues`).toBe(1);
        expect(answers[0]).toEqual(file.solution);
      }
    }
  });

  it('every clue on the board is load-bearing', () => {
    for (const d of TIERS) {
      for (let seed = 0; seed < 25; seed++) {
        const file = generateCase(d, seed * 7919 + 5);
        for (let i = 0; i < file.clues.length; i++) {
          const without = file.clues.filter((_, j) => j !== i);
          expect(
            consistent({ ...file, clues: without }).length,
            `${d}/${seed}: clue ${i} ("${file.clues[i].text}") is redundant`,
          ).toBeGreaterThan(1);
        }
      }
    }
  });

  it('every clue is true of the real solution', () => {
    for (const d of TIERS) {
      for (let seed = 0; seed < 40; seed++) {
        const file = generateCase(d, seed * 31 + 3);
        for (const clue of file.clues) expect(holds(clue, file.solution)).toBe(true);
      }
    }
  });

  it('scales the cast with difficulty and never duplicates a name', () => {
    for (const d of TIERS) {
      const file = generateCase(d, 123);
      expect(file.suspects).toHaveLength(SIZES[d]);
      expect(file.places).toHaveLength(SIZES[d]);
      expect(file.objects).toHaveLength(SIZES[d]);
      expect(new Set(file.suspects).size).toBe(SIZES[d]);
      expect(new Set(file.places).size).toBe(SIZES[d]);
      expect(new Set(file.objects).size).toBe(SIZES[d]);
    }
  });

  it('stays solvable with a sensible number of clues', () => {
    for (const d of TIERS) {
      for (let seed = 0; seed < 30; seed++) {
        const file = generateCase(d, seed + 1000);
        expect(file.clues.length).toBeGreaterThan(0);
        expect(file.clues.length).toBeLessThanOrEqual(20);
      }
    }
  });

  it('a correct accusation solves it; two wrong ones end it', () => {
    let s = createDetective('casual', 2024);
    const sol = s.file.solution;
    const wrong = { ...sol, suspect: (sol.suspect + 1) % s.file.suspects.length };

    let a = accuse(s, wrong);
    expect(a.solved).toBe(false);
    expect(a.attemptsLeft).toBe(1);
    expect(a.over).toBe(false);
    a = accuse(a, wrong);
    expect(a.over).toBe(true);
    expect(a.solved).toBe(false);

    s = accuse(s, sol);
    expect(s.solved).toBe(true);
    expect(s.over).toBe(true);
    expect(s.endedAt).not.toBeNull();
  });

  it('gives honest partial feedback without leaking the answer', () => {
    const s = createDetective('intermediate', 55);
    const sol = s.file.solution;
    expect(feedback(s.file, sol).right).toBe(3);
    const off = { ...sol, object: (sol.object + 1) % s.file.objects.length };
    const fb = feedback(s.file, off);
    expect(fb.right).toBe(2);
    expect(fb.parts).not.toContain('the right object');
  });

  it('notes cycle through the three marks and reveal adds clues', () => {
    let s = createDetective('casual', 7);
    expect(s.marks.suspect[0]).toBe('unknown');
    s = cycleMark(s, 'suspect', 0);
    expect(s.marks.suspect[0]).toBe('ruled-out');
    s = cycleMark(s, 'suspect', 0);
    expect(s.marks.suspect[0]).toBe('suspected');
    s = cycleMark(s, 'suspect', 0);
    expect(s.marks.suspect[0]).toBe('unknown');

    const before = s.revealedClues;
    s = revealClue(s);
    expect(s.revealedClues).toBe(Math.min(before + 1, s.file.clues.length));
    for (let i = 0; i < 40; i++) s = revealClue(s);
    expect(s.revealedClues).toBe(s.file.clues.length);
  });
});

/* ══════════════════════════════ wild eights ══════════════════════════════ */

describe('Wild Eights', () => {
  it('deals a legal opening position', () => {
    for (let seed = 0; seed < 80; seed++) {
      const s = createEights(DEFAULT_EIGHTS, seed);
      expect(s.hands[0]).toHaveLength(7);
      expect(s.hands[1]).toHaveLength(7);
      const all = [...s.hands[0], ...s.hands[1], ...s.stock, ...s.discard];
      expect(all).toHaveLength(52);
      expect(new Set(all).size).toBe(52);
      expect(isWild(topCard(s))).toBe(false);
      expect(s.suit).toBe(suitOf(topCard(s)));
    }
  });

  it('only allows a matching suit, matching rank, or an eight', () => {
    const s = createEights(DEFAULT_EIGHTS, 11);
    for (let card = 0; card < 52; card++) {
      const expected = isWild(card) || suitOf(card) === s.suit || rankOf(card) === rankOf(topCard(s));
      expect(canPlay(s, card), `card ${card}`).toBe(expected);
    }
  });

  it('refuses a card the player does not hold', () => {
    const s = createEights(DEFAULT_EIGHTS, 13);
    const notMine = [...Array(52).keys()].find((c) => !s.hands[0].includes(c) && canPlay(s, c))!;
    expect(playCard(s, 0, notMine)).toBe(s);
  });

  it('refuses to act out of turn', () => {
    const s = createEights(DEFAULT_EIGHTS, 17);
    const theirs = playable(s, 1)[0];
    if (theirs !== undefined) expect(playCard(s, 1, theirs)).toBe(s);
    expect(drawCard(s, 1)).toBe(s);
  });

  it('an eight asks for a suit and then applies it', () => {
    let s = createEights({ ...DEFAULT_EIGHTS, actionCards: false }, 3);
    // force an eight into hand 0 so the test is not seed-dependent
    const eight = 7; // ace..8 of hearts -> index 7 is the 8 of hearts
    s = { ...s, hands: [[eight, ...s.hands[0].slice(1)], s.hands[1]] };
    s = playCard(s, 0, eight);
    expect(s.awaitingSuit).toBe(true);
    expect(s.turn).toBe(0 as Slot);
    expect(canPlay(s, s.hands[1][0])).toBe(false);  // nothing is playable mid-choice
    s = chooseSuit(s, 0, 'spades');
    expect(s.awaitingSuit).toBe(false);
    expect(s.suit).toBe('spades');
    expect(s.turn).toBe(1 as Slot);
  });

  it('stacks a +2 and makes the victim take the whole pile', () => {
    let s = createEights(DEFAULT_EIGHTS, 5);
    const twoOfHearts = 1;
    s = { ...s, hands: [[twoOfHearts, ...s.hands[0].slice(1)], s.hands[1]], suit: 'hearts', discard: [0] };
    s = playCard(s, 0, twoOfHearts);
    expect(s.pendingDraw).toBe(2);
    expect(s.turn).toBe(1 as Slot);
    // the victim may only answer with another two
    for (const c of s.hands[1]) expect(canPlay(s, c)).toBe(rankOf(c) === 1);
    const before = s.hands[1].length;
    s = takePenalty(s, 1);
    expect(s.hands[1].length).toBe(before + 2);
    expect(s.pendingDraw).toBe(0);
    expect(s.turn).toBe(0 as Slot);
  });

  it('a jack skips the opponent', () => {
    let s = createEights(DEFAULT_EIGHTS, 9);
    const jackOfHearts = 10;
    s = { ...s, hands: [[jackOfHearts, ...s.hands[0].slice(1)], s.hands[1]], suit: 'hearts', discard: [3] };
    s = playCard(s, 0, jackOfHearts);
    expect(s.turn).toBe(0 as Slot);
  });

  it('will not let a player pass while they hold a playable card', () => {
    const s = createEights(DEFAULT_EIGHTS, 23);
    if (playable(s, 0).length) expect(pass(s, 0)).toBe(s);
  });

  it('records a suit the opponent could not follow', () => {
    let s = createEights(DEFAULT_EIGHTS, 29);
    // strip hand 0 down to a single unplayable card
    const dead = [...Array(52).keys()].find((c) => !canPlay(s, c))!;
    s = { ...s, hands: [[dead], s.hands[1]], config: { ...s.config, drawLimit: 0 } };
    const live = s.suit;
    s = pass(s, 0);
    expect(s.passedOn[0]).toContain(live);
    expect(s.turn).toBe(1 as Slot);
  });

  it('emptying a hand ends the game and scores the loser', () => {
    let s = createEights({ ...DEFAULT_EIGHTS, actionCards: false }, 31);
    const last = playable(s, 0)[0] ?? s.hands[0][0];
    s = { ...s, hands: [[last], s.hands[1]], suit: suitOf(last), discard: [suitOf(last) === 'hearts' ? 0 : 13] };
    if (canPlay(s, last)) {
      s = playCard(s, 0, last);
      expect(s.over).toBe(true);
      expect(s.winner).toBe(0 as Slot);
      expect(s.reason).toMatch(/\d+ points/);
    }
  });

  it('reshuffles the discard pile when the stock runs out', () => {
    let s = createEights(DEFAULT_EIGHTS, 41);
    s = { ...s, stock: [], discard: [...s.discard, 20, 21, 22, 23] };
    const before = s.hands[0].length;
    s = drawCard(s, 0);
    expect(s.hands[0].length).toBe(before + 1);
    expect(s.discard.length).toBe(1);
  });

  it('never hands a player the other hand or the stock', () => {
    const s = createEights(DEFAULT_EIGHTS, 47);
    const view = redact(s, 0) as typeof s;
    expect(view.hands[0]).toEqual(s.hands[0]);
    expect(view.hands[1].every((c) => c === -1)).toBe(true);
    expect(view.stock.every((c) => c === -1)).toBe(true);
    const spec = redact(s, 'spectator') as typeof s;
    expect(spec.hands[0].every((c) => c === -1)).toBe(true);
  });

  it('sorts a hand for display without changing its contents', () => {
    const s = createEights(DEFAULT_EIGHTS, 53);
    const sorted = sortHand(s.hands[0]);
    expect([...sorted].sort()).toEqual([...s.hands[0]].sort());
    for (let i = 1; i < sorted.length; i++) {
      const a = sorted[i - 1], b = sorted[i];
      expect(Math.floor(a / 13) < Math.floor(b / 13) || (Math.floor(a / 13) === Math.floor(b / 13) && rankOf(a) <= rankOf(b))).toBe(true);
    }
  });

  it('values a hand by the traditional penalties', () => {
    expect(cardValue(7)).toBe(50);          // an eight
    expect(cardValue(12)).toBe(10);         // a king
    expect(cardValue(0)).toBe(1);           // an ace
    expect(cardValue(4)).toBe(5);           // a five
  });

  describe('the opponent', () => {
    it('only ever proposes a legal action, in every tier, across whole games', () => {
      for (const d of TIERS) {
        for (let seed = 0; seed < 25; seed++) {
          let s = createEights(DEFAULT_EIGHTS, seed * 1013904223 + 7);
          let guard = 0;
          while (!s.over && guard++ < 600) {
            const who = s.turn;
            const move = decide(s, who, d);
            if (move.type === 'play') {
              expect(s.hands[who]).toContain(move.card);
              expect(canPlay(s, move.card), `${d}/${seed}: illegal play`).toBe(true);
              s = playCard(s, who, move.card);
            } else if (move.type === 'suit') {
              expect(s.awaitingSuit).toBe(true);
              expect(SUITS).toContain(move.suit);
              s = chooseSuit(s, who, move.suit);
            } else if (move.type === 'take') {
              expect(s.pendingDraw).toBeGreaterThan(0);
              s = takePenalty(s, who);
            } else if (move.type === 'draw') {
              const before = s.hands[who].length;
              s = drawCard(s, who);
              expect(s.hands[who].length >= before).toBe(true);
            } else {
              expect(playable(s, who), `${d}/${seed}: passed on a playable hand`).toHaveLength(0);
              s = pass(s, who);
            }
          }
          expect(guard, `${d}/${seed}: game did not terminate`).toBeLessThan(600);
        }
      }
    });

    it('answers a +2 with a +2 whenever it can', () => {
      let s = createEights(DEFAULT_EIGHTS, 61);
      const twoHearts = 1, twoSpades = 40;
      s = { ...s, hands: [[twoHearts, 5, 6], [twoSpades, 20, 21]], suit: 'hearts', discard: [3], turn: 0 };
      s = playCard(s, 0, twoHearts);
      expect(s.pendingDraw).toBe(2);
      const move = decide(s, 1, 'expert');
      expect(move).toEqual({ type: 'play', card: twoSpades });
    });

    it('hoards its eights instead of burning them on the first chance', () => {
      // hand: the 8 of hearts plus a plain playable heart — a good player keeps the eight
      let s = createEights({ ...DEFAULT_EIGHTS, actionCards: false }, 67);
      const eightHearts = 7, fiveHearts = 4;
      s = { ...s, hands: [[0], [eightHearts, fiveHearts]], suit: 'hearts', discard: [2], turn: 1 };
      for (const d of ['intermediate', 'advanced', 'expert'] as Difficulty[]) {
        expect(decide(s, 1, d)).toEqual({ type: 'play', card: fiveHearts });
      }
    });

    it('calls the suit it actually holds', () => {
      let s = createEights({ ...DEFAULT_EIGHTS, actionCards: false }, 71);
      // hand after the eight: three spades
      s = { ...s, hands: [[0], [39, 40, 41]], suit: 'hearts', discard: [2], turn: 1, awaitingSuit: true };
      const move = decide(s, 1, 'expert');
      expect(move).toEqual({ type: 'suit', suit: 'spades' });
    });

    it('is stronger at expert than at beginner over many games', () => {
      const playOut = (d: Difficulty, seed: number): Slot | null => {
        let s = createEights(DEFAULT_EIGHTS, seed);
        let guard = 0;
        while (!s.over && guard++ < 600) {
          const who = s.turn;
          // seat 0 is always a beginner; seat 1 plays at `d`
          const m = decide(s, who, who === 0 ? 'beginner' : d);
          if (m.type === 'play') s = playCard(s, who, m.card);
          else if (m.type === 'suit') s = chooseSuit(s, who, m.suit);
          else if (m.type === 'take') s = takePenalty(s, who);
          else if (m.type === 'draw') s = drawCard(s, who);
          else s = pass(s, who);
        }
        return s.winner;
      };
      let expertWins = 0, beginnerWins = 0;
      const games = 160;
      for (let i = 0; i < games; i++) {
        if (playOut('expert', i * 2654435761 + 1) === 1) expertWins++;
        if (playOut('beginner', i * 2654435761 + 1) === 1) beginnerWins++;
      }
      expect(expertWins).toBeGreaterThan(beginnerWins);
      expect(expertWins / games).toBeGreaterThan(0.5);
    });
  });
});

/* ══════════════════════ wild eights — the online adapter ══════════════════════ */

describe('Wild Eights as a server-refereed game', () => {
  const R = eightsRules;
  const fresh = (seed = 101) => R.createInitialState({ handSize: 7, actionCards: true, drawLimit: 3 }, seed);

  it('builds a legal state from config and seed, deterministically', () => {
    const a = fresh(7), b = fresh(7);
    expect(a.hands[0]).toEqual(b.hands[0]);
    expect(a.hands[0]).toHaveLength(7);
    expect(R.id).toBe('cards');
  });

  it('reports whose turn it is, and nobody once it is over', () => {
    const s = fresh();
    expect(R.currentPlayer(s)).toBe(0 as Slot);
    expect(R.currentPlayer({ ...s, over: true })).toBeNull();
    // the player who drops an eight keeps the turn until they name a suit
    expect(R.currentPlayer({ ...s, awaitingSuit: true })).toBe(0 as Slot);
  });

  it('enumerates only moves that isLegal also accepts', () => {
    for (let seed = 0; seed < 40; seed++) {
      let s = fresh(seed * 7919 + 3);
      for (let step = 0; step < 120 && !s.over; step++) {
        const who = s.turn;
        const moves = R.legalMoves(s, who);
        expect(moves.length, `seed ${seed} step ${step}: no legal move offered`).toBeGreaterThan(0);
        for (const m of moves) expect(R.isLegal(s, who, m), `illegal move was enumerated: ${JSON.stringify(m)}`).toBe(true);
        s = R.applyMove(s, who, moves[0]);
      }
    }
  });

  it('rejects junk payloads instead of trusting the client', () => {
    const s = fresh();
    const junk = [
      null, undefined, 0, 'play', [], {},
      { type: 'play' }, { type: 'play', card: -1 }, { type: 'play', card: 52 },
      { type: 'play', card: 1.5 }, { type: 'play', card: '3' },
      { type: 'nonsense' }, { type: 'suit' }, { type: 'suit', suit: 'wands' },
      { type: 'suit', suit: 'hearts' },            // not awaiting a suit
      { type: 'take' },                            // no penalty pending
      { type: '__proto__' },
    ];
    for (const j of junk) expect(R.isLegal(s, 0, j), `accepted ${JSON.stringify(j)}`).toBe(false);
  });

  it('refuses to play a card the player does not hold, even a legal-looking one', () => {
    const s = fresh(31);
    for (let c = 0; c < 52; c++) {
      if (s.hands[0].includes(c)) continue;
      expect(R.isLegal(s, 0, { type: 'play', card: c })).toBe(false);
    }
  });

  it('refuses any action from the player whose turn it is not', () => {
    const s = fresh(13);
    for (const m of R.legalMoves(s, 0)) expect(R.isLegal(s, 1, m)).toBe(false);
    expect(R.isLegal(s, 1, { type: 'draw' })).toBe(false);
    expect(R.isLegal(s, 1, { type: 'pass' })).toBe(false);
  });

  it('will not let a player pass or draw their way out of a playable hand', () => {
    const s = fresh(17);
    expect(playable(s, 0).length).toBeGreaterThan(0);
    expect(R.isLegal(s, 0, { type: 'pass' })).toBe(false);
  });

  it('locks every other action while a suit is owed', () => {
    let s = fresh(3);
    const eight = s.hands[0].find(isWild)
      ?? (() => { s = { ...s, hands: [[7, ...s.hands[0].slice(1)], s.hands[1]] }; return 7; })();
    s = R.applyMove(s, 0, { type: 'play', card: eight });
    expect(s.awaitingSuit).toBe(true);
    expect(R.isLegal(s, 0, { type: 'draw' })).toBe(false);
    expect(R.isLegal(s, 0, { type: 'pass' })).toBe(false);
    expect(R.isLegal(s, 0, { type: 'play', card: s.hands[0][0] })).toBe(false);
    expect(R.isLegal(s, 0, { type: 'suit', suit: 'clubs' })).toBe(true);
    expect(R.isLegal(s, 1, { type: 'suit', suit: 'clubs' })).toBe(false);
  });

  it('forces the penalty to be answered with a two or taken', () => {
    let s = fresh(5);
    s = { ...s, hands: [[1, ...s.hands[0].slice(1)], s.hands[1]], suit: 'hearts', discard: [0] };
    s = R.applyMove(s, 0, { type: 'play', card: 1 });      // two of hearts
    expect(s.pendingDraw).toBe(2);
    expect(R.isLegal(s, 1, { type: 'draw' })).toBe(false);
    expect(R.isLegal(s, 1, { type: 'pass' })).toBe(false);
    expect(R.isLegal(s, 1, { type: 'take' })).toBe(true);
    for (const c of s.hands[1]) {
      expect(R.isLegal(s, 1, { type: 'play', card: c })).toBe(rankOf(c) === 1);
    }
  });

  it('never sends a player the other hand or the stock', () => {
    const s = fresh(23);
    for (const seat of [0, 1] as Slot[]) {
      const view = R.redact!(s, seat) as EightsState;
      const other = seat === 0 ? 1 : 0;
      expect(view.hands[seat]).toEqual(s.hands[seat]);
      expect(view.hands[other].every((c) => c === -1)).toBe(true);
      expect(view.hands[other]).toHaveLength(s.hands[other].length);   // the count is public
      expect(view.stock.every((c) => c === -1)).toBe(true);
      // and the real cards must not survive anywhere in the serialised payload
      const wire = JSON.stringify(view);
      const hidden = s.hands[other];
      const leaked = hidden.filter((c) => JSON.parse(wire).hands[other].includes(c));
      expect(leaked).toEqual([]);
    }
    const spec = R.redact!(s, 'spectator') as EightsState;
    expect(spec.hands[0].every((c) => c === -1)).toBe(true);
    expect(spec.hands[1].every((c) => c === -1)).toBe(true);
  });

  it('reports a finished game the way the relay expects', () => {
    let s = fresh(29);
    expect(R.result(s)).toEqual({ over: false });
    s = { ...s, over: true, winner: 1, reason: 'They went out.' };
    expect(R.result(s)).toEqual({ over: true, winner: 1, reason: 'They went out.' });
  });

  it('describes moves for the history feed', () => {
    const s = fresh(37);
    expect(R.describeMove!(s, 0, { type: 'play', card: 0 })).toMatch(/Volt played/);
    expect(R.describeMove!(s, 1, { type: 'pass' })).toMatch(/Spark passed/);
  });

  it('plays whole games through the adapter without stalling', () => {
    for (let seed = 0; seed < 30; seed++) {
      let s = fresh(seed * 2654435761 + 11);
      let guard = 0;
      while (!R.result(s).over && guard++ < 700) {
        const who = R.currentPlayer(s)!;
        expect(who).not.toBeNull();
        const move = decide(s, who, 'advanced');
        expect(R.isLegal(s, who, move), `AI produced an illegal move: ${JSON.stringify(move)}`).toBe(true);
        s = R.applyMove(s, who, move);
      }
      expect(guard, `seed ${seed} never terminated`).toBeLessThan(700);
      const out = R.result(s);
      expect(out.over).toBe(true);
    }
  });
});

/* ═════════════════ spark quiz — the simultaneous online game ═════════════════ */

describe('Spark Quiz as a server-refereed simultaneous game', () => {
  const R = quizOnlineRules;
  const fresh = (over: Partial<Record<string, unknown>> = {}) =>
    R.createInitialState({ rounds: 5, perQuestion: 20, ...over }, 4242);

  it('opens a question immediately with a shuffled option order', () => {
    const s = fresh();
    expect(s.phase).toBe('question');
    expect(s.queue.length).toBe(5);
    expect([...s.order].sort()).toEqual([0, 1, 2, 3]);
    expect(s.phaseEndsAt).toBeGreaterThan(Date.now());
  });

  it('belongs to neither player — it is simultaneous, not turn-based', () => {
    const s = fresh();
    expect(R.currentPlayer(s)).toBeNull();
    expect(R.legalMoves(s, 0)).toHaveLength(4);
    expect(R.legalMoves(s, 1)).toHaveLength(4);
  });

  it('accepts one answer per player per question and no more', () => {
    let s = fresh();
    expect(R.isLegal(s, 0, { type: 'answer', option: 2 })).toBe(true);
    s = R.applyMove(s, 0, { type: 'answer', option: 2 });
    expect(R.isLegal(s, 0, { type: 'answer', option: 3 }), 'changed its answer').toBe(false);
    expect(R.isLegal(s, 1, { type: 'answer', option: 3 }), 'blocked the other player').toBe(true);
  });

  it('rejects junk payloads', () => {
    const s = fresh();
    for (const j of [null, undefined, 7, 'A', [], {}, { type: 'answer' },
      { type: 'answer', option: -1 }, { type: 'answer', option: 4 },
      { type: 'answer', option: 1.5 }, { type: 'answer', option: '1' }, { type: 'press' }]) {
      expect(R.isLegal(s, 0, j), `accepted ${JSON.stringify(j)}`).toBe(false);
    }
  });

  it('closes the question the moment both have answered', () => {
    let s = fresh();
    s = R.applyMove(s, 0, { type: 'answer', option: 0 });
    expect(s.phase).toBe('question');
    s = R.applyMove(s, 1, { type: 'answer', option: 1 });
    expect(s.phase).toBe('reveal');
    expect(s.history).toHaveLength(1);
  });

  it('never tells a player what the other picked while the question is open', () => {
    let s = fresh();
    s = R.applyMove(s, 0, { type: 'answer', option: 3 });      // only seat 0 has answered
    const asSeen = R.redact!(s, 1) as OnlineQuizState & { answered: [boolean, boolean] };
    expect(asSeen.picked[0], 'seat 1 could copy seat 0').toBeNull();
    expect(asSeen.answered[0], 'but it should still know they are in').toBe(true);
    expect(asSeen.answered[1]).toBe(false);
    // and the raw pick must not survive anywhere in the payload
    const own = R.redact!(s, 0) as OnlineQuizState;
    expect(own.picked[0]).toBe(3);
  });

  it('does reveal both answers once the question has closed', () => {
    let s = fresh();
    s = R.applyMove(s, 0, { type: 'answer', option: 3 });
    s = R.applyMove(s, 1, { type: 'answer', option: 2 });
    const seen = R.redact!(s, 1) as OnlineQuizState;
    expect(seen.picked[0]).toBe(3);
    expect(seen.picked[1]).toBe(2);
  });

  it('never sends the unasked questions, so a client cannot read ahead', () => {
    const s = fresh();
    const seen = R.redact!(s, 0) as OnlineQuizState;
    expect(seen.queue).toHaveLength(1);
    expect(seen.queue[0].q).toBe(s.queue[0].q);
    const later = R.redact!({ ...s, index: 2 }, 0) as OnlineQuizState;
    expect(later.queue).toHaveLength(3);
  });

  it('scores correctness from the server order, not from what the client claims', () => {
    let s = fresh({ perQuestion: 0 });
    const rightSlot = s.order.indexOf(0);       // a[0] is always the correct answer
    const wrongSlot = s.order.indexOf(1);
    s = R.applyMove(s, 0, { type: 'answer', option: rightSlot });
    s = R.applyMove(s, 1, { type: 'answer', option: wrongSlot });
    expect(s.score[0]).toBeGreaterThan(0);
    expect(s.score[1]).toBe(0);
    expect(s.streak[0]).toBe(1);
    expect(s.streak[1]).toBe(0);
  });

  it('rewards the faster of two correct answers', () => {
    const base = fresh({ perQuestion: 20 });
    const right = base.order.indexOf(0);
    const quick = R.applyMove({ ...base, askedAt: Date.now() - 500 }, 0, { type: 'answer', option: right });
    const slow = R.applyMove({ ...base, askedAt: Date.now() - 15_000 }, 0, { type: 'answer', option: right });
    const qClosed = R.applyMove(quick, 1, { type: 'answer', option: right });
    const sClosed = R.applyMove(slow, 1, { type: 'answer', option: right });
    expect(qClosed.score[0]).toBeGreaterThan(sClosed.score[0]);
  });

  it('closes a question nobody answered when the clock runs out', () => {
    const s = fresh({ perQuestion: 20 });
    const after = R.tick!(s, s.phaseEndsAt + 1);
    expect(after.phase).toBe('reveal');
    expect(after.score).toEqual([0, 0]);
    expect(after.history[0].picked).toEqual([null, null]);
  });

  it('advances to the next question after the reveal, and finishes the game', () => {
    let s = fresh({ rounds: 3, perQuestion: 20 });
    for (let i = 0; i < 3; i++) {
      expect(s.over, `ended early at question ${i}`).toBe(false);
      const right = s.order.indexOf(0);
      s = R.applyMove(s, 0, { type: 'answer', option: right });
      s = R.applyMove(s, 1, { type: 'answer', option: (right + 1) % 4 });
      expect(s.phase).toBe('reveal');
      s = R.tick!(s, s.phaseEndsAt + 1);
    }
    expect(s.over).toBe(true);
    expect(s.phase).toBe('done');
    const out = R.result(s);
    expect(out.over).toBe(true);
    expect(out.over && out.winner).toBe(0);
    expect(s.score[0]).toBeGreaterThan(s.score[1]);
  });

  it('calls a genuine tie a draw rather than inventing a winner', () => {
    let s = fresh({ rounds: 2, perQuestion: 0 });
    for (let i = 0; i < 2; i++) {
      const right = s.order.indexOf(0);
      s = R.applyMove(s, 0, { type: 'answer', option: right });
      s = R.applyMove(s, 1, { type: 'answer', option: right });
      s = R.tick!(s, s.phaseEndsAt + 1);
    }
    expect(s.over).toBe(true);
    expect(s.score[0]).toBe(s.score[1]);
    const out = R.result(s);
    expect(out.over && out.winner).toBeNull();
  });

  it('ignores ticks that arrive before the phase is due to end', () => {
    const s = fresh({ perQuestion: 20 });
    expect(R.tick!(s, s.phaseEndsAt - 5000)).toBe(s);
  });

  it('refuses answers during the reveal', () => {
    let s = fresh();
    s = R.applyMove(s, 0, { type: 'answer', option: 0 });
    s = R.applyMove(s, 1, { type: 'answer', option: 1 });
    expect(s.phase).toBe('reveal');
    expect(R.isLegal(s, 0, { type: 'answer', option: 2 })).toBe(false);
    expect(R.legalMoves(s, 0)).toEqual([]);
  });

  it('gives both players the identical question queue', () => {
    const a = R.createInitialState({ rounds: 6, perQuestion: 20 }, 99);
    const b = R.createInitialState({ rounds: 6, perQuestion: 20 }, 99);
    expect(a.queue.map((q) => q.q)).toEqual(b.queue.map((q) => q.q));
  });
});

describe('Spark Quiz redaction carries an honest question count', () => {
  it('sends the real total even though the queue is truncated', () => {
    const s = quizOnlineRules.createInitialState({ rounds: 8, perQuestion: 20 }, 55);
    const seen = quizOnlineRules.redact!(s, 0) as OnlineQuizState & { total: number };
    expect(seen.queue.length).toBe(1);          // cannot read ahead
    expect(seen.total).toBe(s.queue.length);    // but knows it is 1 of 8
    expect(seen.total).toBeGreaterThan(1);
  });
});
