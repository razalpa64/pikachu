/**
 * Rules tests.
 *
 * These exercise the exact modules the relay server imports, so a green run here
 * means the server and the browser agree about legality, outcomes and redaction.
 */
import { describe, expect, it } from 'vitest';

import { tictactoeRules as TTT, findWin, type TTTState } from '../tictactoe/rules';
import { pickTTTMove } from '../tictactoe/ai';
import { connect4Rules as C4, dropRow, undoC4 } from '../connect4/rules';
import { pickC4Move } from '../connect4/ai';
import { chessRules as CH, load, resign, agreeDraw, startClock, undoChess, START_FEN } from '../chess/rules';
import { checkersRules as CK, isDark, capturesFrom } from '../checkers/rules';
import { pickCheckersMove } from '../checkers/ai';
import { memoryRules as MEM } from '../memory/rules';
import { battleshipRules as BS, autoPlace, validPlacement, FLEET } from '../battleship/rules';
import { newBSBrain, pickBSShot } from '../battleship/ai';
import { reactionRules as RD } from '../reaction/rules';
import type { Slot } from '../types';

/* ------------------------------------------------------------------ tic-tac-toe */
describe('tic-tac-toe', () => {
  it('starts empty with slot 0 to move', () => {
    const s = TTT.createInitialState({ size: 3 }, 1);
    expect(s.cells.every((c) => c === null)).toBe(true);
    expect(TTT.currentPlayer(s)).toBe(0);
    expect(TTT.legalMoves(s, 0)).toHaveLength(9);
  });

  it('rejects occupied cells, out-of-range cells and junk payloads', () => {
    let s = TTT.createInitialState({ size: 3 }, 1);
    s = TTT.applyMove(s, 0, { cell: 4 });
    expect(TTT.isLegal(s, 1, { cell: 4 })).toBe(false);
    expect(TTT.isLegal(s, 1, { cell: 99 })).toBe(false);
    expect(TTT.isLegal(s, 1, { cell: -1 })).toBe(false);
    expect(TTT.isLegal(s, 1, 'nope')).toBe(false);
    expect(TTT.isLegal(s, 1, { cell: '2' })).toBe(false);
    expect(TTT.isLegal(s, 0, { cell: 2 })).toBe(false);   // not slot 0's turn
  });

  it('detects a row win and stops accepting moves', () => {
    let s = TTT.createInitialState({ size: 3 }, 1);
    for (const [who, cell] of [[0, 0], [1, 3], [0, 1], [1, 4], [0, 2]] as [Slot, number][]) {
      s = TTT.applyMove(s, who, { cell });
    }
    const out = TTT.result(s);
    expect(out.over).toBe(true);
    expect(out.over && out.winner).toBe(0);
    expect(findWin(s)?.line).toEqual([0, 1, 2]);
    expect(TTT.legalMoves(s, 1)).toHaveLength(0);
  });

  it('calls a full board a draw', () => {
    let s = TTT.createInitialState({ size: 3 }, 1);
    for (const [who, cell] of [[0, 0], [1, 1], [0, 2], [1, 4], [0, 7], [1, 3], [0, 5], [1, 8], [0, 6]] as [Slot, number][]) {
      s = TTT.applyMove(s, who, { cell });
    }
    const out = TTT.result(s);
    expect(out.over).toBe(true);
    expect(out.over && out.winner).toBeNull();
  });

  /**
   * Exhaustive, not sampled. Thirty random games used to pass ~2 runs in 3 and
   * quietly hid a real defect (the memo table was storing alpha-beta *bounds*
   * as if they were exact scores). This walks EVERY possible opponent reply at
   * every turn, for both seats, so "unbeatable" is actually proven.
   */
  it('the expert AI cannot lose a 3x3 game against any line of play', () => {
    let terminals = 0;
    const losses: string[] = [];

    const walk = (s: TTTState, aiSlot: Slot) => {
      const out = TTT.result(s);
      if (out.over) {
        terminals++;
        if (out.winner !== null && out.winner !== aiSlot) losses.push(s.cells.join(''));
        return;
      }
      const turn = TTT.currentPlayer(s)!;
      if (turn === aiSlot) {
        walk(TTT.applyMove(s, turn, pickTTTMove(s, aiSlot, 'expert')!), aiSlot);
      } else {
        for (const m of TTT.legalMoves(s, turn)) walk(TTT.applyMove(s, turn, m), aiSlot);
      }
    };

    for (const aiSlot of [0, 1] as Slot[]) walk(TTT.createInitialState({ size: 3 }, 1), aiSlot);

    expect(losses).toEqual([]);
    expect(terminals).toBeGreaterThan(300);
  });

  it('expert vs expert is always a draw', () => {
    for (let game = 0; game < 5; game++) {
      let s = TTT.createInitialState({ size: 3 }, game * 13);
      while (!TTT.result(s).over) {
        const turn = TTT.currentPlayer(s)!;
        s = TTT.applyMove(s, turn, pickTTTMove(s, turn, 'expert')!);
      }
      const out = TTT.result(s);
      expect(out.over && out.winner).toBeNull();
    }
  });
});

