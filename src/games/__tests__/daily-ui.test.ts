// @vitest-environment jsdom
/**
 * The daily, played with a finger.
 *
 * The engine tests prove the puzzle is deterministic; these prove the *screen*
 * is honest about it: the grid is there, a tap fills a square, the tool toggle
 * switches to marking, and a grid that matches the clues produces the victory
 * state and a banked streak — the thing the whole feature exists for.
 */
import { describe, it, expect, beforeAll, afterEach, beforeEach } from 'vitest';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { StoreProvider } from '../../lib/store';
import { gameById } from '../registry';
import DailySolo from '../daily/SoloView';
import { DAILY_VERSION, dateKey, dailyFor } from '../daily/puzzle';

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

beforeEach(() => { localStorage.clear(); });

afterEach(async () => {
  await act(async () => { root?.unmount(); });
  host?.remove();
});

async function mount() {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root.render(createElement(MemoryRouter, null,
      createElement(StoreProvider, null, createElement(DailySolo, { game: gameById('daily')! }))));
  });
}

const cells = () => Array.from(host.querySelectorAll<HTMLButtonElement>('[role="gridcell"]'));

describe('daily puzzle screen', () => {
  it('shows today’s grid, its edition, and one square per cell', async () => {
    await mount();
    expect(cells()).toHaveLength(25);
    expect(host.textContent).toContain(dateKey());
    expect(host.textContent).toContain(`edition ${DAILY_VERSION}`);
    // every square is reachable and named for a screen reader
    expect(cells()[0].getAttribute('aria-label')).toMatch(/Row 1, column 1/);
  });

  it('fills a square on tap, and clears it on the second tap', async () => {
    await mount();
    const first = cells()[0];
    await act(async () => { first.click(); });
    expect(cells()[0].getAttribute('aria-pressed')).toBe('true');
    await act(async () => { cells()[0].click(); });
    expect(cells()[0].getAttribute('aria-pressed')).toBe('false');
  });

  it('marks a square empty when the marking tool is on', async () => {
    await mount();
    const mark = Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.includes('Mark'))!;
    await act(async () => { mark.click(); });
    await act(async () => { cells()[3].click(); });
    expect(cells()[3].getAttribute('aria-pressed'), 'a marked square is not a filled one').toBe('false');
    expect(cells()[3].textContent).toContain('✕');
    expect(cells()[3].getAttribute('aria-label')).toMatch(/marked empty/);
  });

  it('declares victory and banks a streak when the clues are satisfied', async () => {
    await mount();
    const puzzle = dailyFor(dateKey(), DAILY_VERSION);
    // fill exactly the reference picture — a valid answer, so it must be accepted
    for (let i = 0; i < puzzle.solution.length; i++) {
      if (!puzzle.solution[i]) continue;
      await act(async () => { cells()[i].click(); });
    }
    expect(host.textContent).toMatch(/Today’s grid is done/);
    expect(host.textContent).toMatch(/streak 1/);
    const saved = JSON.parse(localStorage.getItem('pikachu.daily.v1')!);
    expect(saved.lastSolved).toBe(dateKey());
    expect(saved.streak).toBe(1);
  });

  it('does not accept a wrong board just because it is full', async () => {
    await mount();
    // fill everything: dense full rows and columns almost never fit a 5×5 daily
    for (let i = 0; i < 25; i++) await act(async () => { cells()[i].click(); });
    expect(host.textContent).not.toMatch(/Today’s grid is done/);
    expect(localStorage.getItem('pikachu.daily.v1')).toBeNull();
  });
});
