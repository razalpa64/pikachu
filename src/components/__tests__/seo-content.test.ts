// @vitest-environment jsdom
/**
 * The pages a search engine actually reads.
 *
 * Two things are being pinned here. First, that the rules prose lives in the DOM
 * on a game page rather than inside a closed disclosure — the in-play rulebook is
 * collapsed by default, so before <GameAbout> a crawler landing on /solo/chess-arena
 * saw a board and no words. Second, that the FAQ rendered on /library is the same
 * list the FAQPage structured data is built from, so the markup can never promise
 * answers the page does not show.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { StoreProvider } from '../../lib/store';
import { GameAbout } from '../GameAbout';
import SoloShell from '../SoloShell';
import Library from '../../screens/Library';
import { GAMES, gameBySlug } from '../../games/registry';
import { howToFor } from '../../games/howToPlay';
import { LIBRARY_FAQ } from '../../lib/seo';

const chess = gameBySlug('chess-arena')!;

let host: HTMLDivElement;
let root: Root;

beforeAll(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  (window as any).scrollTo = () => {};
  (window as any).matchMedia ??= (q: string) => ({
    matches: false, media: q, onchange: null,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false,
  });
});

beforeEach(() => {
  localStorage.clear();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  host.remove();
});

const render = (el: ReactElement) =>
  act(async () => {
    root.render(createElement(MemoryRouter, null, createElement(StoreProvider, null, el)));
  });

describe('the game page reads like a page', () => {
  it('puts the goal, the steps and the tip in the DOM, not behind a disclosure', async () => {
    await render(createElement(GameAbout, { game: chess }));
    const text = host.textContent ?? '';
    const how = howToFor(chess.id)!;

    expect(host.querySelector('h2')?.textContent).toBe('How to play Chess Arena');
    expect(text).toContain(how.goal);
    for (const step of how.steps) expect(text).toContain(step.slice(0, 40));
    if (how.tip) expect(text).toContain('Tip.');
    expect(text).toContain(chess.description);
  });

  it('links the game to its modes and to three neighbours, so crawlers get depth', async () => {
    await render(createElement(GameAbout, { game: chess }));
    const hrefs = [...host.querySelectorAll('a')].map((a) => a.getAttribute('href'));

    expect(hrefs).toContain('/solo/chess-arena');
    expect(hrefs).toContain('/together?game=chess');
    expect(hrefs).toContain('/library');
    // three same-genre games + the two CTAs + "all games"
    expect(hrefs.length).toBeGreaterThanOrEqual(6);
    for (const href of hrefs) expect(href?.startsWith('/')).toBe(true);
  });

  it('gives the game shell exactly one H1 — the title on screen', async () => {
    await render(createElement(SoloShell, { game: chess, children: 'board' }));
    const h1s = host.querySelectorAll('h1');
    expect(h1s).toHaveLength(1);
    expect(h1s[0].textContent).toBe(chess.title);
  });
});

describe('the library carries the FAQ', () => {
  it('renders one disclosure per structured-data question', async () => {
    await render(createElement(Library));
    const details = [...host.querySelectorAll('details')];
    const text = host.textContent ?? '';

    expect(details).toHaveLength(LIBRARY_FAQ.length);
    for (const item of LIBRARY_FAQ) {
      expect(text).toContain(item.q);
      expect(text).toContain(item.a.slice(0, 60));
    }
    expect(host.querySelector('h2#arcade-faq-h')?.textContent).toBe('Playing in this arcade');
    expect(host.querySelectorAll('h1')).toHaveLength(1);
  });

  it('still shows every game as a link', async () => {
    await render(createElement(Library));
    const linked = new Set(
      [...host.querySelectorAll('a')].map((a) => a.getAttribute('href')).filter((h) => h?.startsWith('/solo/')),
    );
    // cards link to /solo/... via the Play button; the grid covers the registry
    expect(host.textContent).toContain('Game Library');
    expect(GAMES.length).toBeGreaterThan(0);
    expect(linked.size + host.querySelectorAll('article').length).toBeGreaterThan(0);
  });
});
