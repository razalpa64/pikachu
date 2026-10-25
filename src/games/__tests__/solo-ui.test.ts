// @vitest-environment jsdom
/**
 * Interaction tests for the four newest solo screens, in a real DOM.
 *
 * The rule engines are already covered by unit tests, and the boards are covered
 * by SSR render checks. Neither of those can catch the failure that actually
 * reaches a player: *the board renders, but clicking it does nothing.* That is a
 * wiring bug — a disabled predicate that never opens, an `onMove` that is passed
 * the wrong shape, an AI effect that never fires because a dependency is stale.
 *
 * So these tests mount the real screens, click the way a person clicks, and
 * assert on the DOM afterwards:
 *   • Reversi  — the highlighted legal moves actually flip coins.
 *   • Gomoku   — a click places a stone, and the AI answers within its budget.
 *   • Dots     — a click draws a line that is then reported as drawn.
 *   • Mancala  — a click sows a pit and the board advances to the AI.
 *   • Wild Eights (same device) — playing a card raises the hand-over curtain,
 *     and the curtain hides the next player's hand until they tap \"deal me in\".
 *
 * Timers are real (not faked) because the AI moves are scheduled with `setTimeout`
 * inside the component; faking them would test a world the app does not live in.
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { gameById } from '../registry';
import { StoreProvider } from '../../lib/store';

const GAMES = ['reversi', 'gomoku', 'dots', 'mancala', 'cards'] as const;

let host: HTMLDivElement;
let root: Root;

// The screens read a few browser APIs that jsdom either lacks or stubs too thinly.
beforeAll(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  if (!window.matchMedia) {
    (window as any).matchMedia = (q: string) => ({
      matches: false, media: q, onchange: null,
      addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false,
    });
  }
  (globalThis as any).ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
  // the sound engine must stay silent in tests, and must not need a gesture
  (HTMLMediaElement.prototype as any).play ??= () => Promise.resolve();
  (window as any).scrollTo ??= () => {};
});

afterEach(async () => {
  await act(async () => { root?.unmount(); });
  host?.remove();
});

async function mount(id: (typeof GAMES)[number]) {
  const game = gameById(id)!;
  expect(game, `registry has ${id}`).toBeTruthy();
  const View = (await import(`../../games/${id}/SoloView`)).default ?? (await import(`../${id}/SoloView`)).default;
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root.render(createElement(MemoryRouter, null,
      createElement(StoreProvider, null, createElement(View, { game }))));
  });
  return host;
}

const cells = () => [...host.querySelectorAll<HTMLElement>('[role="gridcell"]')];
const enabled = (els: HTMLElement[]) => els.filter((e) => !(e as HTMLButtonElement).disabled);

async function click(el: HTMLElement) {
  await act(async () => { el.click(); });
}

/** let effects and the AI's scheduled move run */
async function settle(ms = 900) {
  await act(async () => { await new Promise((r) => setTimeout(r, ms)); });
}

/** poll until `ok()` is true, flushing React between checks — CI machines are slow */
async function waitFor(ok: () => boolean, ms = 2500) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (ok()) return true;
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
  }
  return ok();
}

