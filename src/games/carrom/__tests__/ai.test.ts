import { describe, expect, it } from 'vitest';
import { chooseShot, scoreShot } from '../ai';
import { BASELINE_Y } from '../physics';
import type { Coin, CoinKind } from '../physics';
import { applyShot, carromRules, createInitial, pocketedOf, type CarromState } from '../rules';
import type { Difficulty } from '../../types';

const mk = (list: [CoinKind, number, number][]): Coin[] =>
  list.map(([kind, x, y], i) => ({ id: i, kind, x, y, alive: true }));
const board = (coins: Coin[], patch: Partial<CarromState> = {}): CarromState => ({ ...createInitial(), coins, ...patch });

describe('the machine plays by the rules', () => {
  it('always returns a shot the referee accepts', () => {
    for (const level of ['beginner', 'casual', 'intermediate', 'advanced', 'expert'] as Difficulty[]) {
      const state = createInitial();
      const shot = chooseShot(state, 0, level);
      expect(carromRules.isLegal(state, 0, shot), `${level} produced an illegal shot`).toBe(true);
    }
  });

  it('is deterministic for the same position', () => {
    const state = createInitial();
    expect(chooseShot(state, 0, 'expert')).toEqual(chooseShot(state, 0, 'expert'));
  });

  it('takes a shot that is there to be taken', () => {
    // one white coin a coin's width from the top-left pocket, nothing in the way
    const state = board(mk([['white', 9.5, 9.5], ['black', 80, 40], ['white', 88, 60]]));
    const shot = chooseShot(state, 0, 'expert');
    const after = applyShot(state, 0, shot);
    expect(after.lastShot?.pocketed, 'the expert missed a sitter').toContain('white');
  });

  it('shoots at its own coins, not the opponent’s', () => {
    const state = board(mk([['white', 9.5, 9.5], ['black', 90.5, 9.5], ['white', 88, 60]]));
    const after = applyShot(state, 0, chooseShot(state, 0, 'expert'));
    expect(after.lastShot?.pocketed).toEqual(['white']);
    expect(pocketedOf(after, 1)).toBe(0);
  });

  it('scores a shot that sinks its own coin above one that touches nothing', () => {
    const coins = mk([['white', 60, 60]]);
    const gifts = scoreShot(board(coins), 0, coins, true, ['white'], false);
    const dud = scoreShot(board(coins), 0, coins, false, [], false);
    expect(gifts).toBeGreaterThan(dud);
  });

  it('uses the baseline it is shooting from', () => {
    const state = createInitial();
    const shot = chooseShot(state, 1, 'casual');
    expect(shot.x).toBeGreaterThan(19);
    expect(shot.x).toBeLessThan(81);
    expect(BASELINE_Y[1]).toBeLessThan(BASELINE_Y[0]);
  });
});
