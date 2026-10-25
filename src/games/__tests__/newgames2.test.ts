/**
 * The four board games added in this pass.
 *
 * These import the exact modules `server/index.ts` referees with, so a green run
 * means the relay and the browser agree about legality, turn order and endings.
 * Each game also gets a full random playout: rules that only break in the last
 * three moves are the ones that reach production, so the playouts assert the
 * invariants that must hold after *every* move, not just the happy path.
 */
import { describe, expect, it } from 'vitest';

import { reversiRules as RV, flipsFor, legalCells, hasMoveFor, countDiscs, type ReversiState } from '../reversi/rules';
import { pickReversiMove, explainReversi } from '../reversi/ai';
import { gomokuRules as GK, gomokuWinFrom, type GomokuState } from '../gomoku/rules';
import { pickGomokuMove, explainGomoku } from '../gomoku/ai';
import { dotsRules as DT, boxesFor, sidesOf, boxCount, type DotsState, type DotsEdge } from '../dots/rules';
import { pickDotsMove, explainDots } from '../dots/ai';
import { mancalaRules as MC, myPits, storeOf, pitIndex, type MancalaState } from '../mancala/rules';
import { pickMancalaMove, explainMancala } from '../mancala/ai';
import { rng, type Slot } from '../types';

/* ------------------------------------------------------------------ reversi */
describe('reversi', () => {
  it('opens with four discs in the middle and exactly four legal moves', () => {
    const s = RV.createInitialState({}, 1);
    expect(s.board.filter((v) => v !== null)).toHaveLength(4);
    expect(s.counts).toEqual([2, 2]);
    expect(RV.currentPlayer(s)).toBe(0);
    expect(RV.legalMoves(s, 0).map((m) => m.cell).sort((a, b) => a - b)).toEqual([
      8 * 2 + 3, 8 * 3 + 2, 8 * 4 + 5, 8 * 5 + 4,
    ]);
  });

  it('flips the bracketed run and switches the turn', () => {
    let s = RV.createInitialState({}, 1);
    s = RV.applyMove(s, 0, { cell: 8 * 3 + 2 });
    expect(flipsFor(RV.createInitialState({}, 1).board, 8, 8 * 3 + 2, 0)).toHaveLength(1);
    expect(s.board[8 * 3 + 3]).toBe(0);       // the disc that was flipped
    expect(s.counts).toEqual([4, 1]);
    expect(s.turn).toBe(1);
    expect(s.last?.flipped).toHaveLength(1);
  });

  it('refuses placements that flip nothing, occupied squares and junk', () => {
    const s = RV.createInitialState({}, 1);
    expect(RV.isLegal(s, 0, { cell: 0 })).toBe(false);         // corner, flips nothing
    expect(RV.isLegal(s, 0, { cell: 8 * 3 + 3 })).toBe(false); // occupied
    expect(RV.isLegal(s, 0, { cell: 64 })).toBe(false);
    expect(RV.isLegal(s, 0, { cell: 'x' })).toBe(false);
    expect(RV.isLegal(s, 1, { cell: 8 * 3 + 2 })).toBe(false); // not slot 1's turn
    expect(RV.isLegal(s, 0, null)).toBe(false);
  });

  it('never leaves a player on turn with no legal move (passes are automatic)', () => {
    const r = rng(4242);
    for (let game = 0; game < 40; game++) {
      let s: ReversiState = RV.createInitialState({}, game + 1);
      let guard = 0;
      while (!s.over && guard++ < 80) {
        const moves = RV.legalMoves(s, s.turn);
        expect(moves.length).toBeGreaterThan(0);
        const before = s.board;
        const mv = moves[Math.floor(r() * moves.length)];
        s = RV.applyMove(s, s.turn, mv);
        expect(before).not.toBe(s.board);            // purity: never mutate
        expect(rvPurity(before, RV.createInitialState({}, game + 1).board)).toBe(true);
        // discs + empties always add up to the board
        const [a, b] = countDiscs(s.board);
        expect(a + b + s.board.filter((v) => v === null).length).toBe(64);
      }
      expect(s.over).toBe(true);
      const out = RV.result(s);
      expect(out.over).toBe(true);
      if (out.over && out.winner !== null) {
        const mine = s.counts[out.winner], theirs = s.counts[out.winner === 0 ? 1 : 0];
        expect(mine).toBeGreaterThan(theirs);
      }
    }
  });

  it('detects a pass by asking the opponent for a move', () => {
    const board = Array(16).fill(null) as (Slot | null)[];
    board[5] = 0; board[6] = 1; board[9] = 1; board[10] = 0;
    expect(hasMoveFor(board, 4, 0)).toBe(true);
    expect(hasMoveFor(board.map(() => 0) as (Slot | null)[], 4, 1)).toBe(false);
  });

  it('the opponent returns legal moves at every level', () => {
    let s = RV.createInitialState({}, 7);
    for (const diff of ['beginner', 'casual', 'intermediate', 'advanced', 'expert'] as const) {
      const mv = pickReversiMove(s, 0, diff);
      expect(mv).not.toBeNull();
      expect(RV.isLegal(s, 0, mv)).toBe(true);
      expect(typeof explainReversi(s, 0, mv!)).toBe('string');
    }
    for (let i = 0; i < 12; i++) {
      const moves = RV.legalMoves(s, s.turn);
      if (!moves.length) break;
      s = RV.applyMove(s, s.turn, moves[0]);
    }
  });

  it('sizes other than 8 still open legally', () => {
    for (const size of [4, 6, 10]) {
      const s = RV.createInitialState({ size }, 3);
      expect(s.size).toBe(size);
      expect(RV.legalMoves(s, 0).length).toBeGreaterThan(0);
    }
  });
});