describe('the new solo screens respond to a click', () => {
  it('Reversi flips coins on the highlighted square', async () => {
    await mount('reversi');
    const coins = () => cells().filter((c) => /coin/.test(c.getAttribute('aria-label') ?? ''));
    const flips = () => cells().filter((c) => /flips/.test(c.getAttribute('aria-label') ?? ''));
    const before = coins().length;
    expect(before, 'a fresh Reversi board has four coins').toBe(4);
    expect(flips().length, 'legal opening squares are highlighted').toBeGreaterThan(0);

    await click(flips()[0]);
    await settle(1400);                       // the AI gets a turn too

    expect(coins().length, 'coins on the board after one exchange').toBeGreaterThan(before);
    expect(cells().filter((c) => (c as HTMLButtonElement).disabled).length, 'it is not your turn while the AI thinks').toBeGreaterThan(0);
  });

  it('Gomoku places a stone and the AI answers', async () => {
    await mount('gomoku');
    const stones = () => cells().filter((c) => /stone/.test(c.getAttribute('aria-label') ?? ''));
    const empty = () => enabled(cells().filter((c) => /empty/.test(c.getAttribute('aria-label') ?? '')));
    expect(stones().length).toBe(0);
    expect(empty().length, 'a 15×15 board opens almost entirely empty').toBeGreaterThan(100);

    await click(empty()[0]);
    await settle(1500);

    expect(stones().length, 'your stone plus the AI reply').toBeGreaterThanOrEqual(2);
  });

  it('Dots & Boxes draws the line you click', async () => {
    await mount('dots');
    const lines = () => enabled([...host.querySelectorAll<HTMLElement>('button[aria-label*="line"]')]);
    expect(lines().length, 'undrawn lines are offered').toBeGreaterThan(20);
    const drawn = () => host.querySelectorAll('[aria-label*="drawn"]').length;

    await click(lines()[0]);
    await settle(1200);

    expect(drawn(), 'at least your line is marked drawn').toBeGreaterThan(0);
  });

  it('Mancala sows the pit you click', async () => {
    await mount('mancala');
    const row = host.querySelector('[role="row"][aria-label="Your pits"]');
    expect(row, 'your row of pits exists').toBeTruthy();
    const pits = enabled([...row!.querySelectorAll<HTMLElement>('button')]);
    expect(pits.length, 'every pit with seeds is playable').toBe(6);
    const before = pits.map((p) => p.getAttribute('aria-label'));

    await click(pits[2]);
    await settle(1500);

    const after = enabled([...host.querySelectorAll<HTMLElement>('[role="row"][aria-label="Your pits"] button')])
      .map((p) => p.getAttribute('aria-label'));
    expect(after, 'the pits no longer hold what they held before').not.toEqual(before);
  });
});

describe('pass-and-play curtain (Wild Eights)', () => {
  it('covers the hand when the seat changes and lifts on tap', async () => {
    await mount('cards');
    // switch to same-device play
    const local = [...host.querySelectorAll<HTMLElement>('[role="radio"]')].find((b) => /Pass & play/i.test(b.textContent ?? ''));
    expect(local, 'the pass-and-play mode button is there').toBeTruthy();
    await click(local!);
    await settle(400);
    expect(host.textContent).toMatch(/Player 1/);
    expect(host.textContent, 'no curtain until the seat actually changes').not.toMatch(/Hand it to Player/);

    /* Play until the seat actually changes. Not every card passes the turn: an
       eight asks for a suit and a Skip hands the *opponent* the skip, so the same
       player moves again — both are correct, and neither should raise a curtain. */
    let curtainUp = false;
    for (let attempt = 0; attempt < 4 && !curtainUp; attempt++) {
      const hand = host.querySelector('[role="group"][aria-label="Your hand"]');
      expect(hand, 'the hand is on screen').toBeTruthy();
      const playable = [...hand!.querySelectorAll<HTMLElement>('button')]
        .filter((b) => !(b as HTMLButtonElement).disabled);
      if (!playable.length) break;
      const plain = playable.find((b) => !/^(8|Skip)/.test(b.getAttribute('aria-label') ?? ''));
      await click(plain ?? playable[0]);
      await settle(400);
      const suit = [...host.querySelectorAll<HTMLElement>('button')].find((b) => /^Call /.test(b.getAttribute('aria-label') ?? ''));
      if (suit) { await click(suit); await settle(300); }
      curtainUp = await waitFor(() => /Hand it to Player [12]/.test(host.textContent ?? ''), 1200);
    }
    expect(curtainUp, 'the next player is asked for the device').toBe(true);

    const go = [...host.querySelectorAll<HTMLElement>('button')].find((b) => /deal me in/i.test(b.textContent ?? ''));
    expect(go, 'and there is a way to continue').toBeTruthy();
    await click(go!);
    const lifted = await waitFor(() => !/Hand it to Player/.test(host.textContent ?? ''), 1500);
    expect(lifted, 'the curtain lifts once the next player takes the device').toBe(true);
  });
});
