// @vitest-environment jsdom
/**
 * `/retro/dos.html` — the player document, driven for real.
 *
 * This file exists because of a bug that a browser would have caught in a second
 * and that every test we had was blind to: the page called `window.Dos()` without
 * `autoStart`, js-dos loaded the bundle and then **parked on its own pre-run
 * screen** — a Play button, no canvas, no error — and our watchdog reported "DOS
 * started, but no screen appeared" 25 seconds later. The emulator was fine; the
 * player was waiting for a click that this page never made and never mentioned.
 *
 * So these tests do not stub our own helpers: they load the shipped document in
 * jsdom, replace only `window.fetch` (serving the real shelf and the real core
 * file names) and `window.Dos` (recording the options we pass and letting the
 * test drive js-dos's side of the contract), and then assert what a visitor
 * would see:
 *
 *   1. the options we hand js-dos are the ones that make it start by itself;
 *   2. when js-dos says `ci-ready`, the boot card goes and the desk says running;
 *   3. when a canvas appears without that event, we still notice;
 *   4. when js-dos sits on its pre-run screen anyway, we press its Play button
 *      rather than showing a dead rectangle;
 *   5. when js-dos shows an error of its own, we repeat its words.
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const html = readFileSync(join(root, 'public/retro/dos.html'), 'utf8');
const shelf = readFileSync(join(root, 'public/retro/dos/shelf.json'), 'utf8');

/** The id the document will boot in these tests. */
const GAME = 'floppybird';

interface Harness {
  dom: JSDOM;
  messages: Record<string, unknown>[];
  options: Record<string, unknown> | null;
  boot: HTMLElement;
  host: HTMLElement;
}

const WASM = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);

/** A `Response`-shaped object: the document only reads ok/status/headers/body. */
function reply(body: string | Uint8Array, init: { status?: number; type?: string } = {}) {
  const bytes = typeof body === 'string' ? new TextEncoder().encode(body) : body;
  const type = init.type ?? 'application/octet-stream';
  return {
    ok: (init.status ?? 200) < 400,
    status: init.status ?? 200,
    headers: { get: (name: string) => (name.toLowerCase() === 'content-type' ? type : null) },
    text: () => Promise.resolve(typeof body === 'string' ? body : new TextDecoder().decode(bytes)),
    json: () => Promise.resolve(JSON.parse(typeof body === 'string' ? body : new TextDecoder().decode(bytes))),
    arrayBuffer: () => Promise.resolve(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)),
  };
}

function serve(url: string) {
  if (url.includes('/retro/dos/shelf.json')) return reply(shelf, { type: 'application/json' });
  if (url.endsWith('/emulators.js')) return reply('var emulators = { pathPrefix: "" };', { type: 'text/javascript' });
  if (url.endsWith('/wdosbox.js')) return reply('/* dosbox glue */', { type: 'text/javascript' });
  if (url.endsWith('/wdosbox.wasm') || url.endsWith('/wlibzip.wasm')) {
    return reply(WASM, { type: 'application/wasm' });
  }
  if (url.endsWith('/wlibzip.js')) return reply('/* zip reader glue */', { type: 'text/javascript' });
  if (url.endsWith('.jsdos')) return reply(new Uint8Array([0x50, 0x4b, 3, 4]), { status: 206 });
  return reply('not found', { status: 404, type: 'text/html' });
}

async function open(onDos?: (options: Record<string, unknown>, host: HTMLElement) => void): Promise<Harness> {
  const messages: Record<string, unknown>[] = [];
  const harness: Harness = {
    dom: null as unknown as JSDOM,
    messages,
    options: null,
    boot: null as unknown as HTMLElement,
    host: null as unknown as HTMLElement,
  };

  const dom = new JSDOM(html, {
    url: `http://localhost/retro/dos.html?game=${GAME}`,
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(window) {
      /* The document talks to the desk page through `window.parent.postMessage`
         and goes quiet when it is the top window. jsdom's top window is its own
         parent, so give it a stand-in parent and record what it would send. */
      const parent = { postMessage: (data: unknown) => { messages.push(data as Record<string, unknown>); } };
      Object.defineProperty(window, 'parent', { value: parent, configurable: true });

      window.fetch = ((input: RequestInfo | URL) => Promise.resolve(serve(String(input)))) as typeof fetch;

      /* js-dos itself: record the call, then let the test decide what happens
         next — the same way the real library would, only scripted. */
      (window as unknown as { Dos: unknown }).Dos = (element: HTMLElement, options: Record<string, unknown>) => {
        harness.options = options;
        harness.host = element;
        if (onDos) onDos(options, element);
        return { setPaused() {}, setVolume() {}, stop() {}, setSoftFullscreen() {} };
      };
    },
  });

  harness.dom = dom;
  harness.boot = dom.window.document.getElementById('boot') as HTMLElement;
  return harness;
}

