/**
 * Signing in on a second device has to move the career across — and must never move
 * it *backwards*. `fetchRemoteUserData` always returned per-game stats; nothing
 * consumed them, so a new device showed an empty profile until this merge existed.
 */
import { describe, it, expect } from 'vitest';
import { emptyProgress, mergeRemoteStats } from '../progress';

const local = () => {
  const p = emptyProgress();
  p.stats.chess = { played: 9, wins: 6, losses: 3, draws: 0, best: 3 };
  p.stats.reversi = { played: 2, wins: 1, losses: 1, draws: 0, best: 0 };
  return p;
};

describe('mergeRemoteStats', () => {
  it('takes the better of each field, not the cloud row wholesale', () => {
    const out = mergeRemoteStats(local(), {
      chess: { played: 4, wins: 2, losses: 2, draws: 0, best: 1 },   // older cloud row
      reversi: { played: 12, wins: 8, losses: 4, draws: 0, best: 2 }, // newer cloud row
    });
    expect(out.stats.chess).toEqual({ played: 9, wins: 6, losses: 3, draws: 0, best: 3 });
    expect(out.stats.reversi).toEqual({ played: 12, wins: 8, losses: 4, draws: 0, best: 2 });
  });

  it('adds a game the device has never played', () => {
    const out = mergeRemoteStats(local(), { mancala: { played: 5, wins: 5, losses: 0, draws: 0, best: 0 } });
    expect(out.stats.mancala).toEqual({ played: 5, wins: 5, losses: 0, draws: 0, best: 0 });
  });

  it('returns the same object when there is nothing to change', () => {
    const p = local();
    expect(mergeRemoteStats(p, { chess: { played: 1, wins: 1, losses: 0, draws: 0, best: 0 } })).toBe(p);
    expect(mergeRemoteStats(p, null)).toBe(p);
    expect(mergeRemoteStats(p, {})).toBe(p);
  });

  it('survives junk rows instead of writing NaN into progress', () => {
    const out = mergeRemoteStats(local(), {
      chess: { played: 'lots' as unknown as number, wins: -3, losses: null as unknown as number },
    });
    expect(out.stats.chess.played).toBe(9);
    expect(out.stats.chess.wins).toBe(6);
    expect(out.stats.chess.losses).toBe(3);
  });
});
