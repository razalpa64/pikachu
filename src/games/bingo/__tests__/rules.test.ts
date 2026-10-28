import { describe, expect, it } from 'vitest';
import {
  BALLS, FREE_INDEX, LINES, ballColumn, ballLabel, ballsLeft, bingoRules, countLines,
  dealCard, dealCards, offer, type BingoState,
} from '../rules';
import type { Slot } from '../../types';

const fresh = (seed = 1234, config: Record<string, unknown> = {}): BingoState =>
  bingoRules.createInitialState(config, seed);

const play = (s: BingoState, index = 0): BingoState =>
  bingoRules.applyMove(s, bingoRules.currentPlayer(s)!, { type: 'pick', index });

describe('cards', () => {
  it('deals a standard card: five per column, in range, free centre', () => {
    const card = dealCard(99);
    expect(card.numbers).toHaveLength(25);
    expect(card.numbers[FREE_INDEX]).toBe(0);
    for (let col = 0; col < 5; col++) {
      const column = [0, 1, 2, 3, 4].map((r) => card.numbers[r * 5 + col]).filter((n) => n !== 0);
      expect(column).toHaveLength(col === 2 ? 4 : 5); // the centre of N is free
      for (const n of column) {
        expect(ballColumn(n), `${n} is in the wrong column`).toBe(col);
        expect(n).toBeGreaterThan(col * 15);
        expect(n).toBeLessThanOrEqual(col * 15 + 15);
      }
      expect(new Set(column).size).toBe(column.length);
    }
  });

  it('is deterministic: the same seed is the same game after a reload', () => {
    expect(dealCard(77).numbers).toEqual(dealCard(77).numbers);
    const [a, b] = dealCards(5);
    const [c, d] = dealCards(5);
    expect(a.numbers).toEqual(c.numbers);
    expect(b.numbers).toEqual(d.numbers);
  });

  it('never gives both players the same card', () => {
    for (let seed = 0; seed < 200; seed++) {
      const [a, b] = dealCards(seed);
      expect(a.numbers).not.toEqual(b.numbers);
    }
  });

  it('names balls the way a caller would', () => {
    expect(ballLabel(1)).toBe('B1');
    expect(ballLabel(15)).toBe('B15');
    expect(ballLabel(16)).toBe('I16');
    expect(ballLabel(45)).toBe('N45');
    expect(ballLabel(75)).toBe('O75');
  });
});

describe('lines', () => {
  it('counts rows, columns and both diagonals', () => {
    const row = Array.from({ length: 25 }, (_, i) => i < 5);
    expect(countLines(row)).toBe(1);
    const full = Array.from({ length: 25 }, () => true);
    expect(countLines(full)).toBe(LINES.length);
    expect(LINES).toHaveLength(12); // 5 rows + 5 columns + 2 diagonals
  });

  it('opens with the free square already marked', () => {
    const s = fresh();
    expect(s.marks[0][FREE_INDEX]).toBe(true);
    expect(s.marks[1][FREE_INDEX]).toBe(true);
    expect(s.lines).toEqual([0, 0]);
  });
});

describe('the turn', () => {
  it('offers exactly two balls to the player on turn, and none to the other seat', () => {
    const s = fresh();
    expect(bingoRules.currentPlayer(s)).toBe(0);
    expect(bingoRules.legalMoves(s, 0)).toHaveLength(2);
    expect(bingoRules.legalMoves(s, 1)).toHaveLength(0);
    expect(offer(s)).toHaveLength(2);
  });

  it('marks the called ball on both cards and hands the turn over', () => {
    const s = fresh();
    const [first] = offer(s);
    const next = play(s, 0);
    expect(next.drawn).toEqual([first]);
    expect(next.turn).toBe(1);
    expect(ballsLeft(next)).toBe(BALLS - 1);
    const card0 = next.cards[0].numbers.indexOf(first);
    if (card0 >= 0) expect(next.marks[0][card0]).toBe(true);
    const card1 = next.cards[1].numbers.indexOf(first);
    if (card1 >= 0) expect(next.marks[1][card1]).toBe(true);
  });

  it('puts the ball nobody called back in the drum', () => {
    const s = fresh();
    const [a, b] = offer(s);
    const next = play(s, 0);
    expect(next.pool).toContain(b);
    expect(next.pool).not.toContain(a);
    expect(next.pool).toHaveLength(BALLS - 1);
  });

  it('rejects a pick from the wrong seat, a junk pick, and a third ball', () => {
    const s = fresh();
    expect(bingoRules.isLegal(s, 1, { type: 'pick', index: 0 })).toBe(false);
    expect(bingoRules.isLegal(s, 0, { type: 'pick', index: 2 })).toBe(false);
    expect(bingoRules.isLegal(s, 0, { type: 'pick', index: -1 })).toBe(false);
    expect(bingoRules.isLegal(s, 0, { type: 'pick', index: 0.5 })).toBe(false);
    expect(bingoRules.isLegal(s, 0, { type: 'draw' } as never)).toBe(false);
    expect(bingoRules.isLegal(s, 0, null)).toBe(false);
    const before = JSON.stringify(s);
    const same = bingoRules.applyMove(s, 1, { type: 'pick', index: 0 });
    expect(JSON.stringify(same)).toBe(before);
    expect(JSON.stringify(s)).toBe(before);
  });

  it('never mutates the state it was given', () => {
    const s = fresh();
    const before = JSON.stringify(s);
    const next = play(s, 1);
    expect(JSON.stringify(s)).toBe(before);
    expect(next).not.toBe(s);
  });
});

describe('winning', () => {
  /** Call balls that only suit seat 0 until it has a line. */
  function steerToLine(seed = 7): BingoState {
    let s = fresh(seed);
    const wanted = new Set(s.cards[0].numbers.filter(Boolean));
    for (let guard = 0; guard < 120 && !s.over; guard++) {
      const idx = s.pool.slice(0, 2).findIndex((ball) => wanted.has(ball));
      s = play(s, idx >= 0 ? idx : 0);
    }
    return s;
  }

  it('ends the game the moment a line completes, and says which ball did it', () => {
    const s = steerToLine();
    expect(s.over).toBe(true);
    expect(s.winner).toBe(0);
    expect(s.reason).toMatch(/B\d+|I\d+|N\d+|G\d+|O\d+/);
    expect(bingoRules.result(s).over).toBe(true);
    expect(bingoRules.currentPlayer(s)).toBeNull();
    expect(bingoRules.legalMoves(s, 0)).toHaveLength(0);
    expect(bingoRules.legalMoves(s, 1)).toHaveLength(0);
  });

  it('finishes a full-house game too, and only when the whole card is marked', () => {
    let s = fresh(21, { pattern: 'full' });
    expect(s.pattern).toBe('full');
    let guard = 0;
    while (!s.over && guard++ < 200) s = play(s, 0);
    expect(s.over).toBe(true);
    const seat = s.winner as Slot;
    expect(seat === null || s.marks[seat].every(Boolean)).toBe(true);
    if (seat === null) expect(s.reason).toMatch(/drum/i);
  });

  it('always terminates: the drum loses a ball every turn', () => {
    let s = fresh(3);
    let turns = 0;
    while (!s.over && turns++ < 200) s = play(s, 0);
    expect(s.over).toBe(true);
    expect(turns).toBeLessThanOrEqual(BALLS);
  });
});