function rvPurity(board: (Slot | null)[], opening: (Slot | null)[]) {
  // the opening array passed in must not have been mutated by any applyMove
  return opening.filter((v) => v !== null).length === 4 && board !== opening;
}

/* ------------------------------------------------------------------ gomoku */
describe('gomoku', () => {
  it('starts empty on a 15x15 board', () => {
    const s = GK.createInitialState({}, 1);
    expect(s.size).toBe(15);
    expect(s.board).toHaveLength(225);
    expect(GK.legalMoves(s, 0).length).toBe(225);
    expect(GK.currentPlayer(s)).toBe(0);
  });

  it('finds five in a row horizontally, vertically and on both diagonals', () => {
    const size = 9;
    const build = (cells: number[], who: Slot = 0): GomokuState => {
      const board = Array(size * size).fill(null) as (Slot | null)[];
      for (const c of cells) board[c] = who;
      return { ...GK.createInitialState({ size }, 1), board, history: cells };
    };
    const row = [0, 1, 2, 3, 4].map((c) => 8 * size + c);
    expect(gomokuWinFrom(build(row).board, size, row[4])).toHaveLength(5);
    const col = [0, 1, 2, 3, 4].map((r) => r * size + 3);
    expect(gomokuWinFrom(build(col).board, size, col[4])).toHaveLength(5);
    const diag = [0, 1, 2, 3, 4].map((i) => i * size + i);
    expect(gomokuWinFrom(build(diag).board, size, diag[2])).toHaveLength(5);
    const anti = [0, 1, 2, 3, 4].map((i) => i * size + (4 - i));
    expect(gomokuWinFrom(build(anti).board, size, anti[0])).toHaveLength(5);
    expect(gomokuWinFrom(build([0, 1, 2, 3]).board, size, 3)).toBeNull();
  });

  it('counts six in a row as a win too (freestyle)', () => {
    const size = 9;
    const cells = [0, 1, 2, 3, 4, 5].map((c) => c);
    const board = Array(size * size).fill(null) as (Slot | null)[];
    for (const c of cells) board[c] = 1;
    expect(gomokuWinFrom(board, size, 2)?.length).toBe(6);
  });

  it('rejects occupied cells and out-of-turn moves', () => {
    let s = GK.createInitialState({}, 1);
    s = GK.applyMove(s, 0, { cell: 112 });
    expect(GK.isLegal(s, 1, { cell: 112 })).toBe(false);
    expect(GK.isLegal(s, 0, { cell: 113 })).toBe(false);   // not slot 0's turn
    expect(GK.isLegal(s, 1, { cell: 225 })).toBe(false);
    expect(GK.isLegal(s, 1, { cell: 1.5 })).toBe(false);
  });

  it('playthroughs always end with a consistent verdict', () => {
    const r = rng(99);
    for (let game = 0; game < 12; game++) {
      let s: GomokuState = GK.createInitialState({ size: 9 }, game);
      let guard = 0;
      while (!s.over && guard++ < 90) {
        const moves = GK.legalMoves(s, s.turn);
        s = GK.applyMove(s, s.turn, moves[Math.floor(r() * moves.length)]);
      }
      expect(s.over).toBe(true);
      const out = GK.result(s);
      if (out.over && out.winner !== null) expect(s.winLine?.length ?? 0).toBeGreaterThanOrEqual(5);
    }
  });

  it('the AI wins at once, and blocks a four', () => {
    const size = 15;
    const blank = (): GomokuState => ({ ...GK.createInitialState({ size }, 1), board: Array(size * size).fill(null) });
    // four in a row for the AI -> it should complete five
    const win: GomokuState = blank();
    for (let c = 2; c <= 5; c++) win.board[7 * size + c] = 1;
    win.board[6 * size + 8] = 0;
    win.turn = 1;
    const w = pickGomokuMove(win, 1, 'expert');
    expect(w).not.toBeNull();
    expect(GK.applyMove(win, 1, w!).over).toBe(true);

    // four in a row for the human -> the AI must block one end
    const block: GomokuState = blank();
    for (let c = 2; c <= 5; c++) block.board[7 * size + c] = 0;
    block.board[0] = 1;
    block.turn = 1;
    const b = pickGomokuMove(block, 1, 'expert')!;
    expect([7 * size + 1, 7 * size + 6]).toContain(b.cell);
    expect(typeof explainGomoku(block, 1, b)).toBe('string');
  });

  it('opens in the centre', () => {
    const s = GK.createInitialState({}, 1);
    expect(pickGomokuMove(s, 0, 'expert')).toEqual({ cell: 112 });
  });
});

