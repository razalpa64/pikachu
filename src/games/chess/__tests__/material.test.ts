import { describe, expect, it } from 'vitest';
import { balanceLabel, countPieces, materialFromFen, PIECE_VALUE } from '../material';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

describe('materialFromFen', () => {
  it('starts level with nothing captured', () => {
    const m = materialFromFen(START);
    expect(m.w.captured).toEqual([]);
    expect(m.b.captured).toEqual([]);
    expect(m.w.balance).toBe(0);
    expect(m.edge).toEqual({ side: null, points: 0 });
  });

  it('credits the side that made the capture, and shows it on both trays', () => {
    // white took black's queen, black took a pawn
    const fen = 'rnb1kbnr/pppppppp/8/8/8/8/PPPP1PPP/RNBQKBNR w KQkq - 0 1';
    const m = materialFromFen(fen);
    expect(m.w.captured).toEqual(['q']);
    expect(m.b.captured).toEqual(['p']);
    expect(m.w.lost).toEqual(['p']);
    expect(m.b.lost).toEqual(['q']);
    // white is +8: a queen (9) for a pawn (1)
    expect(m.w.balance).toBe(8);
    expect(m.b.balance).toBe(-8);
    expect(m.edge).toEqual({ side: 'w', points: 8 });
  });

  it('lists the captured pieces biggest first, and counts each type', () => {
    const fen = 'rnb1k1nr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    const m = materialFromFen(fen);
    expect(m.w.captured).toEqual(['q', 'b']);
    expect(m.w.taken).toBe(PIECE_VALUE.q + PIECE_VALUE.b);
  });

  it('does not call a promoted queen a capture', () => {
    // white has two queens on the board: one of them is a promoted pawn
    const fen = '7k/8/8/8/8/8/QQ6/7K w - - 0 1';
    const m = materialFromFen(fen);
    // black lost everything except the king, white lost everything except two
    // queens and the king — nothing here can go negative
    expect(m.w.lost.filter((t) => t === 'q')).toEqual([]);
    expect(m.b.captured.filter((t) => t === 'q')).toEqual([]);
    expect(m.w.captured.filter((t) => t === 'q').length).toBe(1);
  });

  it('survives a malformed FEN instead of throwing mid-game', () => {
    const m = materialFromFen('');
    expect(m.w.balance).toBe(0);
    expect(m.edge.points).toBe(0);
  });

  it('counts what is on the board per colour', () => {
    const c = countPieces(START);
    expect(c.w.q).toBe(1);
    expect(c.b.p).toBe(8);
    expect(c.w.r).toBe(2);
  });
});

describe('balanceLabel', () => {
  it('reads like a score sheet', () => {
    expect(balanceLabel(0)).toBe('level');
    expect(balanceLabel(3)).toBe('+3');
    expect(balanceLabel(-9)).toBe('−9');
  });
});
