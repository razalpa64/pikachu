// @vitest-environment jsdom
/**
 * Spyfall, passed around a phone.
 *
 * The engine suite proves the deal and the ballot. These tests drive the actual
 * screen, because a hidden-role game has a failure mode no pure function can
 * catch: the previous player's card still sitting on the screen when the next
 * person picks the phone up.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { StoreProvider } from '../../lib/store';
import { gameById } from '../registry';
import SpyfallSolo from '../spyfall/SoloView';
import { LOCATIONS } from '../spyfall/deck';

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

async function mount() {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root.render(
      createElement(MemoryRouter, null,
        createElement(StoreProvider, null, createElement(SpyfallSolo, { game: gameById('spyfall')! }))),
    );
  });
}

const click = async (el: HTMLElement) => { await act(async () => { el.click(); }); };
const button = (text: RegExp | string) =>
  Array.from(host.querySelectorAll<HTMLButtonElement>('button'))
    .find((b) => (typeof text === 'string' ? (b.textContent ?? '').trim() === text : text.test(b.textContent ?? '')));
/** Buttons belonging to the game surface, not the shell around it (Restart, How to play). */
const panelButton = (text: RegExp | string) =>
  Array.from(host.querySelectorAll<HTMLButtonElement>('.panel button'))
    .find((b) => (typeof text === 'string' ? (b.textContent ?? '').trim() === text : text.test(b.textContent ?? '')));
/**
 * The card's title, read from the game surface only.
 *
 * This used to search every `<p>` in the document. The rulebook is a `<details>`
 * whose body sits in the DOM even while closed, so on some shuffles the query
 * matched a line of rules text and returned the *next* element's text instead of
 * the card — producing a "the curtain leaks the card" failure that had nothing
 * to do with the curtain. `.panel` is where the dealt card lives.
 */
const cardTitle = () =>
  Array.from(host.querySelectorAll('.panel p'))
    .find((p) => /Private card/.test(p.textContent ?? ''))
    ?.nextElementSibling?.textContent?.trim() ?? '';

/**
 * The scene with the default seat labels taken out.
 *
 * One of the stadium's roles is literally "Player", and the curtain labels the
 * next person "Player 3". Asserting that the closed curtain does not contain the
 * card just read therefore failed once every few dozen deals — on a real card,
 * correctly hidden, because the card's *title* was a substring of a seat label.
 * Stripping the labels keeps the guard exact instead of loosening it.
 */
const withoutSeatLabels = () => (host.textContent ?? '').replace(/Player \d+/g, '');

/** Deal one card and return its title, hiding it again before the next hand. */
async function passCard(): Promise<string> {
  const show = panelButton(/Show my card/);
  expect(show, 'the phone is covered before a card is shown').toBeTruthy();
  await click(show!);

  const title = cardTitle();
  expect(panelButton(/Show my card/), 'the curtain is gone while the card is open').toBeFalsy();

  const hide = panelButton(/Hide and pass/);
  expect(hide, 'a card can always be closed again').toBeTruthy();
  await click(hide!);
  return title;
}

const dealHand = async (seats: number) => {
  const cards: string[] = [];
  for (let i = 0; i < seats; i++) cards.push(await passCard());
  return cards;
};

/** Vote, one seat at a time. `pick` returns a player label to vote for, or null to abstain. */
async function voteAll(count: number, pick: (seat: number) => string | null) {
  for (let seat = 0; seat < count; seat++) {
    expect(host.textContent, `seat ${seat + 1} is voting privately`).toMatch(/Secret vote/);
    const names = Array.from(host.querySelectorAll<HTMLButtonElement>('.panel button'))
      .map((b) => (b.textContent ?? '').trim())
      .filter((t) => t && !/Lock in vote|No idea/.test(t));
    expect(names, 'you cannot vote for yourself').not.toContain(`Player ${seat + 1}`);
    const choice = pick(seat);
    if (choice === null) await click(panelButton(/No idea/)!);
    else await click(panelButton(choice)!);
    await click(panelButton(/Lock in vote/)!);
  }
};

