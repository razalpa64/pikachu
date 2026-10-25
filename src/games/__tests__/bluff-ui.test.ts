// @vitest-environment jsdom
/**
 * Bluff Trivia, typed into — solo and online.
 *
 * The engine suite proves the scoring and the redaction. These tests prove the
 * *screens* honour them: a lie can actually be submitted, the ballot can be voted
 * on, and the online board never renders the word that would give the answer away
 * while the vote is open.
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { StoreProvider } from '../../lib/store';
import { gameById } from '../registry';
import BluffSolo from '../bluff/SoloView';
import BluffTriviaBoard from '../../components/boards/BluffTriviaBoard';
import { DEFAULT_BLUFF, type BluffState } from '../bluff/rules';

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

const click = async (el: HTMLElement) => { await act(async () => { el.click(); }); };

describe('bluff trivia — solo', () => {
  it('takes a lie, moves to the ballot, and scores the round', async () => {
    await mount(createElement(BluffSolo, { game: gameById('bluff')! }));

    const input = host.querySelector<HTMLInputElement>('#bluff-solo-lie')!;
    expect(input, 'there is somewhere to write the lie').toBeTruthy();
    await act(async () => { type(input, 'A very convincing wrong answer'); });
    await click(Array.from(host.querySelectorAll('button')).find((b) => /Write it/.test(b.textContent ?? ''))!);

    expect(host.textContent).toMatch(/find the truth/i);
    const options = Array.from(host.querySelectorAll<HTMLButtonElement>('button[data-option]'));
    expect(options.length, 'the ballot has the truth and both lies').toBe(3);

    const mine = options.find((b) => /your lie/.test(b.textContent ?? ''))!;
    expect(mine, 'your own lie is on the ballot, marked').toBeTruthy();
    expect(mine.disabled, 'and cannot be voted for').toBe(true);

    const votable = options.filter((b) => !b.disabled);
    expect(votable.length, 'there is something to vote for').toBe(2);

    await click(votable[0]);
    expect(host.textContent).toMatch(/The truth/);
    expect(host.textContent).toMatch(/\+2 for the truth/);
  });

  it('will not let an empty lie be submitted', async () => {
    await mount(createElement(BluffSolo, { game: gameById('bluff')! }));
    const input = host.querySelector<HTMLInputElement>('#bluff-solo-lie')!;
    await act(async () => { type(input, '   '); });
    const write = Array.from(host.querySelectorAll('button')).find((b) => /Write it/.test(b.textContent ?? ''))!;
    expect((write as HTMLButtonElement).disabled).toBe(true);
  });
});

/** Build a redacted ballot the way the relay would send it. */
function boardState(): BluffState & { submitted: [boolean, boolean]; inVote: [boolean, boolean] } {
  return {
    config: { ...DEFAULT_BLUFF, rounds: 5 },
    seed: 3,
    queue: [{ q: 'What is the capital of Australia?', a: ['', '', '', ''], cat: 'geography', tier: 2 }],
    index: 0,
    phase: 'vote',
    phaseEndsAt: Date.now() + 30_000,
    lies: ['Sydney', 'Perth'],
    options: ['Sydney', 'Canberra', 'Perth'],
    owner: [],
    votes: [null, null],
    history: [],
    score: [0, 0],
    over: false, winner: null, reason: '',
    submitted: [true, true],
    inVote: [false, false],
  } as BluffState & { submitted: [boolean, boolean]; inVote: [boolean, boolean] };
}

describe('bluff trivia — online board', () => {
  it('sends a vote for an option that is not your own lie', async () => {
    const moves: unknown[] = [];
    await mount(createElement(BluffTriviaBoard, {
      state: boardState(), youSlot: 0, onMove: (m: unknown) => moves.push(m), interactive: true,
      names: ['Ash', 'Misty'] as [string, string],
    }));

    const canberra = Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find((b) => /Canberra/.test(b.textContent ?? ''))!;
    expect(canberra.disabled, 'the truth is votable').toBe(false);
    await click(canberra);
    expect(moves).toEqual([{ type: 'vote', option: 1 }]);
  });

  it('marks your own lie and will not let you vote for it', async () => {
    await mount(createElement(BluffTriviaBoard, {
      state: boardState(), youSlot: 0, onMove: () => {}, interactive: true,
      names: ['Ash', 'Misty'] as [string, string],
    }));
    const sydney = Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find((b) => /Sydney/.test(b.textContent ?? ''))!;
    expect(sydney.disabled).toBe(true);
    expect(sydney.textContent).toMatch(/your lie/);
  });

  it('never names the truth while the vote is open', async () => {
    await mount(createElement(BluffTriviaBoard, {
      state: boardState(), youSlot: 0, onMove: () => {}, interactive: true,
      names: ['Ash', 'Misty'] as [string, string],
    }));
    const text = host.textContent ?? '';
    expect(text).toMatch(/Which one is true\?/);
    expect(text).not.toMatch(/The truth/);
    expect(text).not.toMatch(/'s lie|’s lie/);
  });

  it('shows the truth and both lies once the server releases the reveal', async () => {
    const revealed = {
      ...boardState(),
      phase: 'reveal' as const,
      owner: [0, 'truth', 1] as (0 | 1 | 'truth')[],
      votes: [1, 1] as [number, number],
      history: [{
        question: { q: 'What is the capital of Australia?', a: ['Canberra', 'Sydney', 'Perth', ''] as [string, string, string, string], cat: 'geography' as const, tier: 2 as const },
        truth: 'Canberra',
        lies: ['Sydney', 'Perth'] as [string, string],
        options: ['Sydney', 'Canberra', 'Perth'],
        owner: [0, 'truth', 1] as (0 | 1 | 'truth')[],
        votes: [1, 1] as [number, number],
        points: [2, 2] as [number, number],
        empty: false,
      }],
    };
    await mount(createElement(BluffTriviaBoard, {
      state: revealed as BluffState, youSlot: 0, onMove: () => {}, interactive: true,
      names: ['Ash', 'Misty'] as [string, string],
    }));
    const text = host.textContent ?? '';
    expect(text).toMatch(/The truth/);
    expect(text).toMatch(/Canberra/);
    expect(text).toMatch(/Ash’s lie/);
    expect(text).toMatch(/Misty’s lie/);
  });
});