/* ------------------------------------------------------------------ connect four */
describe('connect four', () => {
  it('applies gravity — discs stack from the bottom row up', () => {
    let s = C4.createInitialState({}, 1);
    expect(dropRow(s, 3)).toBe(0);                       // row 0 is the floor
    s = C4.applyMove(s, 0, { col: 3 });
    expect(dropRow(s, 3)).toBe(1);
    expect(s.board[3]).toBe(0);
    expect(s.lastDrop).toEqual({ col: 3, row: 0 });
  });

  it('refuses a full column', () => {
    let s = C4.createInitialState({}, 1);
    for (let i = 0; i < s.rows; i++) s = C4.applyMove(s, (i % 2) as Slot, { col: 0 });
    expect(C4.isLegal(s, s.turn, { col: 0 })).toBe(false);
    expect(C4.legalMoves(s, s.turn)).not.toContainEqual({ col: 0 });
  });

  it('detects a vertical four', () => {
    let s = C4.createInitialState({}, 1);
    for (let i = 0; i < 3; i++) { s = C4.applyMove(s, 0, { col: 2 }); s = C4.applyMove(s, 1, { col: 3 }); }
    s = C4.applyMove(s, 0, { col: 2 });
    const out = C4.result(s);
    expect(out.over).toBe(true);
    expect(out.over && out.winner).toBe(0);
    expect(s.winLine).toHaveLength(4);
  });

  it('undo rewinds exactly N plies', () => {
    let s = C4.createInitialState({}, 1);
    s = C4.applyMove(s, 0, { col: 0 });
    s = C4.applyMove(s, 1, { col: 1 });
    const back = undoC4(s, 2);
    expect(back.history).toHaveLength(0);
    expect(back.board.every((c) => c === null)).toBe(true);
    expect(back.turn).toBe(0);
  });

  it('the AI blocks an immediate loss', () => {
    // slot 0 threatens column 2 vertically; slot 1 must answer there
    let s = C4.createInitialState({}, 7);
    s = C4.applyMove(s, 0, { col: 2 });
    s = C4.applyMove(s, 1, { col: 6 });
    s = C4.applyMove(s, 0, { col: 2 });
    s = C4.applyMove(s, 1, { col: 6 });
    s = C4.applyMove(s, 0, { col: 2 });
    const reply = pickC4Move(s, 1, 'advanced', 400);
    expect(reply?.col).toBe(2);
  });

  it('the AI takes an immediate win over a block', () => {
    let s = C4.createInitialState({}, 11);
    s = C4.applyMove(s, 0, { col: 0 });
    s = C4.applyMove(s, 1, { col: 4 });
    s = C4.applyMove(s, 0, { col: 0 });
    s = C4.applyMove(s, 1, { col: 4 });
    s = C4.applyMove(s, 0, { col: 0 });
    s = C4.applyMove(s, 1, { col: 4 });
    s = C4.applyMove(s, 0, { col: 1 });   // slot 1 now has three in column 4 and can finish
    const reply = pickC4Move(s, 1, 'advanced', 400);
    expect(reply?.col).toBe(4);
  });
});