describe('spyfall — passing the phone', () => {
  it('deals one private card per player and never shows two at once', async () => {
    await mount();
    await click(button(/Deal the cards/)!);

    const seen: string[] = [];
    for (let i = 0; i < 5; i++) {
      expect(host.textContent).toMatch(new RegExp(`Player ${i + 1}`));
      const title = await passCard();
      expect(title.length, 'the card has a title').toBeGreaterThan(2);
      // The closed curtain must not carry the card that was just read.
      for (const earlier of seen) expect(withoutSeatLabels()).not.toContain(earlier);
      seen.push(title);
    }

    expect(seen.length).toBe(5);
    expect(seen.filter((t) => /You are the spy/i.test(t)), 'exactly one spy at the table').toHaveLength(1);
    expect(host.textContent).toMatch(/Interrogation/);
  });

  it('shows the spy a bluffing card, not a role or a location', async () => {
    await mount();
    await click(button(/Deal the cards/)!);

    const cards: { title: string; body: string }[] = [];
    for (let i = 0; i < 5; i++) {
      await click(panelButton(/Show my card/)!);
      const title = cardTitle();
      const body = host.textContent ?? '';
      cards.push({ title, body });
      await click(panelButton(/Hide and pass/)!);
    }

    const spy = cards.find((c) => /You are the spy/i.test(c.title))!;
    expect(spy, 'somebody is the spy').toBeTruthy();
    expect(spy.body).toMatch(/were not given a role card/i);
    expect(spy.body, 'the spy is not told where they are').not.toMatch(/You are at the/);

    const agents = cards.filter((c) => c !== spy);
    expect(agents.length).toBe(4);
    for (const agent of agents) expect(agent.body).toMatch(/You are at the /);
  });

  it('runs the interrogation clock only while the table is talking', async () => {
    await mount();
    await click(button(/Deal the cards/)!);
    await dealHand(5);

    expect(host.textContent).toMatch(/5:00 left/);
    const another = button(/Another question/);
    expect(another, 'the table can keep asking').toBeTruthy();
    const before = host.textContent;
    await click(another!);
    expect(host.textContent, 'a new question replaces the old one').not.toBe(before);
  });
});

describe('spyfall — the vote', () => {
  it('counts a secret ballot and reveals the location', async () => {
    await mount();
    await click(button(/Deal the cards/)!);
    const cards = await dealHand(5);

    await click(button(/Call the vote/)!);
    await voteAll(5, (seat) => (seat === 0 ? 'Player 2' : 'Player 1'));

    expect(host.textContent).toMatch(/was the spy/);
    expect(host.textContent).toMatch(/The location/);
    const named = LOCATIONS.filter((l) => host.textContent!.includes(l.name));
    expect(named.length, 'the table learns where it was').toBe(1);
    expect(cards.length).toBe(5);
  });

  it('accuses nobody when the vote ties, and then lets the spy guess', async () => {
    await mount();
    await click(button(/Deal the cards/)!);
    await dealHand(5);

    await click(button(/Call the vote/)!);
    // Four players take one vote each and the fifth abstains: nobody leads.
    const spread = ['Player 2', 'Player 1', 'Player 4', 'Player 3', null];
    await voteAll(5, (seat) => spread[seat]);

    expect(host.textContent).toMatch(/tied/i);
    const guess = panelButton(/The spy guesses/);
    expect(guess, 'an escaped spy gets one guess').toBeTruthy();
    await click(guess!);

    expect(host.textContent).toMatch(/last guess/i);
    const place = panelButton(new RegExp(`^${LOCATIONS[0].name}$`));
    expect(place, 'every location is on the guess list').toBeTruthy();
    await click(place!);
    expect(place!.getAttribute('aria-pressed')).toBe('true');
  });

  it('banks a round once and moves to the next deal', async () => {
    await mount();
    await click(button(/Deal the cards/)!);
    await dealHand(5);

    await click(button(/Call the vote/)!);
    await voteAll(5, (seat) => (seat === 0 ? 'Player 2' : 'Player 1'));

    expect(button(/Next round/), 'there is a next round of a three-round match').toBeTruthy();
    await click(button(/Next round/)!);
    expect(host.textContent, 'the next round starts with a curtain, not a score').toMatch(/Pass the phone/);
  });

  it('finishes a one-round match with a scorecard for every seat', async () => {
    await mount();

    const rounds = document.querySelector('[role="radiogroup"][aria-label="Rounds"]')!;
    const one = Array.from(rounds.querySelectorAll<HTMLButtonElement>('button'))
      .find((b) => (b.textContent ?? '').trim() === '1')!;
    await click(one);

    await click(button(/Deal the cards/)!);
    await dealHand(5);
    await click(button(/Call the vote/)!);
    await voteAll(5, (seat) => (seat === 0 ? 'Player 2' : 'Player 1'));

    const finish = panelButton(/Finish the match/);
    expect(finish, 'the last round ends the match').toBeTruthy();
    await click(finish!);

    expect(host.textContent).toMatch(/Match over/);
    for (let i = 1; i <= 3; i++) expect(host.textContent).toContain(`Player ${i}`);
    expect(button(/Play again/)).toBeTruthy();
  });
});
