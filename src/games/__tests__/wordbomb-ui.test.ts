// @vitest-environment jsdom
/**
 * Word Bomb, typed into for real.
 *
 * A word game fails in exactly one boring way: the input looks alive, you type a
 * perfectly good word, and nothing happens. These tests take the real screen,
 * work out the lit letter from the page, type a word from the real list, submit,
 * and check the chain and the score moved.
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { StoreProvider } from '../../lib/store';
import { gameById } from '../registry';
import WordBombSolo from '../wordbomb/SoloView';
import WordBombBoard from '../../components/boards/WordBombBoard';
import { DEFAULT_WB, type WbState } from '../wordbomb/rules';
import { wordsStartingWith } from '../wordbomb/words';

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
});

afterEach(async () => {
  await act(async () => { root?.unmount(); });
  host?.remove();
});

async function mount(el: React.ReactElement) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root.render(createElement(MemoryRouter, null, createElement(StoreProvider, null, el)));
  });
}

function type(el: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

/** the lit letter, read from the input's placeholder ("A word starting with T…") */
function litLetter(): string {
  const input = host.querySelector<HTMLInputElement>('input[id^="wb-"]');
  const text = `${input?.placeholder ?? ''} ${host.textContent ?? ''}`;
  const m = /starting with ([A-Z])/i.exec(text) ?? /Your turn\. A word starting with ([A-Z])/i.exec(text);
  expect(m, 'the page tells you which letter is lit').toBeTruthy();
  return m![1].toLowerCase();
}

describe('word bomb — solo', () => {
  it('accepts a real word, scores it and moves the chain on', async () => {
    await mount(createElement(WordBombSolo, { game: gameById('wordbomb')! }));

    const letter = litLetter();
    const word = wordsStartingWith(letter)[0];
    const input = host.querySelector<HTMLInputElement>('input[id^="wb-"]')!;

    await act(async () => { type(input, word); });
    await act(async () => { input.form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });

    expect(host.textContent, 'the word joins the chain').toContain(word);
    expect(host.textContent).toContain('1 played');
    expect(host.textContent, 'the score moved').toMatch(/You\s*1/);
  });

  it('says why a word it cannot take is refused, without losing the turn', async () => {
    await mount(createElement(WordBombSolo, { game: gameById('wordbomb')! }));
    const input = host.querySelector<HTMLInputElement>('input[id^="wb-"]')!;

    await act(async () => { type(input, 'qzz'); });   // no legal word starts with q z z
    await act(async () => { input.form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    expect(host.textContent).toMatch(/start with/i);
    expect(host.textContent).toMatch(/0 played/);
  });
});

/** A server-shaped state so the board can be driven without a socket. */
function boardState(over: Partial<WbState> = {}): WbState {
  return {
    config: { ...DEFAULT_WB, turnMs: 20_000, strikes: 2, rounds: 12 },
    seed: 5,
    letter: 's',
    turn: 0,
    used: [],
    score: [0, 0],
    strikes: [0, 0],
    phase: 'play',
    turnEndsAt: Date.now() + 20_000,
    history: [],
    over: false,
    winner: null,
    reason: '',
    ...over,
  };
}

describe('word bomb — online board', () => {
  it('sends the word you type when it is your turn', async () => {
    const moves: unknown[] = [];
    await mount(createElement(WordBombBoard, {
      state: boardState(), youSlot: 0, onMove: (m: unknown) => moves.push(m), interactive: true,
      names: ['Ash', 'Misty'] as [string, string],
    }));

    const input = host.querySelector<HTMLInputElement>('#wb-online-word')!;
    expect(input.disabled).toBe(false);
    await act(async () => { type(input, 'sunset'); });
    await act(async () => { input.form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    expect(moves).toEqual([{ type: 'word', word: 'sunset' }]);
  });

  it('cannot be typed into when the other seat is on turn', async () => {
    const moves: unknown[] = [];
    await mount(createElement(WordBombBoard, {
      state: boardState({ turn: 1 }), youSlot: 0, onMove: (m: unknown) => moves.push(m), interactive: true,
      names: ['Ash', 'Misty'] as [string, string],
    }));
    const input = host.querySelector<HTMLInputElement>('#wb-online-word')!;
    expect(input.disabled).toBe(true);
    expect(host.textContent).toMatch(/Misty’s turn|Misty's turn/);
    await act(async () => { input.form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    expect(moves).toHaveLength(0);
  });
});