/** Let the document's promise chain and its 200 ms poll run. */
const settle = async (ms = 320) => {
  await new Promise((resolve) => setTimeout(resolve, ms));
};

const statuses = (h: Harness) => h.messages.filter((m) => m.type === 'status').map((m) => m.status);

let live: Harness[] = [];
const track = (h: Harness) => { live.push(h); return h; };

beforeEach(() => { live = []; });
afterEach(() => {
  for (const h of live) h.dom.window.close();
});

describe('the DOS player document', () => {
  it('starts js-dos by itself instead of parking on its pre-run screen', async () => {
    const h = track(await open());
    await settle();

    expect(h.options, 'window.Dos was called').toBeTruthy();
    /* The reason this test exists. Without autoStart, js-dos loads the bundle
       and shows a Play button with no canvas — forever. */
    expect(h.options!.autoStart).toBe(true);
    expect(h.options!.countDownStart).toBe(0);
    /* And the chrome that made the screen look broken. */
    expect(h.options!.kiosk).toBe(true);
    expect(h.options!.theme).toBe('dark');
    expect(h.options!.backend).toBe('dosbox');
    expect(h.options!.pathPrefix).toBe('/retro/jsdos/emulators/');
    expect(h.options!.url).toContain('floppybird.jsdos');
  });

  it('treats js-dos’s own ci-ready event as “running”', async () => {
    const h = track(await open());
    await settle();
    expect(h.boot.hidden, 'the boot card is still up').toBe(false);

    (h.options!.onEvent as (event: string) => void)('ci-ready');
    expect(h.messages).toContainEqual(expect.objectContaining({ type: 'ready' }));
    expect(statuses(h)).toContain('running');
    /* Hidden after the 260 ms fade. */
    await settle(320);
    expect(h.boot.hidden).toBe(true);
  });

  it('notices a canvas even when no event arrives', async () => {
    const h = track(await open((_options, host) => {
      const canvas = host.ownerDocument.createElement('canvas');
      canvas.width = 320;
      canvas.height = 200;
      window.setTimeout(() => host.appendChild(canvas), 120);
    }));
    await settle(500);

    expect(statuses(h)).toContain('running');
    expect(h.messages).toContainEqual(expect.objectContaining({ type: 'ready' }));
  });

  it('presses js-dos’s Play button if it still shows the pre-run screen', async () => {
    let pressed = false;
    const h = track(await open((_options, host) => {
      const pre = host.ownerDocument.createElement('div');
      pre.className = 'pre-run-window';
      const button = host.ownerDocument.createElement('button');
      button.textContent = 'Play';
      button.addEventListener('click', () => { pressed = true; });
      pre.appendChild(button);
      host.appendChild(pre);
    }));
    await settle(500);

    /* The visitor is never left on a screen that needs a click nobody explains. */
    expect(pressed).toBe(true);
  });

  it('repeats js-dos’s own error instead of blaming the bundle', async () => {
    const h = track(await open((_options, host) => {
      const win = host.ownerDocument.createElement('div');
      win.className = 'window';
      win.textContent = 'Unable to start the emulator: out of memory';
      host.appendChild(win);
    }));
    await settle(500);

    const error = h.messages.find((m) => m.type === 'error');
    expect(error, 'an error was reported').toBeTruthy();
    expect(String(error!.message)).toContain('emulator reported a problem');
    expect(String(error!.detail)).toContain('out of memory');
  });

});
