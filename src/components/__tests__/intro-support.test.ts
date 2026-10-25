// @vitest-environment jsdom
/**
 * The two things this file exists to protect.
 *
 * 1. **The cold open has no way out of it.** The intro runs once per session and is
 *    meant to be short enough to sit through, so the skip button was removed on
 *    purpose. That is an easy thing to "helpfully" add back, so the test asserts
 *    there is nothing to click and nothing that says skip — and that the sequence
 *    always ends on its own, including for reduced motion.
 * 2. **The tip jar is a real link in a proper place.** One anchor, to the right
 *    address, target=_blank, rel=noopener noreferrer, with an accessible name.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { StoreProvider } from '../../lib/store';
import Intro from '../../screens/Intro';
import { SupportCard, SupportLink, SUPPORT_URL } from '../Support';

let host: HTMLDivElement;
let root: Root;

const media = (reduce: boolean) => (q: string) => ({
  matches: reduce && q.includes('reduce'), media: q, onchange: null,
  addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false,
} as unknown as MediaQueryList);

beforeAll(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  (window as any).scrollTo ??= () => {};
  // jsdom ships no matchMedia; the store probes it for pointer type and quality
  (window as any).matchMedia = media(false);
});

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  host.remove();
  vi.useRealTimers();
});

function mount(el: React.ReactElement) {
  return act(async () => {
    root.render(createElement(MemoryRouter, null, createElement(StoreProvider, null, el)));
  });
}

/** every element a person could actually click */
const clickables = () => [...host.querySelectorAll<HTMLElement>('button, a[href], input, [role="button"], [tabindex="0"]')];

describe('the intro cannot be skipped, and always ends', () => {
  it('offers nothing to click and no skip copy', async () => {
    vi.useFakeTimers();
    let done = 0;
    await mount(createElement(Intro, { onDone: () => { done++; } }));

    // sample the whole timeline, not just the first frame
    for (const at of [0, 800, 1600, 2400, 3200]) {
      await act(async () => { vi.advanceTimersByTime(at === 0 ? 1 : 800); });
      expect(clickables(), `nothing is clickable at ~${at}ms`).toHaveLength(0);
      expect(host.textContent ?? '').not.toMatch(/skip/i);
    }
    expect(done, 'it has not finished early').toBe(0);

    await act(async () => { vi.advanceTimersByTime(2000); });
    expect(done, 'and it hands over to the app on its own').toBe(1);
  });

  it('still finishes on time with reduced motion, and shakes nothing', async () => {
    vi.useFakeTimers();
    (window as any).matchMedia = media(true);
    let done = 0;
    await mount(createElement(Intro, { onDone: () => { done++; } }));
    await act(async () => { vi.advanceTimersByTime(1300); });
    expect(done, 'reduced motion is a 1.2 s title card').toBe(1);
    expect(clickables()).toHaveLength(0);
    (window as any).matchMedia = media(false);
  });
});

describe('the tip jar', () => {
  it('is one real anchor to the right place, opening in a new tab', async () => {
    await mount(createElement(SupportCard));
    const links = host.querySelectorAll('a[href]');
    expect(links, 'exactly one support link on the card').toHaveLength(1);
    const a = links[0];
    expect(a.getAttribute('href')).toBe('https://buymeacoffee.com/razalpa');
    expect(SUPPORT_URL).toBe('https://buymeacoffee.com/razalpa');
    expect(a.getAttribute('target')).toBe('_blank');
    expect(a.getAttribute('rel')).toMatch(/noopener/);
    expect(a.getAttribute('rel')).toMatch(/noreferrer/);
    // the visible label, plus the non-visual note that it leaves the site
    expect(a.textContent).toMatch(/Buy me a coffee/);
    expect(a.textContent).toMatch(/new tab/);
  });

  it('says plainly that nothing depends on it', async () => {
    await mount(createElement(SupportCard));
    expect(host.textContent).toMatch(/free/i);
    expect(host.textContent).toMatch(/No ads/i);
  });

  it('the compact link is an anchor too — never a button pretending', async () => {
    await mount(createElement(SupportLink, {}));
    expect(host.querySelectorAll('button')).toHaveLength(0);
    expect(host.querySelector('a')?.getAttribute('href')).toBe(SUPPORT_URL);
  });
});
