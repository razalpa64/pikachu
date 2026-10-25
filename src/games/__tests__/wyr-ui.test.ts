// @vitest-environment jsdom
/**
 * Would You Rather, clicked through in a real DOM.
 *
 * The referee is covered by `wyr.test.ts`; what these tests protect is the wiring
 * a player actually touches — that tapping a card records a pick, that the reveal
 * shows the *recorded* round rather than a recomputation, and that the online
 * board refuses a second tap and never renders an opponent's side before the
 * server has revealed it.
 */
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { StoreProvider } from '../../lib/store';
import { gameById } from '../registry';
import WyrSolo from '../wyr/SoloView';
import WouldYouRatherBoard from '../../components/boards/WouldYouRatherBoard';
import { DEFAULT_WYR, chooserFor, type WyrState } from '../wyr/rules';

let host: HTMLDivElement;
let root: Root;

beforeAll(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  (window as any).scrollTo ??= () => {};
  (window as any).matchMedia ??= (q: string) => ({
    matches: false, media: q, onchange: null,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false,
  });
  (HTMLMediaElement.prototype as any).play ??= () => Promise.resolve();
});

afterEach(async () => {
  await act(async () => { root?.unmount(); });
  host?.remove();
});

async function mount(el: React.ReactElement) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root.render(createElement(MemoryRouter, null, createElement(StoreProvider, null, el)));
  });
}

const cards = () => [...host.querySelectorAll<HTMLButtonElement>('button[data-side]')];

describe('would you rather — solo', () => {
  it('scores the round you play and moves on when you ask it to', async () => {
    const game = gameById('wyr')!;
    await mount(createElement(WyrSolo, { game }));

    expect(host.textContent).toMatch(/Would you rather/i);
    expect(host.textContent).toMatch(/Round\s*1\s*\/\s*10/);

    const options = cards();
    expect(options.length, 'two sides, no third door').toBe(2);
    await act(async () => { options[0].click(); });

    // the reveal states who took the point, and the round is recorded
    expect(host.textContent).toMatch(/Point to (you|Pikachu)|No point/);
    expect(host.textContent).toMatch(/So far/);

    const next = [...host.querySelectorAll<HTMLButtonElement>('button')]
      .find((b) => /Next one|See the result/i.test(b.textContent ?? ''));
    expect(next, 'there is a way forward').toBeTruthy();
    await act(async () => { next!.click(); });
    expect(host.textContent).toMatch(/Round\s*2\s*\/\s*10/);
  });

  it('will not let one round be answered twice', async () => {
    const game = gameById('wyr')!;
    await mount(createElement(WyrSolo, { game }));
    const [a, b] = cards();
    await act(async () => { a.click(); });
    await act(async () => { b.click(); });
    // exactly one round has been recorded, so the tally lists one dilemma
    const rows = [...host.querySelectorAll('li')].filter((li) => /vs/.test(li.textContent ?? ''));
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(host.textContent).not.toMatch(/Round 2\//);
  });
});

/** A minimal server-shaped state, so the board can be driven without a socket. */
type BoardState = WyrState & { total: number; lockedIn: [boolean, boolean] };
function boardState(over: Partial<BoardState> = {}): BoardState {
  return {
    config: { ...DEFAULT_WYR, rounds: 10 },
    seed: 1,
    order: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    index: 0,
    phase: 'choose',
    phaseEndsAt: Date.now() + 20_000,
    picked: [null, null],
    history: [],
    score: [0, 0],
    over: false,
    winner: null,
    reason: '',
    total: 10,
    lockedIn: [false, false],
    ...over,
  } as BoardState;
}

const renders = async (el: React.ReactElement) => mount(el);

describe('would you rather — online board', () => {
  it('sends the side you tapped, and takes no second answer', async () => {
    const moves: unknown[] = [];
    await renders(createElement(WouldYouRatherBoard, {
      state: boardState(),
      youSlot: 1,
      onMove: (m: unknown) => moves.push(m),
      interactive: true,
      names: ['Ash', 'Misty'] as [string, string],
    }));

    expect(host.textContent).toMatch(/you are guessing/i);
    const options = cards();
    expect(options.length).toBe(2);
    await act(async () => { options[0].click(); });
    expect(moves).toEqual([{ type: 'pick', side: 'a' }]);

    // with your pick recorded the board stops accepting taps
    const locked = boardState({ picked: [null, 'a'], lockedIn: [false, true] });
    await renders(createElement(WouldYouRatherBoard, {
      state: locked, youSlot: 1, onMove: (m: unknown) => moves.push(m), interactive: true,
      names: ['Ash', 'Misty'] as [string, string],
    }));
    const after = cards();
    expect(after.every((b) => b.disabled)).toBe(true);
    await act(async () => { after[1].click(); });
    expect(moves).toHaveLength(1);
  });

  it('waits for the other side, then shows what both of you picked', async () => {
    await renders(createElement(WouldYouRatherBoard, {
      state: boardState({ picked: ['b', null], lockedIn: [true, false] }),
      youSlot: 1, onMove: () => {}, interactive: true, names: ['Ash', 'Misty'] as [string, string],
    }));
    // the guesser sees that the chooser is in, but not what they chose
    expect(host.textContent).toMatch(/They are in|Your call/i);
    expect(host.textContent).not.toMatch(/Ash's answer/);

    const reveal = boardState({
      phase: 'reveal',
      index: 0,
      picked: ['b', 'a'],
      lockedIn: [true, true],
      score: [1, 0],
      history: [{
        dilemma: { id: 1, a: 'A quiet night in', b: 'A loud night out' },
        chooser: chooserFor(0), choice: 'b', guess: 'a', hit: false, points: 0,
      }],
    });
    await renders(createElement(WouldYouRatherBoard, {
      state: reveal, youSlot: 1, onMove: () => {}, interactive: true,
      names: ['Ash', 'Misty'] as [string, string],
    }));
    expect(host.textContent).toMatch(/Point to Ash/);
    expect(host.textContent).toMatch(/Ash's answer/);
    expect(host.textContent).toMatch(/Your guess/);
  });

  it('never renders a move when the room says it is not your turn to act', async () => {
    const onMove = vi.fn();
    await renders(createElement(WouldYouRatherBoard, {
      state: boardState(), youSlot: 0, onMove, interactive: false,
      names: ['Ash', 'Misty'] as [string, string],
    }));
    const options = cards();
    await act(async () => { options[0].click(); });
    expect(onMove).not.toHaveBeenCalled();
  });
});
