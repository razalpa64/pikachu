// @vitest-environment jsdom
/**
 * The two DOS surfaces, rendered for real.
 *
 * What is pinned here is the part a smoke test over HTTP cannot see: that the
 * React page looks the game up in the shelf *before* it mounts an emulator, that
 * it hands the player document the id it just verified, and that an id which is
 * not on the shelf produces a sentence instead of a dead black rectangle.
 *
 * The last test is the one the whole phase exists for: with the DOS lens open,
 * the 1,499 discovery records are never requested at all, so a visitor cannot
 * reach a pending title even by guessing a URL.
 */
/* The suite is a .test.ts file, not .tsx: vite.config.ts only includes
   src tests ending in .test.ts, and the other screen tests build their trees
   with createElement for the same reason. JSX would need a config change. */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { StoreProvider } from '../../lib/store';
import { RoomProvider } from '../../lib/useRoom';
import Retro from '../Retro';
import RetroDos from '../RetroDos';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const shelfJson = JSON.parse(readFileSync(join(root, 'public/retro/dos/shelf.json'), 'utf8'));
const romsJson = JSON.parse(readFileSync(join(root, 'public/retro/roms.json'), 'utf8'));
/** A title the index knows about and nobody has cleared. Its name must not reach
 *  a visitor's page — that is the difference between a review queue and a shop. */
const pending = (JSON.parse(readFileSync(join(root, 'public/retro/dos/catalog.json'), 'utf8')) as {
  entries: { id: string; title: string; stage: string }[];
}).entries.find((e) => e.stage === 'pending-rights-review' && e.title.length > 8);

let host: HTMLDivElement;
let tree: Root;
let asked: string[];

/** Only the two manifests exist in this browser; everything else is a 404. */
const answer = (input: RequestInfo | URL) => {
  const url = String(input);
  asked.push(url);
  if (url.includes('/retro/dos/shelf.json')) {
    return Promise.resolve(new Response(JSON.stringify(shelfJson), { status: 200, headers: { 'content-type': 'application/json' } }));
  }
  if (url.includes('/retro/roms.json')) {
    return Promise.resolve(new Response(JSON.stringify(romsJson), { status: 200, headers: { 'content-type': 'application/json' } }));
  }
  return Promise.resolve(new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }));
};

beforeAll(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  (window as any).scrollTo = () => {};
  (window as any).matchMedia ??= (q: string) => ({
    matches: false, media: q, onchange: null,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false,
  });
  (window as any).WebSocket ??= class { close() {} addEventListener() {} };
});

beforeEach(() => {
  localStorage.clear();
  asked = [];
  vi.stubGlobal('fetch', vi.fn(answer));
  host = document.createElement('div');
  document.body.appendChild(host);
  tree = createRoot(host);
});

afterEach(async () => {
  await act(async () => { tree.unmount(); });
  host.remove();
  vi.unstubAllGlobals();
});

/** Let the shelf promise resolve and React commit the result. */
const settle = async () => {
  await act(async () => { await Promise.resolve(); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
};

async function mountDos(id: string) {
  await act(async () => {
    tree.render(createElement(MemoryRouter, { initialEntries: [`/retro/dos/${id}`] },
      createElement(StoreProvider, null,
        createElement(RoomProvider, null,
          createElement(Routes, null, createElement(Route, { path: '/retro/dos/:id', element: createElement(RetroDos) }))))));
  });
  await settle();
}

async function mountShelf(url: string) {
  await act(async () => {
    tree.render(createElement(MemoryRouter, { initialEntries: [url] },
      createElement(StoreProvider, null,
        createElement(RoomProvider, null,
          createElement(Routes, null, createElement(Route, { path: '/retro', element: createElement(Retro) }))))));
  });
  await settle();
}

describe('the DOS player page', () => {
  it('reads the shelf, then hands the verified id to the player', async () => {
    await mountDos('pikachu-calibration');

    expect(host.querySelector('h1')?.textContent).toContain('Calibration');
    const frame = host.querySelector('iframe');
    expect(frame, 'the emulator is a separate document').not.toBeNull();
    expect(frame?.getAttribute('src')).toBe('/retro/dos.html?game=pikachu-calibration');
    expect(frame?.getAttribute('title')).toContain('DOS emulator');
    /* The iframe is the whole emulator: js-dos pulls its core and the bundle
       itself, once this page has decided the game exists. */
    expect(frame?.getAttribute('allow')).toContain('fullscreen');

    /* Controls the player document actually answers — none of them invented. */
    const labels = [...host.querySelectorAll('button')].map((b) => b.textContent ?? '');
    expect(labels).toContain('Pause');
    expect(labels).toContain('Fullscreen');
    expect(labels).toContain('Stop');
    /* The paperwork is real: licence, source, and why it may be hosted. */
    expect(host.textContent).toContain('CC0-1.0');
    expect(host.textContent).toContain('Authored for this project');
    expect(host.textContent).toContain('js-dos 8.5.3');
  });

  it('refuses an id that is not on the shelf, without loading an emulator', async () => {
    await mountDos('doom-shareware');

    expect(host.querySelector('iframe')).toBeNull();
    expect(host.textContent).toContain('No such game on the DOS shelf');
    /* The reason is stated, not implied. */
    expect(host.textContent).toContain('checked and the right to host it was recorded');
    /* Nothing was fetched from the 1,499-record index to find that out. */
    expect(asked.some((u) => u.includes('catalog.json'))).toBe(false);
  });
});

describe('the shelf with the DOS lens open', () => {
  it('lists the hosted game and never the pending ones', async () => {
    await mountShelf('/retro?platform=dos');

    expect(host.textContent).toContain('MS-DOS');
    expect(host.textContent).toContain('Calibration');
    const play = [...host.querySelectorAll('button')].filter((b) => (b.textContent ?? '').trim() === 'Play');
    expect(play.length).toBe(1);

    /* The discovery index is not a visitor surface: it is not requested here,
       not rendered here, and no pending title has a Play button. */
    expect(asked.some((u) => u.includes('catalog.json'))).toBe(false);
    /* The index's own labels are explained on the page — “freeware is not a
       licence” is the point being made — but no pending *title* appears. */
    expect(pending, 'the index has a pending record to check against').toBeTruthy();
    expect(host.textContent).not.toContain(pending!.title);

    /* The GBA-only furniture stays with the GBA lens. */
    expect(host.textContent).not.toContain('Play a ROM you already own');
    expect(host.textContent).toContain('Why there is one DOS game');
    /* The honesty block is the DOS one, not the cartridge one. */
    expect(host.textContent).toContain('A label is not a licence');
    expect(host.textContent).not.toContain('Nothing loads until you press Insert');
  });

  it('still shows the cartridges when the lens is left alone', async () => {
    await mountShelf('/retro');

    expect(host.textContent).toContain('Play a ROM you already own');
    expect(host.textContent).not.toContain('Why there is one DOS game');
    /* The DOS manifest is fetched lazily, so a GBA visit does not pay for it. */
    expect(asked.some((u) => u.includes('/retro/dos/shelf.json'))).toBe(false);
  });
});
