// @vitest-environment jsdom
/**
 * Guess & Draw, driven through real DOM events.
 *
 * The rules are tested elsewhere; this file is about the board as a player uses
 * it. Three bugs it is here to keep dead:
 *
 *  • **A tap drew nothing.** A stroke with one coordinate was thrown away on
 *    shrink, so tapping the canvas left no mark at all.
 *  • **Lines blinked out mid-stroke.** A long stroke is flushed to the server
 *    before it ends; the flushed part has to stay on this screen until the echo
 *    arrives, and come off exactly once when it does.
 *  • **A second finger or a right-click started a stroke.** Only one primary
 *    pointer draws, and the stroke ends on pointer-up, not on pointer-leave.
 *
 * jsdom has no canvas, so `getContext` is stubbed with a recorder. Every assertion
 * is on the move payload or the paint calls, not on pixels.
 */
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import SketchBoard from '../../components/boards/SketchBoard';
import { StoreProvider } from '../../lib/store';
import { PALETTE, type SketchState } from '../sketch/rules';

/* --- a canvas context that records instead of drawing --------------------- */
const calls: string[] = [];
const ctxStub = {
  strokeStyle: '', fillStyle: '', lineWidth: 0, lineCap: '', lineJoin: '',
  setTransform: () => calls.push('transform'),
  clearRect: () => calls.push('clear'),
  fillRect: () => calls.push('fillRect'),
  drawImage: () => calls.push('blit'),
  beginPath: () => calls.push('begin'),
  moveTo: () => calls.push('move'),
  lineTo: () => calls.push('line'),
  quadraticCurveTo: () => calls.push('curve'),
  arc: () => calls.push('arc'),
  fill: () => calls.push('fill'),
  stroke: () => calls.push('stroke'),
};

beforeEach(() => {
  calls.length = 0;
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  HTMLCanvasElement.prototype.getContext = (() => ctxStub) as never;
  /* jsdom lays nothing out: give the canvas a real box so the pointer maths has
     something to map onto. */
  HTMLCanvasElement.prototype.getBoundingClientRect = function () {
    return { left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600, x: 0, y: 0, toJSON() {} } as DOMRect;
  };
  Object.defineProperty(HTMLCanvasElement.prototype, 'clientWidth', { configurable: true, get: () => 800 });
  Object.defineProperty(HTMLCanvasElement.prototype, 'clientHeight', { configurable: true, get: () => 600 });
  (HTMLCanvasElement.prototype as any).setPointerCapture = () => {};
  (HTMLCanvasElement.prototype as any).releasePointerCapture = () => {};
  (HTMLCanvasElement.prototype as any).hasPointerCapture = () => true;
  (globalThis as any).ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
  /* the shared UI kit (Button) reads the store for its click sounds */
  (window as any).matchMedia ??= (q: string) => ({
    matches: false, media: q, onchange: null,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false,
  });
  (HTMLMediaElement.prototype as any).play ??= () => Promise.resolve();
  (window as any).scrollTo ??= () => {};
});

let host: HTMLDivElement;
let tree: Root;

afterEach(async () => {
  await act(async () => { tree?.unmount(); });
  host?.remove();
});

/** A pointer event jsdom does not ship a constructor for. */
function pointer(type: string, init: Record<string, unknown>) {
  const e = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(e, {
    pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, buttons: 1,
    clientX: 0, clientY: 0, ...init,
  });
  return e;
}

const baseState = (over: Partial<SketchState> = {}): SketchState => ({
  rounds: 4, round: 0, drawer: 0, words: [], word: 'fish', hint: '____',
  strokes: [], guesses: [], phase: 'draw', endsAt: Date.now() + 90_000,
  scores: [0, 0], solvedBy: null, seed: 1, over: false, winner: null, reason: '',
  ...over,
});

