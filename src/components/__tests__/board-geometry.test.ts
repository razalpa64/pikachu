// @vitest-environment node
/**
 * Board geometry.
 *
 * Every board on the site used to size its own cells from the **viewport width**
 * — `min(10.2vw, 62px)` for chess, `min(5.6vw, 29px)` for River Stones, a
 * hand-tuned `calc((75vh - 225px) / rows)` for Pika Pairs — and hang a plate
 * *outside* that width. Three consequences, all of them felt by players:
 *
 *   • a board could be wider than the phone it was on (chess: 8×62 = 496 px);
 *   • the same board ignored the column it was actually in, so in a private room
 *     the chat rail stole ~324 px the board had already spent;
 *   • height was only ever considered by one board, so on a laptop a chessboard
 *     pushed the clock, the rulebook and the result card below the fold.
 *
 * The fix is one rule, in one place (`fitBoardWidth` in `components/boards/
 * BoardStage.tsx`): the board is as wide as the narrower of its column and the
 * height it can afford, between a floor and a ceiling. These tests pin the rule
 * at the four screen sizes the redesign was judged on, pin the "no board sizes
 * itself from the viewport" invariant, and pin the frame-inside-the-column rule
 * that `BoardPlate` now enforces.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fitBoardWidth } from '../boards/BoardStage';

/** The values each board passes to its stage, kept in one table so a change to
 *  any of them has to be made here too. */
const CHESS = { ratio: 1, max: 664, min: 288, reserve: 140, chrome: 26 };
const GOMOKU_15 = { ratio: 1, max: 604, min: 300, reserve: 186, chrome: 16 };
const C4 = { ratio: 7 / 6, max: 560, min: 268, reserve: 136, chrome: 104 };
const MEMORY = { ratio: (6 * 3) / (4 * 4), max: 840, min: 250, reserve: 150, chrome: 20 };

const fit = (spec: typeof CHESS, column: number, viewport: number, top = 220) =>
  fitBoardWidth({ ...spec, column, viewport, top });

const BOARDS_DIR = join(process.cwd(), 'src/components/boards');

/** strip comments so the prose that *describes* the old `vw` maths is ignored */
const code = (file: string) =>
  readFileSync(join(BOARDS_DIR, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

const boardFiles = readdirSync(BOARDS_DIR).filter((f) => f.endsWith('.tsx'));

describe('fitBoardWidth — the one sizing rule', () => {
  it('fits a 360 px phone: the chessboard is narrower than the screen, never wider', () => {
    // 360 px viewport, 16 px of shell padding either side ⇒ a 328 px column.
    // Height: 844 − 250 (title bar, settings, HUD above the board) − 140 reserved − 26 frame.
    const w = fit(CHESS, 328, 844, 250);
    expect(w).toBeLessThanOrEqual(328);
    expect(w).toBe(328);           // width-bound here: the height budget is bigger
    expect(w / 8).toBeGreaterThanOrEqual(41);   // a playable square, ~41 px
  });

  it('fits a 390 px phone in landscape: the height budget wins, not the width', () => {
    // landscape: 390 px tall, board starts at 120 px, 140 px reserved below
    const w = fit(CHESS, 380, 390, 120);
    expect(w).toBe(288);           // floored at `min`: scroll rather than shrink
    const h = w / CHESS.ratio + CHESS.chrome;
    expect(h).toBeGreaterThan(300);   // taller than the space ⇒ the page scrolls, on purpose
  });

  it('fills the column on a small laptop in a room with the 324 px chat rail', () => {
    // 1280 wide, 2×16 shell padding, 324 rail, 20 gap ⇒ 904 px of column
    const column = 1280 - 32 - 324 - 20;
    const w = fit(CHESS, column, 800, 180);
    expect(w).toBe(454);           // height-bound: 800 − 180 − 140 − 26 frame = 454
    expect(w).toBeLessThan(column); // and never wider than the column it has
  });

  it('grows on a desktop but stops at the cap, so it is not a poster', () => {
    expect(fit(CHESS, 1120, 1000, 200)).toBe(634);   // height-bound: 1000 − 200 − 140 − 26
    expect(fit(CHESS, 1120, 1400, 200)).toBe(CHESS.max);   // then the cap decides
  });

  it('caps every board, so a 2560 px monitor does not get a poker table', () => {
    for (const spec of [CHESS, GOMOKU_15, C4, MEMORY]) {
      expect(fitBoardWidth({ ...spec, column: 2400, viewport: 1600, top: 150 })).toBeLessThanOrEqual(spec.max);
    }
  });

  it('never returns less than the floor, even with no room at all', () => {
    expect(fitBoardWidth({ ...CHESS, column: 900, viewport: 400, top: 380 })).toBe(CHESS.min);
  });

  it('ignores a stage that has scrolled above the fold', () => {
    // a negative top must not be read as "more room than the screen has"
    expect(fit(CHESS, 900, 800, -400)).toBe(fit(CHESS, 900, 800, 0));
  });

  it('keeps Connect Four, Memory and 15×15 Gomoku inside a 360 px phone', () => {
    for (const spec of [C4, MEMORY, GOMOKU_15]) {
      const w = fitBoardWidth({ ...spec, column: 328, viewport: 780, top: 300 });
      expect(w).toBeLessThanOrEqual(328);
    }
  });
});

describe('no board sizes itself from the viewport', () => {
  it('has no vw/vh cell maths left in components/boards', () => {
    const offenders: string[] = [];
    for (const file of boardFiles) {
      const src = code(file);
      // `dvh` is allowed where a *chrome* strip is pinned to the visible height;
      // `vw`/`vh` cell maths is exactly what this redesign removed.
      const hits = src.match(/\d+(\.\d+)?v[w|h]\b/g);
      if (hits) offenders.push(`${file}: ${hits.join(', ')}`);
    }
    expect(offenders, 'board cells are fractions of the stage, not of the window').toEqual([]);
  });

  it('routes every board through the stage (or is a list/card board, by design)', () => {
    // Boards that are lists of cards, buttons or free text rather than a lattice:
    // they cannot overflow a column and they are already measured in ch/rem.
    const LIST_LIKE = new Set([
      'BluffTriviaBoard.tsx', 'SparkQuizBoard.tsx', 'WordBombBoard.tsx',
      'WouldYouRatherBoard.tsx', 'WildEightsBoard.tsx',
      // the captured-pieces trays are two rows of 16px pieces inside the HUD,
      // not a lattice — they have no size of their own to get wrong
      'ChessTrays.tsx',
    ]);
    const missing = boardFiles
      .filter((f) => !['BoardStage.tsx', 'BoardPlate.tsx', 'ChessPiece.tsx', 'types.ts', 'registry.tsx'].includes(f))
      .filter((f) => !LIST_LIKE.has(f))
      .filter((f) => !code(f).includes('BoardStage'));
    expect(missing, 'these boards still compute their own size').toEqual([]);
  });
});

describe('the cream plate stays inside the column', () => {
  it('uses padding rather than an absolute frame that overhangs', () => {
    const src = code('BoardPlate.tsx');
    expect(src, 'no negative-inset frame').not.toMatch(/-inset-[0-9]/);
    expect(src, 'the frame is real padding').toMatch(/p-\[clamp\(/);
  });
});
