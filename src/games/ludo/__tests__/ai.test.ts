import { describe, expect, it } from 'vitest';
import { chooseToken, scoreMove } from '../ai';
import { createWithSeed, ludoRules, TOKENS, type LudoState } from '../rules';
import { START } from '../track';
import type { Difficulty } from '../../types';

const board = (tokens: number[][], patch: Partial<LudoState> = {}): LudoState => ({
  ...createWithSeed(11), tokens, ...patch,
});

const LEVELS: Difficulty[] = ['beginner', 'casual', 'intermediate', 'advanced', 'expert'];

describe('the machine chooses legally', () => {
  it('only ever picks a token that can move', () => {
    let state = createWithSeed(2024);
    for (let step = 0; step < 400 && !state.over; step++) {
      const moves = ludoRules.legalMoves(state, state.turn);
      const move = moves[0];
      if (move.t === 'roll' || move.t === 'pass') {
        state = ludoRules.applyMove(state, state.turn, move);
        continue;
      }
      const token = chooseToken(state, state.turn, 'casual');
      expect(token, 'the machine returned no token while one could move').not.toBeNull();
      expect(ludoRules.isLegal(state, state.turn, { t: 'move', token: token! }), `illegal pick at step ${step}`).toBe(true);
      state = ludoRules.applyMove(state, state.turn, { t: 'move', token: token! });
    }
  });

  it('is deterministic for the same position and level', () => {
    const state = board([[-1, 0, 5, -1], [-1, -1, -1, -1]], { dice: 3, turn: 0 });
    for (const level of LEVELS) {
      expect(chooseToken(state, 0, level)).toBe(chooseToken(state, 0, level));
    }
  });

  it('returns nothing when nothing can move', () => {
    const stuck = board([[-1, -1, -1, -1], [-1, -1, -1, -1]], { dice: 4 });
    expect(chooseToken(stuck, 0, 'expert')).toBeNull();
  });
});

describe('the machine plays sensibly', () => {
  it('takes a capture when one is there', () => {
    // gold on 0, rose four squares ahead: a 4 captures, a 1 does not
    const roseAt = (4 + START[0] - START[2] + 52) % 52;
    const state = board([[0, -1, -1, -1], [roseAt, -1, -1, -1]], { dice: 4, turn: 0 });
    expect(chooseToken(state, 0, 'expert')).toBe(0);
  });

  it('would rather bring a token out than shuffle one along', () => {
    const state = board([[0, -1, -1, -1], [-1, -1, -1, -1]], { dice: 6, turn: 0 });
    const token = chooseToken(state, 0, 'expert');
    expect(token).not.toBeNull();
    expect([1, 2, 3]).toContain(token);
  });

  it('scores a capture above a plain step', () => {
    const roseAt = (4 + START[0] - START[2] + 52) % 52;
    const withTarget = board([[0, -1, -1, -1], [roseAt, -1, -1, -1]], { dice: 4, turn: 0 });
    const plain = board([[0, -1, -1, -1], [-1, -1, -1, -1]], { dice: 4, turn: 0 });
    expect(scoreMove(withTarget, 0, 0, 4)).toBeGreaterThan(scoreMove(plain, 0, 0, 4));
  });

  it('prefers landing home', () => {
    const near = board([[55, -1, -1, -1], [-1, -1, -1, -1]], { dice: 1, turn: 0 });
    expect(chooseToken(near, 0, 'expert')).toBe(0);
    expect(scoreMove(near, 0, 0, 1)).toBeGreaterThan(50);
  });

  it('still finishes a game at every level', () => {
    for (const level of LEVELS) {
      let state = createWithSeed(777);
      let steps = 0;
      while (!state.over && steps < 5000) {
        const moves = ludoRules.legalMoves(state, state.turn);
        const move = moves[0];
        const chosen = move.t === 'move'
          ? { t: 'move' as const, token: chooseToken(state, state.turn, level) ?? move.token }
          : move;
        state = ludoRules.applyMove(state, state.turn, chosen);
        steps += 1;
      }
      expect(state.over, `${level} never finished`).toBe(true);
      expect(state.moves).toBeLessThan(MOVES);
    }
  });
});

const MOVES = 400 * 4;

describe('tokens', () => {
  it('are four a side', () => {
    expect(TOKENS).toBe(4);
  });
});
