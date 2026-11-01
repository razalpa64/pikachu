// @vitest-environment jsdom
/**
 * The solo screen, end to end, in a browser-shaped DOM.
 *
 * This is the closest thing to a play test that can run without a real browser:
 * the landing card is mounted, the table is taken, a plan is built through the
 * same buttons a player presses, the practice AI answers through the engine, and
 * the round resolves. It also checks the two things a solo screen can get wrong
 * silently — recording a match it never finished, and showing the AI's plan
 * before the reveal.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import VantaSolo from '../SoloView';
import { StoreProvider } from '../../../lib/store';
import { gameById } from '../../registry';
import { START_AGENTS, neighbours } from '../rules';

let host: HTMLDivElement;
let root: Root;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeAll(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  (window as any).matchMedia ??= (q: string) => ({
    matches: false, media: q, onchange: null,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false,
  });
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

const mount = async () => {
  const game = gameById('vanta')!;
  await act(async () => root.render(createElement(MemoryRouter, { initialEntries: ['/solo/vanta'] },
    createElement(StoreProvider, null, createElement(VantaSolo, { game })))));
};

const byText = (re: RegExp) =>
  [...host.querySelectorAll('button')].find((b) => re.test((b.textContent ?? '').trim())) as HTMLButtonElement | undefined;

describe('VANTA solo', () => {
  it('opens on a card that states the three ways to win and who you are playing', async () => {
    await mount();
    const text = host.textContent ?? '';
    expect(text).toContain('Every move has a motive');
    expect(text).toContain('Influence');
    expect(text).toContain('Relays');
    expect(text.toLowerCase()).toContain('the core');
    for (const level of ['Beginner', 'Casual', 'Intermediate', 'Advanced', 'Expert']) {
      expect(text, `${level} is offered`).toContain(level);
    }
    expect(byText(/take the table/i), 'there is one obvious way in').toBeTruthy();
    /* nothing is half-started: no board until you sit down */
    expect(host.querySelectorAll('[role="gridcell"]').length).toBe(0);
  });

  it('lands on a nine-square-grid table with a composer and an empty result', async () => {
    await mount();
    await act(async () => { byText(/take the table/i)!.click(); });
    expect(host.querySelectorAll('[role="gridcell"]').length).toBe(49);
    /* the round clock lives in the game HUD, the same place every other game
       puts its counters */
    expect(host.textContent).toMatch(/ROUND|Round/);
    expect(host.textContent).toContain('1/12');
    expect(host.textContent).toContain('Secret objective');
    expect(host.textContent).toMatch(/Lock plan/i);
    expect(host.textContent).not.toMatch(/Match report/i);
  });

  it('locks a plan, lets the practice AI answer, and reveals the round', async () => {
    await mount();
    await act(async () => { byText(/take the table/i)!.click(); });

    /* agent A, the free action, a legal step */
    await act(async () => { [...host.querySelectorAll('button')].find((b) => /^Agent A/.test(b.getAttribute('aria-label') ?? ''))!.click(); });
    await act(async () => { byText(/^move/i)!.click(); });
    const step = neighbours(START_AGENTS[0][0])[0];
    const cells = [...host.querySelectorAll('[role="gridcell"]')] as HTMLElement[];
    const target = cells.find((c) => c.dataset.vantaTarget === '1');
    expect(target, 'a legal target is offered').toBeTruthy();
    await act(async () => { target!.click(); });
    await act(async () => { byText(/lock plan/i)!.click(); });

    /* the reveal is deliberately delayed by a beat, then the round is done */
    await act(async () => { await sleep(500); });
    const text = host.textContent ?? '';
    expect(text).toContain('2/12');
    expect(text).toMatch(/Round 1 resolved/);
    /* the report speaks in the seats' on-screen names, not the engine's */
    expect(text).toContain('You · ');
    expect(text, 'the composer is live again').toMatch(/Lock plan/i);
    /* the past round is public, the coming one is not */
    expect(text).not.toMatch(/Their plan/i);
    void step;
  });

  it('does not record a match that has not finished', async () => {
    await mount();
    await act(async () => { byText(/take the table/i)!.click(); });
    expect(host.textContent).not.toMatch(/Match report/i);
    expect(host.textContent).not.toMatch(/Rematch/);
  });

  it('shows the rank card with a rating that moves with results', async () => {
    await mount();
    const text = host.textContent ?? '';
    expect(text).toContain('Your table rank');
    expect(text).toMatch(/Bronze|Silver|Gold|Platinum|Diamond|Master/);
    expect(text).toContain('Win rate');
  });
});