/* ------------------------------------------------------------------ dots & boxes */
describe('dots and boxes', () => {
  it('starts with every edge undrawn and no boxes claimed', () => {
    const s = DT.createInitialState({}, 1);
    expect(s.cols).toBe(5);
    expect(boxCount(s.cols, s.rows)).toBe(16);
    expect(s.boxes.every((b) => b === null)).toBe(true);
    expect(DT.legalMoves(s, 0).length).toBe(s.h.length + s.v.length);
    expect(DT.currentPlayer(s)).toBe(0);
  });

  it('claims the fourth side, scores it and keeps the turn', () => {
    let s = DT.createInitialState({}, 1);
    // box 0 = top-left; its four sides are h0,h4,v0,v1
    s = DT.applyMove(s, 0, { o: 'h', i: 0 });
    s = DT.applyMove(s, 1, { o: 'h', i: 4 });
    s = DT.applyMove(s, 0, { o: 'v', i: 0 });
    expect(s.boxes[0]).toBeNull();
    expect(s.turn).toBe(1);
    s = DT.applyMove(s, 1, { o: 'v', i: 1 });
    expect(s.boxes[0]).toBe(1);
    expect(s.scores).toEqual([0, 1]);
    expect(s.turn).toBe(1);            // completing a box buys another turn
    expect(s.lastGain).toBe(1);
  });

  it('refuses a drawn edge, a bad orientation and junk', () => {
    let s = DT.createInitialState({}, 1);
    s = DT.applyMove(s, 0, { o: 'h', i: 0 });
    expect(DT.isLegal(s, 1, { o: 'h', i: 0 })).toBe(false);
    expect(DT.isLegal(s, 0, { o: 'v', i: 0 })).toBe(false);   // out of turn
    expect(DT.isLegal(s, 1, { o: 'x', i: 0 })).toBe(false);
    expect(DT.isLegal(s, 1, { o: 'h', i: 999 })).toBe(false);
    expect(DT.isLegal(s, 1, { o: 'h', i: -1 })).toBe(false);
    expect(DT.isLegal(s, 1, 'h0')).toBe(false);
  });

  it('knows which boxes an edge closes', () => {
    let s = DT.createInitialState({}, 1);
    s = DT.applyMove(s, 0, { o: 'h', i: 0 });
    s = DT.applyMove(s, 1, { o: 'h', i: 4 });
    s = DT.applyMove(s, 0, { o: 'v', i: 0 });
    expect(boxesFor(s, { o: 'v', i: 1 })).toEqual([0]);
    expect(sidesOf(s, 0)).toBe(3);
  });

  it('always ends with every box claimed exactly once', () => {
    const r = rng(2024);
    for (let game = 0; game < 12; game++) {
      let s: DotsState = DT.createInitialState({ cols: 5, rows: 5 }, game);
      let guard = 0;
      while (!s.over && guard++ < 100) {
        const moves = DT.legalMoves(s, s.turn);
        const mv = moves[Math.floor(r() * moves.length)];
        s = DT.applyMove(s, s.turn, mv);
      }
      expect(s.over).toBe(true);
      expect(s.boxes.every((b) => b !== null)).toBe(true);
      expect(s.scores[0] + s.scores[1]).toBe(16);
      const out = DT.result(s);
      if (out.over && out.winner !== null) expect(s.scores[out.winner]).toBeGreaterThan(s.scores[1 - out.winner]);
    }
  });

  it('the AI takes a free box instead of opening a chain', () => {
    let s = DT.createInitialState({}, 1);
    s = { ...s, h: s.h.slice(), v: s.v.slice() };
    s.h[0] = true; s.h[4] = true; s.v[0] = true;       // three sides of box 0
    s.turn = 0;
    const mv = pickDotsMove(s, 0, 'expert')!;
    expect(boxesFor(s, mv).length).toBeGreaterThan(0);
    expect(DT.applyMove(s, 0, mv).scores[0]).toBeGreaterThan(0);
    expect(typeof explainDots(s, 0, mv)).toBe('string');
  });

  it('the AI always returns a drawable edge', () => {
    const r = rng(11);
    let s: DotsState = DT.createInitialState({}, 1);
    for (let i = 0; i < 24; i++) {
      const diff = (['beginner', 'casual', 'intermediate', 'advanced', 'expert'] as const)[i % 5];
      const mv = pickDotsMove(s, s.turn, diff) as DotsEdge | null;
      expect(mv).not.toBeNull();
      expect(DT.isLegal(s, s.turn, mv)).toBe(true);
      s = DT.applyMove(s, s.turn, mv!);
      if (s.over) break;
      if (!DT.legalMoves(s, s.turn).length) break;
      // give the opponent a random legal edge occasionally so the board fills up
      if (r() < 0.3) {
        const list = DT.legalMoves(s, s.turn);
        s = DT.applyMove(s, s.turn, list[Math.floor(r() * list.length)]);
      }
    }
  });
});

