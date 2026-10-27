// @vitest-environment jsdom
/**
 * The top bar has to stay one line tall.
 *
 * When Retro Arcade was added the primary nav became seven items, and at 1024-
 * 1600px three of the names ("Play Together", "Retro Arcade", "Our Music") broke
 * onto two lines inside their pills. The row grew to fit the tallest item, so the
 * bar read as ragged, the active pill became an oval, and the tooltip row of the
 * whole header grew by 4px. The fix has two halves, and this pins both:
 *
 *   1. every nav label is a single word below `2xl` (the full name comes back at
 *      `2xl`, where there is room to guarantee it fits), and
 *   2. nothing in the label markup can wrap or overflow at all.
 *
 * A DOM test cannot measure text, so it checks the contract the CSS depends on:
 * one visible label span per breakpoint, both marked `aria-hidden`, with the
 * accessible name carried by the link's own `aria-label`.
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { StoreProvider } from '../../lib/store';
import { RoomProvider } from '../../lib/useRoom';
import AppShell from '../AppShell';

let host: HTMLDivElement;
let root: Root | null = null;

beforeAll(() => {
  // jsdom ships no matchMedia and no WebSocket; the store probes both on boot.
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  (window as any).scrollTo = () => {};
  (window as any).matchMedia ??= (q: string) => ({
    matches: false, media: q, onchange: null,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false,
  });
  (window as any).WebSocket ??= class { close() {} addEventListener() {} };
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
  host = document.createElement('div');
  document.body.appendChild(host);
});

function render() {
  if (!host) {
    host = document.createElement('div');
    document.body.appendChild(host);
  }
  act(() => {
    root = createRoot(host);
    root.render(
      createElement(StoreProvider, null,
        createElement(MemoryRouter, { initialEntries: ['/retro'] },
          createElement(RoomProvider, null,
            createElement(AppShell, null, createElement('p', null, 'content'))))),
    );
  });
  return [...host.querySelectorAll('nav[aria-label="Primary"] a')] as HTMLAnchorElement[];
}

const singleWord = (s: string) => !/\s/.test(s);

describe('primary navigation', () => {
  it('renders every primary destination', () => {
    const links = render();
    expect(links).toHaveLength(7);
    expect(links.map((a) => a.getAttribute('aria-label'))).toEqual([
      'Home', 'Library', 'Play Together', 'Solo', 'Retro Arcade', 'Challenges', 'Our Music',
    ]);
  });

  it('shows one single-word label per link, and the full name at 2xl', () => {
    const links = render();
    for (const link of links) {
      const spans = [...link.querySelectorAll('span > span')] as HTMLElement[];
      expect(spans.length, `${link.getAttribute('aria-label')} label spans`).toBe(2);
      const [compact, wide] = spans;
      // The compact label is the one that renders at every width up to 2xl, so
      // it is the one that must never contain a space.
      expect(singleWord(compact.textContent ?? ''), 'compact label wraps').toBe(true);
      expect(wide.textContent).toBe(link.getAttribute('aria-label'));
      expect(wide.className).toContain('hidden');
      expect(compact.className).toContain('2xl:hidden');
    }
  });

  it('cannot wrap, and does not repeat itself for a screen reader', () => {
    const links = render();
    for (const link of links) {
      const row = link.querySelector('span > span')?.parentElement as HTMLElement | null;
      expect(row?.className).toContain('whitespace-nowrap');
      // Both label spans are hidden from assistive tech, so the accessible name
      // is exactly what aria-label says — not "RetroRetro Arcade".
      for (const span of link.querySelectorAll('span > span')) {
        expect(span.getAttribute('aria-hidden')).toBe('true');
      }
      expect(link.getAttribute('aria-label')).not.toBeNull();
    }
  });

  it('can shrink instead of pushing the right-hand controls off the row', () => {
    const links = render();
    for (const link of links) expect(link.className).toContain('shrink-0');
  });

  /**
   * The bottom bar is the app.
   *
   * It used to be six tabs plus a hamburger drawer that repeated all ten
   * destinations, so there were two ways to do everything and neither was
   * obviously the real one. The tab bar now holds the five screens you *play*
   * — five, because 390 px of screen gives five tabs 78 px each and six 65 px —
   * and the account button opens a sheet with the rest.
   */
  it('gives the phone five roomy tabs, not six cramped ones', () => {
    render();
    const mobile = host.querySelectorAll('nav[aria-label="Quick"] a');
    expect(mobile).toHaveLength(5);
    /* The accessible name is the visible word, not the long route name: on a
       phone "tap Games" has to work for someone using voice control, and a tab
       whose label says Games while its name says Library breaks that. */
    const labels = [...mobile].map((a) => a.textContent?.trim());
    expect(labels).toEqual(['Home', 'Games', 'Together', 'Solo', 'Retro']);
    for (const a of mobile) expect(a.getAttribute('aria-label')).toBeNull();
    /* each tab carries an icon and a single word, never a wrapped sentence */
    for (const a of mobile) {
      expect(a.querySelector('svg'), 'a tab without an icon reads as a menu item').not.toBeNull();
      expect(/\s/.test(a.textContent?.trim() ?? ''), `"${a.textContent}" wraps`).toBe(false);
    }
  });

  it('replaces the duplicate drawer with an account sheet', () => {
    render();
    expect(host.querySelector('nav[aria-label="Mobile"]'), 'the old drawer is gone').toBeNull();
    const account = host.querySelector<HTMLButtonElement>('[aria-label="You — profile, challenges and settings"]');
    expect(account, 'the account button exists').not.toBeNull();
    expect(account!.getAttribute('aria-haspopup')).toBe('dialog');
    expect(account!.getAttribute('aria-expanded')).toBe('false');
    /* nothing that used to live in the drawer was lost: the sheet is rendered
       from the same NAV list, and every destination is still reachable */
    expect(host.querySelectorAll('nav[aria-label="Primary"] a').length
      + host.querySelectorAll('nav[aria-label="Quick"] a').length).toBeGreaterThanOrEqual(10);
  });

  it('opens a labelled dialog from the account button, and closes on Escape', () => {
    render();
    const account = host.querySelector<HTMLButtonElement>('[aria-label="You — profile, challenges and settings"]')!;
    act(() => { account.click(); });
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog, 'a sheet is a dialog').not.toBeNull();
    expect(dialog!.getAttribute('aria-modal')).toBe('true');
    /* every destination the drawer used to hold is a button in the sheet */
    const sheetLabels = [...dialog!.querySelectorAll('button')].map((b) => b.textContent?.trim() ?? '');
    for (const label of ['Daily', 'Music', 'Cups', 'You', 'Setup']) {
      expect(sheetLabels.some((t) => t.toUpperCase() === label.toUpperCase()), `${label} is in the sheet`).toBe(true);
    }
    act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(document.querySelector('[role="dialog"]'), 'Escape dismisses it').toBeNull();
  });

  it('names the screen you are on, the way a title bar does', () => {
    render();
    const title = host.querySelector('header p[aria-hidden="true"]');
    expect(title?.textContent?.trim()).toBe('Retro Arcade');
  });
});
