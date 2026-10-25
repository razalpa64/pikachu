// @vitest-environment jsdom
/**
 * The front door, rendered for real.
 *
 * The hero is the one screen every visitor sees before anything else, and the
 * things that go wrong with a hero are not crashes — they are quiet failures of
 * hierarchy and honesty:
 *
 *   • three calls to action dressed in the same weight, so nothing is first;
 *   • the picture dressed as a framed postcard instead of the place itself;
 *   • a second copy of the trainer card arguing with the one in the top bar;
 *   • a number on the page that the registry does not agree with.
 *
 * These tests pin each of those. They are structural on purpose: jsdom can see
 * the markup and the classes, which is exactly where those decisions live.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { StoreProvider } from '../../lib/store';
import { RoomProvider } from '../../lib/useRoom';
import { HomeHero } from '../HomeHero';
import { GAMES } from '../../games/registry';

let host: HTMLDivElement;
let root: Root;

beforeAll(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  (window as any).scrollTo = () => {};
  (window as any).matchMedia ??= (q: string) => ({
    matches: false, media: q, onchange: null,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false,
  });
  (window as any).WebSocket ??= class { close() {} addEventListener() {} };
  (HTMLMediaElement.prototype as any).play ??= () => Promise.resolve();
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

async function mount() {
  await act(async () => {
    root.render(createElement(MemoryRouter, null,
      createElement(StoreProvider, null, createElement(RoomProvider, null, createElement(HomeHero)))));
  });
}

const buttons = () => [...host.querySelectorAll<HTMLElement>('button')];
const label = (b: HTMLElement) => (b.textContent ?? '').replace(/\s+/g, ' ').trim();

describe('home hero — what it says', () => {
  it('leads with one headline that names the place', async () => {
    await mount();
    const h1 = host.querySelectorAll('h1');
    expect(h1).toHaveLength(1);
    expect(h1[0].textContent).toContain('PIKACHU');
    expect(h1[0].textContent).toContain('ARCADE');
    expect(h1[0].getAttribute('aria-label')).toBe('Pikachu Arcade');
  });

  it('counts what the registry actually holds', async () => {
    await mount();
    const text = host.textContent ?? '';
    expect(text).toContain(`${GAMES.length} hand-built games`);
    expect(text).toContain(`${GAMES.filter((g) => g.serverRefereed).length} play online`);
    // and invents nothing
    expect(text).not.toMatch(/\b(?:trusted by|coming soon|\d+(?:\.\d+)?\s*\/\s*5)\b/i);
    expect(text).not.toMatch(/\d+\s*(?:k|m|\+)?\s*(?:players|users)\b/i);
  });

  it('shows no zeros on a first visit, and no fake record', async () => {
    await mount();
    expect(host.textContent).not.toMatch(/Matches\s*0|Wins\s*0/);
    expect(localStorage.getItem('pikachu.progress.v1')).toBeNull();
  });
});

describe('home hero — hierarchy', () => {
  it('has exactly one filled primary action, and it is the way in', async () => {
    await mount();
    const primary = buttons().filter((b) => b.className.includes('btn-primary'));
    expect(primary, 'one filled button, or the eye has no first stop').toHaveLength(1);
    expect(label(primary[0])).toBe('Play now');
  });

  it('keeps the second and third actions quieter than the first', async () => {
    await mount();
    const together = buttons().find((b) => label(b).includes('Play together'))!;
    expect(together, 'playing together is still offered').toBeTruthy();
    expect(together.className, 'and it is not a second primary').not.toContain('btn-primary');

    const solo = buttons().find((b) => label(b).includes('Solo & AI'))!;
    expect(solo).toBeTruthy();
    expect(solo.className, 'the third action is a text link, not a button').not.toContain('btn');
  });
});

describe('home hero — the invitation', () => {
  it('answers "how do we play together?" where the question is asked', async () => {
    await mount();
    const card = host.querySelector<HTMLElement>('aside')!;
    expect(card, 'the private-arena card').toBeTruthy();
    expect(card.textContent).toMatch(/Private arena/i);
    const create = buttons().find((b) => /Create a room/.test(label(b)))!;
    expect(create, 'somewhere to open a room').toBeTruthy();
    expect(create.className, 'the invitation is blush, so "Play now" stays the only volt button')
      .toContain('btn-blue');
    expect(buttons().some((b) => /Join with a code/i.test(label(b)))).toBe(true);
    // the relay state is reported, not guessed
    expect(card.textContent).toMatch(/Relay (live|idle)/i);
  });

  it('carries the trainer stub once, with a level bar, and no second profile', async () => {
    await mount();
    const bars = host.querySelectorAll('[role="progressbar"]');
    expect(bars, 'one level bar in the hero').toHaveLength(1);
    expect(bars[0].getAttribute('aria-label')).toBe('Level progress');
    expect(host.textContent).toMatch(/Set your trainer name/);
    // the trainer line lives in the ticket, not floating over the artwork
    expect(host.querySelector('aside')!.textContent).toMatch(/Set your trainer name/);
  });
});

describe('home hero — the horizon', () => {
  it('is the painting itself: full bleed, unframed, no card around it', async () => {
    await mount();
    const art = host.querySelector<HTMLImageElement>('img[src="/art/scene/hero.webp"]')!;
    expect(art, 'the picnic painting').toBeTruthy();
    expect(art.getAttribute('alt'), 'a described picture, not decoration').toMatch(/picnic/i);
    expect(art.getAttribute('fetchpriority') ?? art.getAttribute('fetchPriority')).toBe('high');
    expect(art.getAttribute('width')).toBe('1568');

    const classes = art.className;
    // the user's own instruction, as a test: no frame, no rounded picture, no mount
    expect(classes).not.toMatch(/\brounded/);
    expect(classes).not.toMatch(/\bborder/);
    expect(classes).not.toMatch(/\bring|\bshadow/);
    // and it runs the full width rather than sitting in a padded column
    expect(classes).toContain('w-full');

    const frame = art.parentElement!;
    expect(frame.className).not.toMatch(/\brounded|\bborder|\bp-\d|max-w-\[/);
  });

  it('stands Pikachu on it without covering either the caption or a tap target', async () => {
    await mount();
    const art = host.querySelector('img[src="/art/scene/hero.webp"]')!;
    const band = art.parentElement!;
    const mascot = band.querySelector('[role="img"]')!;
    expect(mascot.getAttribute('aria-label')).toMatch(/Pikachu/i);
    const poke = mascot.closest('[class*="pointer-events-none"]');
    expect(poke, 'the mascot must never eat a click').toBeTruthy();
    expect(band.textContent).toMatch(/Made for two/);
  });

  it('marks the painting decorative-free: exactly one hero image, loaded once', async () => {
    await mount();
    const heroes = [...host.querySelectorAll('img')].filter((i) => i.getAttribute('src') === '/art/scene/hero.webp');
    expect(heroes).toHaveLength(1);
    expect(heroes[0].getAttribute('loading')).toBeNull(); // eager: it is the first paint
  });
});