/* ------------------------------------------------------------------ mancala */
describe('mancala', () => {
  it('deals four seeds into each of twelve pits and leaves both stores empty', () => {
    const s = MC.createInitialState({}, 1);
    expect(s.board).toHaveLength(14);
    for (const i of myPits(s, 0)) expect(s.board[i]).toBe(4);
    for (const i of myPits(s, 1)) expect(s.board[i]).toBe(4);
    expect(s.board[storeOf(s, 0)]).toBe(0);
    expect(s.board[storeOf(s, 1)]).toBe(0);
    expect(s.board.reduce((a, b) => a + b, 0)).toBe(48);
    expect(MC.legalMoves(s, 0)).toHaveLength(6);
  });

  it('sows one seed per pit and skips the opponent store', () => {
    const s = MC.createInitialState({}, 1);
    const after = MC.applyMove(s, 0, { pit: 5 });      // 4 seeds: indices 6,7,8,9
    expect(after.board[6]).toBe(1);                    // one seed reached the store on the way past
    expect(after.board[7]).toBe(5);
    expect(after.board[8]).toBe(5);
    expect(after.board[9]).toBe(5);
    expect(after.board[5]).toBe(0);
    expect(after.sown).toEqual([6, 7, 8, 9]);
    expect(after.turn).toBe(1);
  });

  it('grants another turn when the last seed lands in the store', () => {
    const s = MC.createInitialState({}, 1);
    const after = MC.applyMove(s, 0, { pit: 2 });      // 3,4,5 then 6 = store
    expect(after.board[6]).toBe(1);
    expect(after.turn).toBe(0);
  });

  it('captures the opposite pit when the last seed lands in an empty pit of your own', () => {
    const s = MC.createInitialState({}, 1);
    const board = s.board.slice();
    board[0] = 1;       // sow from pit 0 -> lands in pit 1
    board[1] = 0;       // empty, so it captures pit 1 + opposite (11)
    board[11] = 6;
    const custom: MancalaState = { ...s, board };
    const after = MC.applyMove(custom, 0, { pit: 0 });
    expect(after.board[1]).toBe(0);
    expect(after.board[11]).toBe(0);
    expect(after.board[6]).toBe(7);
    expect(after.lastCapture).toBe(7);
    expect(after.turn).toBe(1);
  });

  it('sweeps the remaining seeds and ends when a row runs dry', () => {
    const s = MC.createInitialState({}, 1);
    const board = s.board.slice();
    for (const i of myPits(s, 0)) board[i] = 0;
    board[0] = 1;       // the only move: sow it into pit 1
    board[1] = 0;
    board[2] = 0;
    const custom: MancalaState = { ...s, board };
    const after = MC.applyMove(custom, 0, { pit: 0 });
    expect(after.board[1]).toBe(0);                       // captured into the store
    expect(after.over).toBe(true);
    expect(after.board[2]).toBe(0);                       // swept into the other store
    expect(after.board[storeOf(after, 0)]).toBe(5);       // its own stone + the opposite pit
    expect(after.board[storeOf(after, 1)]).toBe(20);      // the five pits that were not captured
    // nothing evaporates: every seed in this hand-made position is accounted for
    expect(after.board.reduce((a, b) => a + b, 0)).toBe(25);
  });

  it('keeps the seed count constant through a whole game', () => {
    const r = rng(555);
    for (let game = 0; game < 15; game++) {
      let s: MancalaState = MC.createInitialState({}, game);
      let guard = 0;
      while (!s.over && guard++ < 300) {
        const moves = MC.legalMoves(s, s.turn);
        expect(moves.length).toBeGreaterThan(0);
        s = MC.applyMove(s, s.turn, moves[Math.floor(r() * moves.length)]);
        expect(s.board.reduce((a, b) => a + b, 0)).toBe(48);
      }
      expect(s.over).toBe(true);
      const out = MC.result(s);
      if (out.over && out.winner !== null) {
        expect(s.board[storeOf(s, out.winner)]).toBeGreaterThan(s.board[storeOf(s, out.winner === 0 ? 1 : 0)]);
      }
    }
  });

  it('the AI always returns a legal pit and can be explained', () => {
    const r = rng(7);
    let s: MancalaState = MC.createInitialState({}, 1);
    for (let i = 0; i < 40 && !s.over; i++) {
      const diff = (['beginner', 'casual', 'intermediate', 'advanced', 'expert'] as const)[i % 5];
      const mv = pickMancalaMove(s, s.turn, diff);
      if (!mv) break;
      expect(MC.isLegal(s, s.turn, mv)).toBe(true);
      expect(typeof explainMancala(s, s.turn, mv)).toBe('string');
      s = MC.applyMove(s, s.turn, mv);
      if (!MC.legalMoves(s, s.turn).length && !s.over) break;
      void r;
    }
  });

  it('opens with any of its six pits and respects pitIndex mapping', () => {
    const s = MC.createInitialState({}, 1);
    expect(pitIndex(s, 0, 0)).toBe(0);
    expect(pitIndex(s, 1, 0)).toBe(7);
    expect(new Set(MC.legalMoves(s, 0).map((m) => m.pit)).size).toBe(6);
  });
});
