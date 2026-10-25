// @vitest-environment jsdom
/**
 * The boards still render, and they render as grids of fractions.
 *
 * `board-geometry.test.ts` pins the arithmetic and forbids `vw` cell maths in the
 * source. This file proves the other half: that the components actually mount,
 * that every cell is a grid child rather than a hand-sized box, and that the
 * stage wrapper is present exactly once per board.
 *
 * jsdom has no layout, so `clientWidth` is 0 and the stage deliberately falls
 * back to `width: 100%` (see `useBoardFit`). That is the case being asserted —
 * the board must be laid out by CSS alone until the first measurement lands.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import TicTacToeBoard from '../boards/TicTacToeBoard';
import ReversiBoard from '../boards/ReversiBoard';
import MancalaBoard from '../boards/MancalaBoard';
import ChessBoard from '../boards/ChessBoard';
import { StoreProvider } from '../../lib/store';
import { tictactoeRules } from '../../games/tictactoe/rules';
import { reversiRules } from '../../games/reversi/rules';
import { mancalaRules } from '../../games/mancala/rules';
import { chessRules } from '../../games/chess/rules';

let host: HTMLDivElement;
let root: Root;

beforeAll(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  (window as any).matchMedia ??= (q: string) => ({
    matches: false, media: q, onchange: null,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false,
  });
  // no ResizeObserver in jsdom, on purpose: the stage must survive without it
});

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

const mount = async (node: React.ReactElement) => {
  await act(async () => root.render(createElement(StoreProvider, null, node)));
};

describe('boards lay their cells out as fractions of the stage', () => {
  it('Nine Grids: one stage, nine cells, no px width on a cell', async () => {
    const state = tictactoeRules.createInitialState({ size: 3 } as any, 0);
    await mount(createElement(TicTacToeBoard, { state, youSlot: 0, onMove: () => {}, interactive: true, names: ['A', 'B'] } as any));

    const stages = host.querySelectorAll('[data-board-stage]');
    expect(stages.length, 'exactly one stage per board').toBe(1);

    const grid = host.querySelector('[role="grid"]') as HTMLElement;
    expect(grid.style.gridTemplateColumns).toContain('repeat(3');
    expect(grid.style.gridTemplateColumns).toContain('1fr');

    const cells = host.querySelectorAll('[role="gridcell"]');
    expect(cells.length).toBe(9);
    for (const c of cells) {
      expect((c as HTMLElement).style.width, 'a cell never carries a hand-sized width').toBe('');
    }
  });

  it('Lantern Flip: 64 cells, all in one grid', async () => {
    const state = reversiRules.createInitialState({ size: 8 } as any, 0);
    await mount(createElement(ReversiBoard, { state, youSlot: 0, onMove: () => {}, interactive: true, names: ['A', 'B'] } as any));
    expect(host.querySelectorAll('[data-board-stage]').length).toBe(1);
    expect(host.querySelectorAll('[role="gridcell"]').length).toBe(64);
  });

  it('Mancala: twelve pits plus two stores, and the trays are grid tracks', async () => {
    const state = mancalaRules.createInitialState({} as any, 0);
    await mount(createElement(MancalaBoard, { state, youSlot: 0, onMove: () => {}, interactive: true, names: ['A', 'B'] } as any));
    expect(host.querySelectorAll('[data-board-stage]').length).toBe(1);
    // two labelled pit groups (theirs and yours)
    expect(host.querySelector('[role="group"][aria-label="Your pits"]')).toBeTruthy();
  });

  it('Chess: 64 squares, each with a name that says what is on it', async () => {
    const state = chessRules.createInitialState({} as any, 0);
    await mount(createElement(ChessBoard, { state, youSlot: 0, onMove: () => {}, interactive: true, hint: true } as any));
    const squares = host.querySelectorAll('[role="gridcell"]');
    expect(squares.length).toBe(64);
    const labels = [...squares].map((s) => s.getAttribute('aria-label') ?? '');
    expect(labels.some((l) => /^a1, white r/.test(l)), 'a1 holds a white rook').toBe(true);
    expect(labels.some((l) => /^a8, black r/.test(l)), 'a8 holds a black rook').toBe(true);
    expect(new Set(labels).size, 'every square is distinct').toBe(64);
  });
});
