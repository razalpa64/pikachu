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

  it('keeps the mobile bar at six entries', () => {
    const links = render();
    expect(links.length).toBeGreaterThanOrEqual(6);
    const mobile = host.querySelectorAll('nav[aria-label="Quick"] a');
    expect(mobile).toHaveLength(6);
    expect([...mobile].map((a) => a.textContent?.trim())).toContain('Retro');
  });
});
