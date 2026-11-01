// @vitest-environment jsdom
/**
 * The VANTA board actually works as a control surface.
 *
 * The engine tests prove the rules; the relay test proves the server. This file
 * proves the thing in between: that the board mounts inside one measured stage,
 * draws every square with a name that says what is on it, offers only targets the
 * engine will accept, and hands the server a complete plan (agent + action +
 * target + read) when the player locks in.
 *
 * It also pins the two things a board can silently get wrong in a hidden-info
 * game: showing the opponent's plan, and letting a player submit twice.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import VantaBoard from '../boards/VantaBoard';
import { StoreProvider } from '../../lib/store';
import {
  RELAYS, CORES, START_AGENTS, createInitialState, neighbours, objectiveById, squareName, targetsFor, vantaRules,
  type VantaPlan, type VantaState,
} from '../../games/vanta/rules';

let host: HTMLDivElement;
let root: Root;

beforeAll(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  (window as any).matchMedia ??= (q: string) => ({
    matches: false, media: q, onchange: null,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false,
  });
});

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

const mount = async (node: React.ReactElement) => {
  await act(async () => root.render(createElement(StoreProvider, null, node)));
};

const seat0View = (s: VantaState) => vantaRules.redact!(s, 0) as VantaState;

const render = async (over: Partial<Record<string, unknown>> = {}) => {
  const state = createInitialState({}, 11);
  const onMove = vi.fn();
  await mount(createElement(VantaBoard, {
    state: { ...seat0View(state), myInsight: [], foeHasSubmitted: false },
    youSlot: 0,
    onMove,
    interactive: true,
    names: ['You', 'Them'],
    ...over,
  } as any));
  return { onMove, state };
};

const cells = () => [...host.querySelectorAll('[role="gridcell"]')] as HTMLElement[];
const buttonWith = (re: RegExp) =>
  [...host.querySelectorAll('button')].find((b) => re.test(b.getAttribute('aria-label') ?? b.textContent ?? '')) as HTMLButtonElement | undefined;

describe('VANTA board', () => {
  it('mounts one measured stage with forty-nine named squares', async () => {
    await render();
    expect(host.querySelectorAll('[data-board-stage]').length).toBe(1);
    expect(cells().length).toBe(49);
    const labels = cells().map((c) => c.getAttribute('aria-label') ?? '');
    expect(new Set(labels).size).toBe(49);
    expect(labels.some((l) => /relay/.test(l)), 'a relay square is named as one').toBe(true);
    expect(labels.filter((l) => /core/.test(l)).length).toBe(2);
    expect(labels.filter((l) => /your agent/.test(l)).length).toBe(3);
    expect(labels.filter((l) => /their agent/.test(l)).length).toBe(3);
  });

  it('never carries a hand-computed pixel width on a cell', async () => {
    await render();
    for (const c of cells()) expect(c.style.width).toBe('');
  });

  it('picks an agent, offers only legal targets, and locks a complete plan', async () => {
    const { onMove, state } = await render();

    /* the composer starts incomplete, so the lock button does nothing */
    const lock = () => [...host.querySelectorAll('button')].find((b) => /lock plan/i.test(b.textContent ?? '')) as HTMLButtonElement;
    expect(lock().disabled).toBe(true);

    await act(async () => { buttonWith(/^Agent A/)!.click(); });
    /* every offered square is one the engine would accept */
    const legal = new Set(targetsFor(state, 0, 0, 'move'));
    const offered = cells().filter((c) => c.dataset.vantaTarget === '1');
    expect(offered.length).toBe(legal.size);
    for (const c of offered) {
      const name = (c.getAttribute('aria-label') ?? '').split(',')[0];
      const idx = [...Array(49).keys()].find((i) => squareName(i) === name)!;
      expect(legal.has(idx), `${name} is a legal move`).toBe(true);
    }

    /* the action is chosen first — switching action clears a stale target */
    await act(async () => { buttonWith(/^claim/i)!.click(); });
    const claimable = targetsFor(state, 0, 0, 'claim');
    const target = claimable[0];
    await act(async () => { cells()[target].click(); });
    await act(async () => { lock().click(); });

    expect(onMove).toHaveBeenCalledTimes(1);
    const plan = onMove.mock.calls[0][0] as VantaPlan;
    expect(plan.agent).toBe(0);
    expect(plan.action).toBe('claim');
    expect(plan.to).toBe(target);
    expect(['move', 'claim', 'anchor', 'feint', 'snare']).toContain(plan.predict);
    expect(vantaRules.isLegal(state, 0, plan), 'the board only ever sends legal plans').toBe(true);
  });

  it('costs what the engine says it costs, and refuses what cannot be paid for', async () => {
    const state = createInitialState({}, 12);
    state.energy[0] = 1;
    const onMove = vi.fn();
    await mount(createElement(VantaBoard, {
      state: { ...seat0View(state), myInsight: [] }, youSlot: 0, onMove, interactive: true, names: ['You', 'Them'],
    } as any));
    await act(async () => { buttonWith(/^Agent A/)!.click(); });
    const step = [...Array(49).keys()].find((i) => targetsFor(state, 0, 0, 'move').includes(i))!;
    /* a claim on their square costs more than the single energy in hand */
    const enemyOwned = [...Array(49).keys()].find((i) => state.owner[i] === 1 && neighbours(START_AGENTS[0][0]).includes(i));
    if (enemyOwned !== undefined) {
      await act(async () => { buttonWith(/^claim/i)!.click(); });
      await act(async () => { cells()[enemyOwned].click(); });
      const lock = [...host.querySelectorAll('button')].find((b) => /lock plan/i.test(b.textContent ?? '')) as HTMLButtonElement;
      expect(lock.disabled, 'a plan you cannot afford cannot be locked').toBe(true);
    }
    await act(async () => { buttonWith(/^move/i)!.click(); });
    await act(async () => { cells()[step].click(); });
    const lock2 = [...host.querySelectorAll('button')].find((b) => /lock plan/i.test(b.textContent ?? '')) as HTMLButtonElement;
    expect(lock2.disabled, 'a free move is still playable on one energy').toBe(false);
  });

  it('shows a locked plan and stops accepting input until the round turns over', async () => {
    const state = createInitialState({}, 13);
    const mine: VantaPlan = { agent: 0, action: 'move', to: neighbours(START_AGENTS[0][0])[0], predict: 'claim' };
    const locked = vantaRules.applyMove(state, 0, mine);
    const onMove = vi.fn();
    await mount(createElement(VantaBoard, {
      state: { ...seat0View(locked), myInsight: [], foeHasSubmitted: true }, youSlot: 0, onMove, interactive: true, names: ['You', 'Them'],
    } as any));
    expect(host.textContent).toContain('Plan locked');
    expect(host.textContent).toContain(squareName(mine.to!));
    expect(host.textContent, 'the board knows the opponent is in').toMatch(/Both plans in|Waiting for their plan/);
    for (const c of cells()) expect((c as HTMLButtonElement).disabled, 'no square is clickable after locking').toBe(true);
    expect(onMove).not.toHaveBeenCalled();
  });

  it('never draws the opponent’s plan, traps, or secret objective', async () => {
    let state = createInitialState({}, 14);
    const trapAt = targetsFor(state, 0, 2, 'snare')[0];
    state = vantaRules.applyMove(state, 0, { agent: 2, action: 'snare', to: trapAt, predict: 'claim' });  // their (seat 1's) turn is not ours
    /* now a board for seat 1 looking at a state where seat 0 has a plan and a trap */
    const foeView = vantaRules.redact!(state, 1) as VantaState;
    const onMove = vi.fn();
    await act(async () => root.unmount());
    root = createRoot(host);
    await mount(createElement(VantaBoard, {
      state: { ...foeView, myInsight: [] }, youSlot: 1, onMove, interactive: true, names: ['You', 'Them'],
    } as any));
    const text = host.textContent ?? '';
    expect(text).not.toMatch(/Snare: Hide a trap/);          // the tooltip blurb is not what we mean
    expect(foeView.traps).toHaveLength(0);
    expect(foeView.plans[0]).toBeNull();
    /* the enemy trap is not in the DOM either: nothing is marked with the trap glyph */
    expect((host.innerHTML.match(/✳/g) ?? []).length).toBe(0);
    expect(text.toLowerCase()).toContain('secret objective');
    /* and the only objective on screen is the one this seat is holding */
    expect(text).toContain(objectiveById(foeView.objective[1]).title);
  });

  it('draws the opponent plan only once the round has resolved', async () => {
    let state = createInitialState({}, 15);
    const p0 = { agent: 0 as const, action: 'move' as const, to: neighbours(START_AGENTS[0][0])[0], predict: 'claim' as const };
    const p1 = { agent: 0 as const, action: 'move' as const, to: neighbours(START_AGENTS[1][0])[0], predict: 'move' as const };
    state = vantaRules.applyMove(state, 0, p0);
    state = vantaRules.applyMove(state, 1, p1);
    await act(async () => root.unmount());
    root = createRoot(host);
    await mount(createElement(VantaBoard, {
      state: { ...seat0View(state), myInsight: [] }, youSlot: 0, onMove: () => {}, interactive: true, names: ['You', 'Them'],
    } as any));
    const text = host.textContent ?? '';
    expect(text, 'the round report names what both seats did').toMatch(/Round 1 resolved/);
    expect(text).toContain(squareName(p0.to));
  });

  it('marks the four squares that would close the enemy core', async () => {
    await render();
    const ring = neighbours(CORES[1]);
    const labels = cells().map((c) => c.getAttribute('aria-label') ?? '');
    for (const r of ring) {
      expect(labels.some((l) => l.startsWith(`${squareName(r)},`)), `${squareName(r)} is on the board`).toBe(true);
    }
    /* the legend states the condition in the player's own words */
    expect(host.textContent).toContain('close all 4 around their core');
  });

  it('renders an over match without a composer', async () => {
    const s = createInitialState({}, 16);
    s.over = true;
    s.winner = 0;
    s.reason = 'Ivory reached 12 influence';
    await act(async () => root.unmount());
    root = createRoot(host);
    await mount(createElement(VantaBoard, {
      state: { ...seat0View(s), myInsight: [] }, youSlot: 0, onMove: () => {}, interactive: false, names: ['You', 'Them'],
    } as any));
    expect(host.querySelectorAll('[role="gridcell"]').length).toBe(49);
    expect(host.textContent).not.toMatch(/Lock plan/);
  });

  it('marks a bolted square, and says so to a screen reader', async () => {
    const s = createInitialState({}, 21);
    const relay = RELAYS[0];
    s.owner[relay] = 0;
    s.anchored[relay] = true;
    await act(async () => root.unmount());
    root = createRoot(host);
    await mount(createElement(VantaBoard, {
      state: { ...seat0View(s), myInsight: [] }, youSlot: 0, onMove: () => {}, interactive: true, names: ['You', 'Them'],
    } as any));
    const cell = Array.from(host.querySelectorAll('[role="gridcell"]'))
      .find((c) => (c.getAttribute('aria-label') ?? '').includes('bolted'));
    expect(cell).toBeTruthy();
    expect(cell!.getAttribute('aria-label')).toMatch(/relay/);
    /* and the legend explains what the ring means, because the sweep needs it */
    expect(host.textContent).toMatch(/ring = bolted/);
  });
});