/* ------------------------------------------------------------------ chess */
describe('chess', () => {
  it('starts from the standard position with 20 legal moves', () => {
    const s = CH.createInitialState({ timeControl: 'none' }, 0);
    expect(s.fen).toBe(START_FEN);
    expect(CH.legalMoves(s, 0)).toHaveLength(20);
    expect(CH.currentPlayer(s)).toBe(0);
  });

  it('rejects illegal and out-of-turn moves', () => {
    const s = CH.createInitialState({ timeControl: 'none' }, 0);
    expect(CH.isLegal(s, 0, { from: 'e2', to: 'e5' })).toBe(false);
    expect(CH.isLegal(s, 1, { from: 'e7', to: 'e5' })).toBe(false);
    expect(CH.isLegal(s, 0, {})).toBe(false);
    expect(CH.isLegal(s, 0, { from: 'e2', to: 'e4' })).toBe(true);
  });

  it('records SAN history and detects fool\u2019s mate', () => {
    let s = CH.createInitialState({ timeControl: 'none' }, 0);
    for (const m of [{ from: 'f2', to: 'f3' }, { from: 'e7', to: 'e5' }, { from: 'g2', to: 'g4' }, { from: 'd8', to: 'h4' }]) {
      s = CH.applyMove(s, CH.currentPlayer(s)!, m);
    }
    expect(s.pgnMoves).toEqual(['f3', 'e5', 'g4', 'Qh4#']);
    const out = CH.result(s);
    expect(out.over).toBe(true);
    expect(out.over && out.winner).toBe(1);
    expect(load(s.fen).isCheckmate()).toBe(true);
  });

  it('promotion is required and applied', () => {
    const s = { ...CH.createInitialState({ timeControl: 'none' }, 0), fen: '8/P6k/8/8/8/8/7K/8 w - - 0 1' };
    expect(CH.isLegal(s, 0, { from: 'a7', to: 'a8', promotion: 'q' })).toBe(true);
    const after = CH.applyMove(s, 0, { from: 'a7', to: 'a8', promotion: 'q' });
    expect(after.fen.startsWith('Q7/')).toBe(true);
  });

  it('resignation and agreed draws end the game with a reason', () => {
    const base = CH.createInitialState({ timeControl: 'none' }, 0);
    const r = resign(base, 0);
    expect(CH.result(r).over).toBe(true);
    expect(r.winner).toBe(1);
    const d = agreeDraw(base);
    expect(d.over).toBe(true);
    expect(d.winner).toBeNull();
  });

  it('a clock that runs out loses the game', () => {
    let s = startClock(CH.createInitialState({ timeControl: 'blitz' }, 0));
    expect(s.clock).not.toBeNull();
    s = CH.tick!(s, Date.now() + 10 * 60 * 1000);
    const out = CH.result(s);
    expect(out.over).toBe(true);
    expect(out.over && out.winner).toBe(1);
  });

  it('take-back rewinds two plies', () => {
    let s = CH.createInitialState({ timeControl: 'none' }, 0);
    s = CH.applyMove(s, 0, { from: 'e2', to: 'e4' });
    s = CH.applyMove(s, 1, { from: 'e7', to: 'e5' });
    const back = undoChess(s, 2);
    expect(back.fen).toBe(START_FEN);
    expect(back.pgnMoves).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ checkers */
describe('checkers', () => {
  it('only uses dark squares and starts with 12 pieces each', () => {
    const s = CK.createInitialState({ mandatoryCapture: true }, 0);
    expect(s.board.filter((p) => p?.p === 0)).toHaveLength(12);
    expect(s.board.filter((p) => p?.p === 1)).toHaveLength(12);
    s.board.forEach((p, i) => { if (p) expect(isDark(i)).toBe(true); });
  });

  it('forces a capture when mandatoryCapture is on', () => {
    const board = new Array(64).fill(null);
    board[45] = { p: 0, king: false };    // r5 c5
    board[36] = { p: 1, king: false };    // r4 c4 — jumpable to r3 c3 (27)
    const s = { ...CK.createInitialState({ mandatoryCapture: true }, 0), board, turn: 0 as Slot };
    const moves = CK.legalMoves(s, 0);
    expect(moves).toHaveLength(1);
    expect(moves[0]).toEqual({ from: 45, to: 27 });
    expect(capturesFrom(s, 45)).toHaveLength(1);
  });

  it('removes the jumped piece and promotes on the back rank', () => {
    const board = new Array(64).fill(null);
    board[17] = { p: 0, king: false };
    board[10] = { p: 1, king: false };    // jump 17 -> 3 lands on row 0
    const s = { ...CK.createInitialState({ mandatoryCapture: true }, 0), board, turn: 0 as Slot };
    const after = CK.applyMove(s, 0, { from: 17, to: 3 });
    expect(after.board[10]).toBeNull();
    expect(after.board[3]).toEqual({ p: 0, king: true });
  });

  it('losing every piece ends the game', () => {
    const board = new Array(64).fill(null);
    board[17] = { p: 0, king: false };
    board[10] = { p: 1, king: false };
    const s = { ...CK.createInitialState({ mandatoryCapture: true }, 0), board, turn: 0 as Slot };
    const after = CK.applyMove(s, 0, { from: 17, to: 3 });
    const out = CK.result(after);
    expect(out.over).toBe(true);
    expect(out.over && out.winner).toBe(0);
  });

  it('the AI always returns a legal move from the opening position', () => {
    let s = CK.createInitialState({ mandatoryCapture: true }, 0);
    for (let i = 0; i < 12 && !CK.result(s).over; i++) {
      const turn = CK.currentPlayer(s)!;
      const mv = pickCheckersMove(s, turn, 'intermediate', 120)!;
      expect(CK.isLegal(s, turn, mv)).toBe(true);
      s = CK.applyMove(s, turn, mv);
    }
  });
});

/* ------------------------------------------------------------------ memory */
describe('memory match', () => {
  it('deals an even deck of pairs', () => {
    const s = MEM.createInitialState({ cols: 4, rows: 4 }, 42);
    expect(s.deck).toHaveLength(16);
    const counts = new Map<string, number>();
    s.deck.forEach((c) => counts.set(c, (counts.get(c) ?? 0) + 1));
    [...counts.values()].forEach((n) => expect(n).toBe(2));
  });

  it('is deterministic for a given seed', () => {
    const a = MEM.createInitialState({ cols: 4, rows: 4 }, 99);
    const b = MEM.createInitialState({ cols: 4, rows: 4 }, 99);
    expect(a.deck).toEqual(b.deck);
  });

  it('hides unrevealed cards from the client', () => {
    const s = MEM.createInitialState({ cols: 4, rows: 3 }, 7);
    const red = MEM.redact!(s, 0) as typeof s;
    expect(red.deck.filter((c) => c !== null && c !== undefined)).toHaveLength(0);
  });

  it('scores a matched pair and keeps the turn', () => {
    let s = MEM.createInitialState({ cols: 4, rows: 3 }, 5);
    const first = s.deck[0];
    const twin = s.deck.findIndex((c, i) => i !== 0 && c === first);
    s = MEM.applyMove(s, 0, { flip: 0 });
    s = MEM.applyMove(s, 0, { flip: twin });
    s = MEM.applyMove(s, 0, { resolve: true });
    expect(s.score[0]).toBe(1);
    expect(s.turn).toBe(0);
    expect(s.matched).toContain(0);
    expect(s.lastResult).toBe('hit');
  });

  it('passes the turn after a miss', () => {
    let s = MEM.createInitialState({ cols: 4, rows: 3 }, 5);
    const first = s.deck[0];
    const different = s.deck.findIndex((c) => c !== first);
    s = MEM.applyMove(s, 0, { flip: 0 });
    s = MEM.applyMove(s, 0, { flip: different });
    s = MEM.applyMove(s, 0, { resolve: true });
    expect(s.score[0]).toBe(0);
    expect(s.turn).toBe(1);
    expect(s.lastResult).toBe('miss');
  });

  it('never allows a third simultaneous flip', () => {
    let s = MEM.createInitialState({ cols: 4, rows: 3 }, 5);
    s = MEM.applyMove(s, 0, { flip: 0 });
    s = MEM.applyMove(s, 0, { flip: 1 });
    expect(MEM.isLegal(s, 0, { flip: 2 })).toBe(false);
  });
});

/* ------------------------------------------------------------------ battleship */
describe('battleship', () => {
  it('auto-placement is always valid', () => {
    for (let seed = 0; seed < 40; seed++) {
      const ships = autoPlace(seed);
      expect(validPlacement(ships)).toBeNull();
      expect(ships).toHaveLength(FLEET.length);
      const all = ships.flatMap((s) => s.cells);
      expect(new Set(all).size).toBe(all.length);
    }
  });

  it('rejects overlapping, off-grid and non-contiguous fleets', () => {
    expect(validPlacement([{ id: 'carrier', cells: [0, 1, 2, 3, 4] }, { id: 'battleship', cells: [0, 1, 2, 3] }])).not.toBeNull();
    expect(validPlacement([{ id: 'carrier', cells: [7, 8, 9, 10, 11] }])).not.toBeNull();     // wraps a row
    expect(validPlacement([{ id: 'carrier', cells: [0, 1, 2, 3, 9] }])).not.toBeNull();
  });

  it('never leaks the enemy fleet in a redacted state', () => {
    let s = BS.createInitialState({}, 1);
    s = BS.applyMove(s, 0, { type: 'place', ships: autoPlace(1) });
    s = BS.applyMove(s, 1, { type: 'place', ships: autoPlace(2) });
    const red = BS.redact!(s, 0) as typeof s;
    expect(red.fleets[0].every((sh) => sh.cells.length > 0)).toBe(true);
    expect(red.fleets[1].every((sh) => sh.cells.length === 0)).toBe(true);
  });

  it('runs a full battle to a verdict without illegal shots', () => {
    let s = BS.createInitialState({}, 3);
    s = BS.applyMove(s, 0, { type: 'place', ships: autoPlace(11) });
    s = BS.applyMove(s, 1, { type: 'place', ships: autoPlace(12) });
    s = BS.applyMove(s, 0, { type: 'ready' });
    s = BS.applyMove(s, 1, { type: 'ready' });
    expect(s.phase).toBe('battle');

    const brains = [newBSBrain(), newBSBrain()];
    let guard = 0;
    while (!BS.result(s).over && guard++ < 400) {
      const turn = BS.currentPlayer(s)!;
      const cell = pickBSShot(s, turn, brains[turn], 'expert');
      expect(BS.isLegal(s, turn, { type: 'fire', cell })).toBe(true);
      s = BS.applyMove(s, turn, { type: 'fire', cell });
    }
    const out = BS.result(s);
    expect(out.over).toBe(true);
    expect([0, 1]).toContain(out.over ? out.winner : -1);
    // the expert hunter should not need anywhere near every square
    expect(s.shots[out.over && out.winner === 0 ? 0 : 1].length).toBeLessThan(95);
  });

  it('refuses to fire at the same cell twice', () => {
    let s = BS.createInitialState({}, 4);
    s = BS.applyMove(s, 0, { type: 'place', ships: autoPlace(21) });
    s = BS.applyMove(s, 1, { type: 'place', ships: autoPlace(22) });
    s = BS.applyMove(s, 0, { type: 'ready' });
    s = BS.applyMove(s, 1, { type: 'ready' });
    const first = s.turn;
    const after = BS.applyMove(s, first, { type: 'fire', cell: 0 });
    expect(BS.isLegal(after, first, { type: 'fire', cell: 0 })).toBe(false);
  });
});

/* ------------------------------------------------------------------ reaction duel */
describe('reaction duel', () => {
  it('nobody owns the turn — both players may press', () => {
    const s = RD.createInitialState({ bestOf: 3 }, 1);
    expect(RD.currentPlayer(s)).toBeNull();
  });

  it('walks countdown -> armed -> signal on the server clock', () => {
    let s = RD.createInitialState({ bestOf: 3 }, 2);
    const t0 = Date.now();
    expect(s.phase).toBe('countdown');
    s = RD.tick!(s, t0 + 2700);                       // countdown is 2600 ms
    expect(s.phase).toBe('armed');
    s = RD.tick!(s, t0 + 2700 + s.armDelay + 5);
    expect(s.phase).toBe('signal');
    expect(s.signalAt).not.toBeNull();
    expect(s.armDelay).toBeGreaterThanOrEqual(1300);  // the wait is always unpredictable
    expect(s.armDelay).toBeLessThanOrEqual(4500);
  });

  /* Drive the machine on the REAL clock: applyMove measures `Date.now() - signalAt`,
     exactly as it does on the server, so simulated timestamps would read as 0 ms. */
  const toSignal = (st: ReturnType<typeof RD.createInitialState>) => {
    let s = { ...st, phaseEndsAt: Date.now() - 1 };
    s = RD.tick!(s, Date.now());            // countdown -> armed
    s = { ...s, phaseEndsAt: Date.now() - 1 };
    s = RD.tick!(s, Date.now());            // armed -> signal (signalAt = real now)
    return s;
  };
  const spin = (ms: number) => { const until = Date.now() + ms; while (Date.now() < until) { /* busy wait */ } };

  it('a press before the signal is flagged as a false start and loses the round', () => {
    let s = RD.createInitialState({ bestOf: 3 }, 3);
    s = RD.applyMove(s, 0, { type: 'press' });
    expect(s.falseStart[0]).toBe(true);
    expect(s.over).toBe(false);                       // the round still needs the rival to answer
    s = toSignal(s);
    s = RD.applyMove(s, 1, { type: 'press' });        // clean press by slot 1
    s = RD.tick!(s, Date.now() + 5000);               // signal window closes -> round resolves
    expect(s.rounds[0].winner).toBe(1);
    expect(s.wins[1]).toBe(1);
    expect(s.wins[0]).toBe(0);
  });

  it('a double false start scores nobody', () => {
    let s = RD.createInitialState({ bestOf: 3 }, 9);
    s = RD.applyMove(s, 0, { type: 'press' });
    s = RD.applyMove(s, 1, { type: 'press' });
    expect(s.wins).toEqual([0, 0]);
    expect(s.rounds).toHaveLength(1);
    expect(s.rounds[0].winner).toBeNull();
  });

  it('the faster press wins the round and the time is recorded in ms', () => {
    let s = RD.createInitialState({ bestOf: 3 }, 4);
    s = toSignal(s);
    expect(s.phase).toBe('signal');
    s = RD.applyMove(s, 1, { type: 'press' });
    spin(8);
    s = RD.applyMove(s, 0, { type: 'press' });
    expect(s.rounds).toHaveLength(1);
    expect(s.rounds[0].winner).toBe(1);
    expect(s.rounds[0].responses[1]!).toBeLessThan(s.rounds[0].responses[0]!);
    expect(s.wins[1]).toBe(1);
  });

  it('a best-of-3 ends as soon as someone reaches two round wins', () => {
    let s = RD.createInitialState({ bestOf: 3 }, 21);
    for (let r = 0; r < 4 && !s.over; r++) {
      s = toSignal(s);
      s = RD.applyMove(s, 0, { type: 'press' });
      spin(4);
      s = RD.applyMove(s, 1, { type: 'press' });
      if (!s.over) s = RD.tick!(s, Date.now() + 5000);   // skip the reveal pause
    }
    expect(s.over).toBe(true);
    expect(s.wins[0]).toBe(2);
    expect(RD.result(s)).toEqual({ over: true, winner: 0, reason: 'fastest reflexes' });
  });
});
