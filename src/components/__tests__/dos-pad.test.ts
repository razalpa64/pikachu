// @vitest-environment jsdom
/**
 * The DOS on-screen pad.
 *
 * A pad that renders but posts nothing is the failure this file exists to catch:
 * every button has to produce a `down`, the release has to produce an `up`, and
 * holding an arrow has to repeat — otherwise a phone player cannot walk, only
 * twitch. The end-to-end proof that these events reach DOSBox lives in
 * `scripts/e2e/retro-dos.mjs`, which presses only this pad and checks that the
 * calibration cartridge reacts.
 */
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import DosPad, { DOS_ACTIONS, DOS_DPAD, DOS_PAD_KEYS, DOS_REPEAT_MS } from '../DosPad';

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  (HTMLButtonElement.prototype as any).setPointerCapture = () => {};
  (HTMLButtonElement.prototype as any).releasePointerCapture = () => {};
});

afterEach(async () => {
  await act(async () => { root?.unmount(); });
  host?.remove();
  vi.useRealTimers();
});

async function mount(onKey = vi.fn(), disabled = false) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root.render(createElement(DosPad, { onKey, disabled }));
  });
  const button = (key: string) => host.querySelector<HTMLButtonElement>(`[data-key="${key}"]`)!;
  return { onKey, button };
}

function pointer(type: string, init: Record<string, unknown> = {}) {
  const e = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(e, { pointerId: 1, pointerType: 'touch', isPrimary: true, button: 0, buttons: 1, ...init });
  return e;
}

describe('the DOS pad', () => {
  it('offers a D-pad and the action keys the games wait for', async () => {
    await mount();
    expect(host.querySelectorAll('.dos-pad-key')).toHaveLength(DOS_PAD_KEYS.length);
    for (const spec of DOS_PAD_KEYS) {
      const b = host.querySelector(`[data-key="${CSS.escape(spec.key)}"]`);
      expect(b, `${spec.label} is on the pad`).not.toBeNull();
      expect(b!.getAttribute('aria-label')).toBe(spec.aria);
    }
  });

  it('labels every key for a screen reader instead of just naming it', () => {
    for (const spec of DOS_PAD_KEYS) {
      expect(spec.aria.length).toBeGreaterThan(spec.label.length);
      expect(spec.key.length).toBeGreaterThan(0);
      expect(spec.keyCode).toBeGreaterThan(0);
    }
    /* no two keys share a code: the emulator would see the wrong one */
    const codes = DOS_PAD_KEYS.map((k) => k.keyCode);
    expect(new Set(codes).size).toBe(codes.length);
    /* only movement repeats — repeating Enter would open and close a menu */
    expect(DOS_DPAD.every((k) => k.repeat)).toBe(true);
    expect(DOS_ACTIONS.every((k) => !k.repeat)).toBe(true);
  });

  it('sends a press and a release for a tap', async () => {
    const { onKey, button } = await mount();
    const space = DOS_ACTIONS[0];
    await act(async () => {
      button(space.key).dispatchEvent(pointer('pointerdown'));
      button(space.key).dispatchEvent(pointer('pointerup'));
    });
    expect(onKey.mock.calls.map(([spec, action]) => [spec.key, action])).toEqual([
      [space.key, 'down'],
      [space.key, 'up'],
    ]);
  });

  it('sends the key codes DOSBox matches on', async () => {
    const { onKey, button } = await mount();
    await act(async () => {
      button(' ').dispatchEvent(pointer('pointerdown'));
      button(' ').dispatchEvent(pointer('pointerup'));
    });
    const [spec] = onKey.mock.calls[0];
    expect(spec).toMatchObject({ key: ' ', code: 'Space', keyCode: 32 });
    const esc = DOS_ACTIONS.find((k) => k.key === 'Escape')!;
    expect(esc).toMatchObject({ keyCode: 27 });
    const enter = DOS_ACTIONS.find((k) => k.key === 'Enter')!;
    expect(enter.keyCode).toBe(13);
  });

  it('repeats while an arrow is held, and stops on release', async () => {
    vi.useFakeTimers();
    const { onKey, button } = await mount();
    const up = DOS_DPAD[0];
    await act(async () => {
      button(up.key).dispatchEvent(pointer('pointerdown'));
    });
    await act(async () => { vi.advanceTimersByTime(DOS_REPEAT_MS * 3 + 5); });
    const downs = onKey.mock.calls.filter(([, a]) => a === 'down').length;
    /* one on press, then one per repeat tick — a held arrow has to keep walking */
    expect(downs).toBeGreaterThanOrEqual(3);
    await act(async () => { button(up.key).dispatchEvent(pointer('pointerup')); });
    const afterRelease = onKey.mock.calls.length;
    await act(async () => { vi.advanceTimersByTime(DOS_REPEAT_MS * 4); });
    expect(onKey.mock.calls.length, 'nothing is sent after the finger lifts').toBe(afterRelease);
    expect(onKey.mock.calls[onKey.mock.calls.length - 1][1]).toBe('up');
  });

  it('does not repeat the action keys', async () => {
    vi.useFakeTimers();
    const { onKey, button } = await mount();
    await act(async () => { button('Enter').dispatchEvent(pointer('pointerdown')); });
    await act(async () => { vi.advanceTimersByTime(DOS_REPEAT_MS * 4); });
    expect(onKey.mock.calls).toHaveLength(1);
  });

  it('releases the key if the press is cancelled by the system', async () => {
    const { onKey, button } = await mount();
    await act(async () => {
      button('ArrowLeft').dispatchEvent(pointer('pointerdown'));
      button('ArrowLeft').dispatchEvent(pointer('pointercancel'));
    });
    expect(onKey.mock.calls.map(([, a]) => a)).toEqual(['down', 'up']);
  });

  it('releases the key if the pad disappears mid-press', async () => {
    /* Unmounting while a finger is down must not leave the character running —
       the emulator has no idea the button is gone. */
    const { onKey, button } = await mount();
    await act(async () => { button('ArrowRight').dispatchEvent(pointer('pointerdown')); });
    await act(async () => { root.unmount(); });
    expect(onKey.mock.calls.map(([, a]) => a)).toEqual(['down', 'up']);
  });

  it('sends nothing before the machine is running', async () => {
    const { onKey, button } = await mount(vi.fn(), true);
    await act(async () => {
      button('ArrowDown').dispatchEvent(pointer('pointerdown'));
      button('ArrowDown').dispatchEvent(pointer('pointerup'));
    });
    expect(onKey).not.toHaveBeenCalled();
  });
});
