// @vitest-environment jsdom
/**
 * The two things this file exists to protect.
 *
 * 1. **The cold open is short, has no skip control, and never gates anything.**
 *    It was asked for without one, so the tests assert the opposite of the usual
 *    rule: exactly zero buttons, zero links, and nothing focusable. What makes
 *    that acceptable is enforced elsewhere and is asserted here too — it runs
 *    once per session on the front page only (so a deep link or a room code never
 *    waits behind it), it hands over on its own in under three and a half
 *    seconds, and reduced motion gets a one-second card.
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

describe('the intro is short, has no exit control, and always ends by itself', () => {
  it('offers nothing to click and nothing to tab to', async () => {
    vi.useFakeTimers();
    await mount(createElement(Intro, { onDone: () => {} }));

    expect(clickables(), 'a splash without a skip button must not hide one elsewhere').toHaveLength(0);
    expect(host.querySelectorAll('button')).toHaveLength(0);
    expect(host.querySelectorAll('a')).toHaveLength(0);
  });

  it('does not leave on Escape or any other key', async () => {
    vi.useFakeTimers();
    let done = 0;
    await mount(createElement(Intro, { onDone: () => { done++; } }));
    for (const key of ['Escape', 'Enter', ' ', 's']) {
      await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key })); });
    }
    await act(async () => { vi.advanceTimersByTime(400); });
    expect(done, 'the keyboard does not dismiss it').toBe(0);
  });

  it('finishes on its own within 3.5 s, without anybody touching it', async () => {
    vi.useFakeTimers();
    let done = 0;
    await mount(createElement(Intro, { onDone: () => { done++; } }));

    await act(async () => { vi.advanceTimersByTime(3000); });
    expect(done, 'it has not finished early').toBe(0);

    await act(async () => { vi.advanceTimersByTime(1200); });
    expect(done, 'and it hands over to the app on its own').toBe(1);
  });

  it('hands over exactly once, even if the timers fire again', async () => {
    vi.useFakeTimers();
    let done = 0;
    await mount(createElement(Intro, { onDone: () => { done++; } }));
    await act(async () => { vi.advanceTimersByTime(6000); });
    await act(async () => { vi.advanceTimersByTime(6000); });
    expect(done, 'the hand-over is idempotent').toBe(1);
  });

  it('is a one-second static title card with reduced motion', async () => {
    vi.useFakeTimers();
    (window as any).matchMedia = media(true);
    let done = 0;
    await mount(createElement(Intro, { onDone: () => { done++; } }));
    expect(clickables(), 'still no controls').toHaveLength(0);
    await act(async () => { vi.advanceTimersByTime(1400); });
    expect(done, 'reduced motion is a 1 s title card').toBe(1);
    (window as any).matchMedia = media(false);
  });
});

describe('the tip jar', () => {
  it('is one real anchor to the right place, opening in a new tab', async () => {
    await mount(createElement(SupportCard));
    const links = [...host.querySelectorAll('a[href]')];
    const support = links.filter((el) => el.getAttribute('href') === SUPPORT_URL);
    expect(support, 'exactly one support link on the card').toHaveLength(1);
    const a = support[0];
    expect(a.getAttribute('href')).toBe('https://buymeacoffee.com/razalpa');
    expect(SUPPORT_URL).toBe('https://buymeacoffee.com/razalpa');
    expect(a.getAttribute('target')).toBe('_blank');
    expect(a.getAttribute('rel')).toMatch(/noopener/);
    expect(a.getAttribute('rel')).toMatch(/noreferrer/);
    // the visible label, plus the non-visual note that it leaves the site
    expect(a.textContent).toMatch(/Buy me a coffee/);
    expect(a.textContent).toMatch(/new tab/);
  });

  it('also points at the suggestion box, as an in-app link rather than a new tab', async () => {
    await mount(createElement(SupportCard));
    const feedback = [...host.querySelectorAll('a[href]')].find((el) => el.getAttribute('href') === '/feedback');
    expect(feedback, 'the tip-jar card links to /feedback').toBeTruthy();
    expect(feedback!.getAttribute('target'), 'an internal link must stay in the tab').toBeNull();
    expect(feedback!.textContent).toMatch(/Reviews & ideas/);
  });

  it('says plainly that nothing depends on it', async () => {
    await mount(createElement(SupportCard));
    expect(host.textContent).toMatch(/free/i);
    expect(host.textContent).toMatch(/No ads/i);
    // and it must stay true once a publisher id exists: ads are opt-in, not default
    expect(host.textContent).toMatch(/unless you (choose|allow)/i);
  });

  it('the compact link is an anchor too — never a button pretending', async () => {
    await mount(createElement(SupportLink, {}));
    expect(host.querySelectorAll('button')).toHaveLength(0);
    expect(host.querySelector('a')?.getAttribute('href')).toBe(SUPPORT_URL);
  });
});
