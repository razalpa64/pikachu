// @vitest-environment jsdom
/**
 * The front page and the library, rendered for real.
 *
 * These two screens are where discovery either works or does not, and they are
 * made of data rather than of a fixed list — rails, a daily spotlight, filter
 * counts. The tests below pin the promises that are easy to break silently:
 *
 *   • the front page has exactly one `h1`, one primary play action, and links to
 *     both playing alone and playing together;
 *   • nothing on it invents a player count, a review or a score;
 *   • the rails are built from live games only, and each game appears once in a
 *     rail — no duplicated covers in one row;
 *   • every filter chip counts the games it will actually show.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { StoreProvider } from '../../lib/store';
import { RoomProvider } from '../../lib/useRoom';
import Home from '../Home';
import Library from '../Library';
import { GAMES, liveGames, onlineGames } from '../../games/registry';

let host: HTMLDivElement;
let root: Root;

beforeAll(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  (window as any).scrollTo = () => {};
  (window as any).matchMedia ??= (q: string) => ({
    matches: false, media: q, onchange: null,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false,
  });
  // the home page hosts the room hook, which opens a socket when a room exists
  (window as any).WebSocket ??= class { close() {} addEventListener() {} };
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

async function mount(el: React.ReactElement) {
  await act(async () => {
    root.render(createElement(MemoryRouter, null,
      createElement(StoreProvider, null, createElement(RoomProvider, null, el))));
  });
}

describe('the front page', () => {
  it('has one headline, and says what the place is', async () => {
    await mount(createElement(Home));
    const h1 = host.querySelectorAll('h1');
    expect(h1, 'one h1 per page').toHaveLength(1);
    expect(h1[0].textContent).toMatch(/PIKACHU/i);
    expect(h1[0].textContent).toMatch(/ARCADE/i);
    expect(host.textContent).toMatch(new RegExp(`${GAMES.length} hand-built games`));
  });

  it('offers a way to play alone and a way to play together', async () => {
    await mount(createElement(Home));
    const labels = [...host.querySelectorAll('button, a')].map((b) => (b.textContent ?? '').trim());
    expect(labels.some((l) => /^Play now$/i.test(l))).toBe(true);
    expect(labels.some((l) => /^Play together$/i.test(l))).toBe(true);
    // and the code field is on the front page, not three screens deep
    expect(host.querySelector('input[placeholder*="Room code" i]'), 'a join field on the front page').toBeTruthy();
  });

  it('tells the truth: no invented players, reviews or scores', async () => {
    await mount(createElement(Home));
    const text = host.textContent ?? '';
    expect(text).not.toMatch(/\d+\s*(?:k|m|\+)?\s*(?:players|people|users)\b(?!\s*in the room)/i);
    expect(text).not.toMatch(/coming soon/i);
    expect(text).not.toMatch(/\b\d\.\d\s*(?:\/5|stars?)\b/i);
    expect(text).not.toMatch(/trusted by/i);
  });

  it('builds the shelves out of live games, without repeating a cover in a row', async () => {
    await mount(createElement(Home));
    const rails = [...host.querySelectorAll<HTMLElement>('section')]
      .filter((s) => /Short sessions|Two devices, one board|Just you/.test(s.querySelector('.eyebrow')?.textContent ?? ''));

    expect(rails.length, 'three shelves').toBe(3);
    for (const rail of rails) {
      const links = [...rail.querySelectorAll<HTMLButtonElement>('button[aria-label^="Play "]')];
      expect(links.length).toBeGreaterThan(2);
      const names = links.map((b) => b.getAttribute('aria-label'));
      expect(new Set(names).size, 'no duplicate cover inside a shelf').toBe(names.length);
      for (const name of names) {
        const title = name!.replace(/^Play /, '').split(' — ')[0];
        expect(liveGames().some((g) => g.title === title), `${title} is a live game`).toBe(true);
      }
    }
  });

  it('only advertises "best with two" for games that really seat two', async () => {
    await mount(createElement(Home));
    const together = [...host.querySelectorAll<HTMLElement>('section')]
      .find((s) => /Two devices, one board/.test(s.querySelector('.eyebrow')?.textContent ?? ''));
    for (const b of together!.querySelectorAll('button[aria-label^="Play "]')) {
      const title = b.getAttribute('aria-label')!.replace(/^Play /, '').split(' — ')[0];
      const game = onlineGames().find((g) => g.title === title)!;
      expect(game.players[1], `${title} must seat two`).toBeGreaterThanOrEqual(2);
      expect(game.modes).toContain('online');
    }
  });
});

describe('the library', () => {
  it('counts what each filter will actually show', async () => {
    await mount(createElement(Library));
    const chips = [...host.querySelectorAll<HTMLButtonElement>('button[aria-pressed]')];
    const countIn = (label: string) => {
      const chip = chips.find((c) => c.textContent?.startsWith(label));
      expect(chip, `${label} chip exists`).toBeTruthy();
      return Number(chip!.textContent!.slice(label.length).replace(/[^\d]/g, ''));
    };
    expect(countIn('All games')).toBe(GAMES.length);
    expect(countIn('Multiplayer')).toBe(GAMES.filter((g) => g.modes.includes('online')).length);
    expect(countIn('Single player')).toBe(GAMES.filter((g) => g.modes.includes('solo') || g.modes.includes('ai')).length);
    expect(countIn('Play vs AI')).toBe(GAMES.filter((g) => g.modes.includes('ai')).length);
    expect(countIn('Strategy')).toBe(GAMES.filter((g) => g.genre === 'strategy').length);
    expect(countIn('Party')).toBe(GAMES.filter((g) => g.genre === 'party').length);
    // favourites is a real zero, not an empty chip
    expect(countIn('Favourites')).toBe(0);
  });

  it('shows a game when it is searched for, and says so when nothing matches', async () => {
    await mount(createElement(Library));
    const search = host.querySelector<HTMLInputElement>('input[type="search"]')!;
    expect(host.textContent).toMatch(new RegExp(`Showing ${GAMES.length} of ${GAMES.length}`));

    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(search, 'chess');
    await act(async () => { search.dispatchEvent(new Event('input', { bubbles: true })); });
    const shown = Number(/Showing (\d+) of 20/.exec(host.textContent ?? '')?.[1]);
    expect(shown).toBeGreaterThan(0);
    expect(host.querySelectorAll('article')).toHaveLength(shown);

    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(search, 'zzzznothing');
    await act(async () => { search.dispatchEvent(new Event('input', { bubbles: true })); });
    expect(host.textContent).toMatch(/Showing 0 of 20/);
    expect(host.textContent).toMatch(/Nothing matches that yet/);
  });
});