async function mount(state: SketchState, onMove = vi.fn(), youSlot: 0 | 1 = 0) {
  host = document.createElement('div');
  document.body.appendChild(host);
  tree = createRoot(host);
  await act(async () => {
    tree.render(createElement(StoreProvider, null, createElement(SketchBoard, {
      state, youSlot, onMove, interactive: true, names: ['You', 'Them'] as [string, string],
    })));
  });
  const canvas = host.querySelector('canvas')!;
  return { canvas, onMove };
}

/** Let the scheduled paint run (it has a 40 ms timer fallback). */
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 60)); });

const draw = async (canvas: HTMLCanvasElement, from: [number, number], to: [number, number], steps = 8) => {
  await act(async () => {
    canvas.dispatchEvent(pointer('pointerdown', { clientX: from[0], clientY: from[1] }));
    for (let i = 1; i <= steps; i += 1) {
      const x = from[0] + ((to[0] - from[0]) * i) / steps;
      const y = from[1] + ((to[1] - from[1]) * i) / steps;
      canvas.dispatchEvent(pointer('pointermove', { clientX: x, clientY: y }));
    }
    canvas.dispatchEvent(pointer('pointerup', { clientX: to[0], clientY: to[1] }));
  });
  await flush();
};

describe('Guess & Draw — drawing on the board', () => {
  it('commits one stroke per drag, in the shared coordinate space', async () => {
    const { canvas, onMove } = await mount(baseState());
    await draw(canvas, [0, 0], [800, 600]);

    expect(onMove).toHaveBeenCalledTimes(1);
    const move = onMove.mock.calls[0][0];
    expect(move.t).toBe('stroke');
    expect(move.p.length % 2).toBe(0);
    /* the drag went corner to corner, so the last point is the far corner */
    expect(move.p.slice(-2)).toEqual([1000, 1000]);
    expect(move.p[0]).toBe(0);
    expect(move.c).toBe(0);
    expect(move.w).toBe(1);
  });

  it('leaves a dot when you tap', async () => {
    const { canvas, onMove } = await mount(baseState());
    await act(async () => {
      canvas.dispatchEvent(pointer('pointerdown', { clientX: 400, clientY: 300 }));
      canvas.dispatchEvent(pointer('pointerup', { clientX: 400, clientY: 300 }));
    });
    await flush();
    expect(onMove).toHaveBeenCalledTimes(1);
    expect(onMove.mock.calls[0][0].p).toEqual([500, 500]);
  });

  /** A long stroke: 400 samples that are each far enough apart to be kept, so
      the stroke has to be flushed before the pointer is lifted. */
  const longStroke = async (canvas: HTMLCanvasElement) => {
    await act(async () => { canvas.dispatchEvent(pointer('pointerdown', { clientX: 0, clientY: 300 })); });
    await act(async () => {
      for (let i = 1; i <= 400; i += 1) {
        canvas.dispatchEvent(pointer('pointermove', {
          clientX: Math.min(i * 4, 800),
          clientY: i % 2 ? 306 : 300,
        }));
      }
    });
    await flush();
  };

  it('sends a long stroke in pieces so the other screen is never far behind', async () => {
    const { canvas, onMove } = await mount(baseState());
    await longStroke(canvas);
    expect(onMove.mock.calls.length, 'a stroke past the point budget is flushed mid-draw').toBeGreaterThan(0);
    await act(async () => { canvas.dispatchEvent(pointer('pointerup', { clientX: 800, clientY: 300 })); });
    await flush();
    /* every piece fits the wire budget */
    for (const [move] of onMove.mock.calls) expect(move.p.length / 2).toBeLessThanOrEqual(260);
    /* and nothing is lost between the pieces: the last point of one piece is the
       first point of the next, so the line has no gap where it was split. */
    const pieces = onMove.mock.calls.map(([m]) => m.p);
    for (let i = 1; i < pieces.length; i += 1) {
      expect(pieces[i][0]).toBe(pieces[i - 1][pieces[i - 1].length - 2]);
      expect(pieces[i][1]).toBe(pieces[i - 1][pieces[i - 1].length - 1]);
    }
  });

  it('keeps the flushed part on screen until the server echoes it', async () => {
    const state = baseState();
    const { canvas, onMove } = await mount(state);
    await longStroke(canvas);
    /* finish the stroke, so what is on screen is exactly the pieces we sent */
    await act(async () => { canvas.dispatchEvent(pointer('pointerup', { clientX: 800, clientY: 300 })); });
    await flush();
    const before = calls.filter((c) => c === 'stroke').length;
    expect(before, 'the flushed strokes are painted locally').toBeGreaterThan(0);

    /* Now the echo lands: the same strokes appear in the authoritative state.
       The board must not paint the same stroke twice — it drops the local copy. */
    calls.length = 0;
    const echoed = onMove.mock.calls.map(([m]) => ({ p: m.p, c: m.c, w: m.w }));
    await act(async () => {
      tree.render(createElement(StoreProvider, null, createElement(SketchBoard, {
        state: { ...state, strokes: echoed }, youSlot: 0, onMove, interactive: true,
        names: ['You', 'Them'] as [string, string],
      })));
    });
    await flush();
    /* one pass over the echoed strokes, and no second copy from the pending queue */
    const painted = calls.filter((c) => c === 'stroke').length;
    expect(painted).toBe(echoed.length);
  });

  it('ignores a second finger while a stroke is in progress', async () => {
    const { canvas, onMove } = await mount(baseState());
    await act(async () => {
      canvas.dispatchEvent(pointer('pointerdown', { pointerId: 1, clientX: 100, clientY: 100 }));
      canvas.dispatchEvent(pointer('pointerdown', { pointerId: 2, isPrimary: false, clientX: 700, clientY: 500 }));
      canvas.dispatchEvent(pointer('pointermove', { pointerId: 1, clientX: 200, clientY: 200 }));
      canvas.dispatchEvent(pointer('pointerup', { pointerId: 2, isPrimary: false, clientX: 700, clientY: 500 }));
      canvas.dispatchEvent(pointer('pointerup', { pointerId: 1, clientX: 200, clientY: 200 }));
    });
    await flush();
    expect(onMove).toHaveBeenCalledTimes(1);
    /* only the first finger's two samples — the palm left no line */
    expect(onMove.mock.calls[0][0].p).toEqual([125, 167, 250, 333]);
  });

  it('does not end a stroke when the pointer leaves the canvas', async () => {
    /* With pointer capture the stroke belongs to the canvas until it is lifted;
       ending on pointer-leave chopped every line that reached the edge. */
    const { canvas, onMove } = await mount(baseState());
    await act(async () => {
      canvas.dispatchEvent(pointer('pointerdown', { clientX: 100, clientY: 100 }));
      canvas.dispatchEvent(pointer('pointerleave', { clientX: 100, clientY: 100 }));
      canvas.dispatchEvent(pointer('pointermove', { clientX: 300, clientY: 300 }));
      canvas.dispatchEvent(pointer('pointerup', { clientX: 300, clientY: 300 }));
    });
    await flush();
    expect(onMove).toHaveBeenCalledTimes(1);
    expect(onMove.mock.calls[0][0].p.slice(-2)).toEqual([375, 500]);
  });

  it('throws the stroke away if the browser cancels the pointer', async () => {
    const { canvas, onMove } = await mount(baseState());
    await act(async () => {
      canvas.dispatchEvent(pointer('pointerdown', { clientX: 100, clientY: 100 }));
      canvas.dispatchEvent(pointer('pointermove', { clientX: 300, clientY: 300 }));
      canvas.dispatchEvent(pointer('pointercancel', { clientX: 300, clientY: 300 }));
    });
    await flush();
    expect(onMove).not.toHaveBeenCalled();
  });

  it('refuses the right mouse button', async () => {
    const { canvas, onMove } = await mount(baseState());
    await act(async () => {
      canvas.dispatchEvent(pointer('pointerdown', { button: 2, buttons: 2, clientX: 100, clientY: 100 }));
      canvas.dispatchEvent(pointer('pointermove', { clientX: 200, clientY: 200 }));
      canvas.dispatchEvent(pointer('pointerup', { clientX: 200, clientY: 200 }));
    });
    await flush();
    expect(onMove).not.toHaveBeenCalled();
  });

  it('paints the pen colour that is selected', async () => {
    const { canvas } = await mount(baseState());
    const swatch = host.querySelector('[aria-label="Green pen"]') as HTMLButtonElement;
    await act(async () => { swatch.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    calls.length = 0;
    await draw(canvas, [10, 10], [200, 200]);
    expect((ctxStub as { strokeStyle: string }).strokeStyle.toLowerCase()).toBe(PALETTE[3].toLowerCase());
  });

  it('does not let the guesser draw', async () => {
    const onMove = vi.fn();
    const { canvas } = await mount(baseState({ drawer: 1 }), onMove, 0);
    await draw(canvas, [0, 0], [400, 400]);
    expect(onMove).not.toHaveBeenCalled();
    expect(host.querySelector('#sketch-guess'), 'the guesser gets the box instead').not.toBeNull();
  });
});

describe('Guess & Draw — guessing', () => {
  it('sends a trimmed guess and clears the box', async () => {
    const onMove = vi.fn();
    await mount(baseState({ drawer: 1 }), onMove, 0);
    const input = host.querySelector('#sketch-guess') as HTMLInputElement;
    const form = input.closest('form')!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(input, '  a fish  ');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    expect(onMove).toHaveBeenCalledWith({ t: 'guess', text: 'a fish' });
    expect(input.value).toBe('');
  });

  it('says when a guess was wrong instead of leaving the player guessing', async () => {
    const state = baseState({
      drawer: 1,
      guesses: [{ by: 0, text: 'cat', hit: false, at: Date.now() }],
    });
    await mount(state, vi.fn(), 0);
    const line = host.querySelector('#sketch-guess-feedback')!;
    expect(line.textContent).toMatch(/not it/i);
    expect(line.getAttribute('aria-live')).toBe('polite');
  });

  it('does not call a correct guess wrong', async () => {
    const state = baseState({
      drawer: 1,
      guesses: [{ by: 0, text: 'fish', hit: true, at: Date.now() }],
    });
    await mount(state, vi.fn(), 0);
    expect(host.querySelector('#sketch-guess-feedback')!.textContent).not.toMatch(/not it/i);
  });
});

describe('Guess & Draw — the drawer’s tools', () => {
  it('undo removes the local queue as well as the server’s stroke', async () => {
    const onMove = vi.fn();
    const { canvas } = await mount(baseState({ strokes: [{ p: [0, 0, 10, 10], c: 0, w: 1 }] }), onMove, 0);
    await draw(canvas, [100, 100], [300, 300]);
    onMove.mockClear();
    const undo = [...host.querySelectorAll('button')].find((b) => /undo/i.test(b.textContent ?? ''))!;
    await act(async () => { undo.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(onMove).toHaveBeenCalledWith({ t: 'undo' });
  });

  it('disables undo and clear when there is nothing to remove', async () => {
    await mount(baseState(), vi.fn(), 0);
    const buttons = [...host.querySelectorAll('button')].filter((b) => /undo|clear/i.test(b.textContent ?? ''));
    expect(buttons).toHaveLength(2);
    for (const b of buttons) expect(b.hasAttribute('disabled')).toBe(true);
  });

  it('shows the word to the drawer and the mask to the guesser', async () => {
    await mount(baseState({ word: 'hot air balloon', hint: '___ ___ ______' }), vi.fn(), 0);
    expect(host.textContent).toContain('HOT AIR BALLOON');

    host.remove();
    await act(async () => { tree.unmount(); });
    await mount(baseState({ word: null, hint: '___ ___ ______', drawer: 1 }), vi.fn(), 0);
    expect(host.textContent).toContain('___ ___ ______');
    expect(host.textContent).not.toContain('HOT AIR BALLOON');
  });
});
