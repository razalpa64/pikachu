// @vitest-environment jsdom
/**
 * The Berry Catch screen, without a real canvas.
 *
 * jsdom has no 2D context and no animation-frame budget, so this test does not try
 * to play the game — it checks the parts a person meets first: the run does not
 * start until the player starts it, the field is labelled, and the HUD is real
 * state rather than decoration.
 */
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { StoreProvider } from '../../lib/store';
import { gameById } from '../registry';
import BerrySolo from '../berry/SoloView';

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
  (HTMLCanvasElement.prototype as any).getContext = () => ({
    setTransform() {}, clearRect() {}, fillRect() {}, beginPath() {}, moveTo() {}, lineTo() {},
    stroke() {}, fill() {}, arc() {}, ellipse() {}, save() {}, restore() {}, translate() {},
    rotate() {}, scale() {}, drawImage() {},
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
    fillStyle: '', strokeStyle: '', lineWidth: 0, globalAlpha: 1,
  });
  (globalThis as any).requestAnimationFrame = (cb: FrameRequestCallback) => setTimeout(() => cb(performance.now()), 16) as unknown as number;
  (globalThis as any).cancelAnimationFrame = (id: number) => clearTimeout(id);
});

afterEach(async () => {
  await act(async () => { root?.unmount(); });
  host?.remove();
  vi.restoreAllMocks();
});

async function mount() {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root.render(createElement(MemoryRouter, null,
      createElement(StoreProvider, null, createElement(BerrySolo, { game: gameById('berry')! }))));
  });
}

describe('berry catch screen', () => {
  it('keeps the decorative Pikachu out of the way of the field', async () => {
    // he stands in front of the basket, over the canvas; if any part of that layer
    // took pointer events, dragging the basket by its own sprite would not steer
    await mount();
    const pika = host.querySelector<HTMLImageElement>('img[src*="/art/pika/"]');
    expect(pika, 'the character is drawn as a real image, not a canvas blob').toBeTruthy();
    const layer = pika!.closest('[aria-hidden="true"]') as HTMLElement | null;
    expect(layer?.className).toMatch(/pointer-events-none/);
  });

  it('waits for the player before the clock starts', async () => {
    await mount();
    expect(host.textContent).toMatch(/Catch the ripe ones/);
    expect(host.textContent).toMatch(/Start catching/);
    expect(host.textContent).toMatch(/60s/);

    const start = Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.includes('Start catching'))!;
    await act(async () => { start.click(); });
    expect(host.textContent).not.toMatch(/Catch the ripe ones/);
  });

  it('gives the field a name and a role a screen reader can announce', async () => {
    await mount();
    const canvas = host.querySelector('canvas')!;
    expect(canvas.getAttribute('aria-label')).toBe('Berry Catch play field');
    expect(canvas.getAttribute('role')).toBe('img');
  });

  it('shows the scores it actually keeps', async () => {
    await mount();
    const text = host.textContent ?? '';
    expect(text).toMatch(/Score/);
    expect(text).toMatch(/Caught/);
    expect(text).toMatch(/Lives/);
    expect(text).toMatch(/Time/);
  });
});
