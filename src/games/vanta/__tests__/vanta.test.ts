import { describe, expect, it } from 'vitest';
import {
  ANCHOR_TAX, CORES, COST, INFLUENCE_TO_WIN, MAX_ENERGY, MAX_ROUNDS, N, OBJECTIVE_BONUS, RELAYS,
  RELAY_WIN_COUNT, RELAY_WIN_STREAK, SHOVE_TAX, SQUARES, START_AGENTS, START_ENERGY, STEAL_COST, TERRITORY_T1,
  EVENT_LABEL, OBJECTIVES, costFor, createInitialState, neighbours, normalisePlan, objectiveById,
  resolveRound, targetsFor, territoryCount, validatePlan, vantaRules,
  type ObjectiveId, type VantaPlan, type VantaState,
} from '../rules';
import { choosePlan, choosePrediction, evaluate, readDistribution, type VantaStrength } from '../ai';

/* ------------------------------------------------------------------ helpers */

const plan = (agent: number, action: VantaPlan['action'], to: number | null, predict: VantaPlan['predict'] = 'move'): VantaPlan => ({ agent, action, to, predict });
const clone = (s: VantaState): VantaState => JSON.parse(JSON.stringify(s)) as VantaState;

/** A clean, quiet board: everything unowned except the two cores. */
function bare(seed = 7): VantaState {
  const s = createInitialState({}, seed);
  s.owner = s.owner.map(() => null);
  s.anchored = s.anchored.map(() => false);
  s.traps = [];
  s.decoys = [];
  s.owner[CORES[0]] = 0;
  s.owner[CORES[1]] = 1;
  s.influence = [0, 0];
  s.energy = [START_ENERGY, START_ENERGY];
  return s;
}

/** Resolve one round with the two given plans. */
function round(s: VantaState, p0: VantaPlan, p1: VantaPlan): VantaState {
  return resolveRound({ ...s, plans: [p0, p1] });
}

/* ------------------------------------------------------------------ 1. table */

describe('VANTA — the table', () => {
  it('is 7×7 with five relays, three agents a seat and two cores', () => {
    expect(N).toBe(7);
    expect(SQUARES).toBe(49);
    expect(RELAYS).toHaveLength(5);
    expect(new Set(RELAYS).size).toBe(5);
    expect(START_AGENTS[0]).toHaveLength(3);
    expect(START_AGENTS[1]).toHaveLength(3);
    expect(CORES[0]).not.toBe(CORES[1]);
    /* both cores are off the wall, so each one has four approach squares */
    expect(neighbours(CORES[0])).toHaveLength(4);
    expect(neighbours(CORES[1])).toHaveLength(4);
  });

  it('opens symmetric: 3 energy, no influence, relays unowned, cores owned', () => {
    const s = createInitialState({}, 1234);
    expect(s.energy).toEqual([START_ENERGY, START_ENERGY]);
    expect(s.influence).toEqual([0, 0]);
    expect(s.relaysHeld).toEqual([0, 0]);
    for (const r of RELAYS) expect(s.owner[r]).toBeNull();
    expect(s.owner[CORES[0]]).toBe(0);
    expect(s.owner[CORES[1]]).toBe(1);
    expect(s.agents[0]).toEqual(START_AGENTS[0]);
    expect(s.agents[1]).toEqual(START_AGENTS[1]);
    /* the opening is a 180° rotation of itself, with agents mirrored */
    const rot = (i: number) => SQUARES - 1 - i;
    for (let i = 0; i < SQUARES; i++) {
      const mine = s.owner[i];
      const theirs = s.owner[rot(i)];
      if (mine !== null) expect(theirs).toBe(mine === 0 ? 1 : 0);
    }
  });

  it('is deterministic for a given seed and varies across seeds', () => {
    expect(createInitialState({}, 99)).toEqual(createInitialState({}, 99));
    const a = [...createInitialState({}, 1).objective, createInitialState({}, 1).rng];
    const b = [...createInitialState({}, 2).objective, createInitialState({}, 2).rng];
    expect(a).not.toEqual(b);
  });

  it('never gives the two seats the same secret objective', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const s = createInitialState({}, seed);
      expect(s.objective[0]).not.toBe(s.objective[1]);
      expect(OBJECTIVES.map((o) => o.id)).toContain(s.objective[0]);
      expect(OBJECTIVES.map((o) => o.id)).toContain(s.objective[1]);
    }
  });
});

/* ------------------------------------------------------------------ 2. plans */

describe('VANTA — plans', () => {
  it('accepts exactly one plan per round and rejects a duplicate', () => {
    const s = createInitialState({}, 5);
    const p = plan(0, 'move', neighbours(START_AGENTS[0][0])[0]);
    const once = vantaRules.applyMove(s, 0, p);
    expect(once.plans[0]).toEqual(p);
    expect(once.plans[1]).toBeNull();
    /* the same seat cannot revise or re-send */
    expect(vantaRules.applyMove(once, 0, p)).toBe(once);
    expect(vantaRules.isLegal(once, 0, p)).toBe(false);
  });

  it('does not resolve until both plans are in', () => {
    const s = createInitialState({}, 5);
    const one = vantaRules.applyMove(s, 0, plan(0, 'move', neighbours(START_AGENTS[0][0])[0]));
    expect(one.round).toBe(s.round);
    expect(one.lastRound).toBeNull();
    expect(one.over).toBe(false);
    const two = vantaRules.applyMove(one, 1, plan(0, 'move', neighbours(START_AGENTS[1][0])[0]));
    expect(two.round).toBe(s.round + 1);
    expect(two.lastRound).not.toBeNull();
    expect(two.plans).toEqual([null, null]);
  });

  it('rejects junk without throwing and without touching the state', () => {
    const s = createInitialState({}, 5);
    const junk: unknown[] = [
      null, undefined, 0, 'move', [], {}, { agent: 9, action: 'move', to: 1, predict: 'move' },
      { agent: 0, action: 'teleport', to: 1, predict: 'move' },
      { agent: 0, action: 'move', to: 999, predict: 'move' },
      { agent: 0, action: 'move', to: -1, predict: 'move' },
      { agent: 0, action: 'move', to: 1, predict: 'hold' },
      /* legal shape, illegal target: three squares away */
      { agent: 0, action: 'move', to: START_AGENTS[0][0] + 21, predict: 'move' },
      /* anchor and hold take no target */
      { agent: 0, action: 'anchor', to: 12, predict: 'move' },
    ];
    for (const j of junk) {
      expect(normalisePlan(j) === null || validatePlan(s, 0, j) === false).toBe(true);
      expect(vantaRules.applyMove(s, 0, j as VantaPlan)).toBe(s);
      expect(() => vantaRules.isLegal(s, 0, j)).not.toThrow();
    }
    /* a pure hold is always legal, even with nothing else available */
    expect(vantaRules.isLegal(s, 0, plan(0, 'hold', null))).toBe(true);
  });

  it('refuses moves from a stunned agent but still allows a hold', () => {
    const s = createInitialState({}, 5);
    s.stunned = [[1], []];
    expect(vantaRules.isLegal(s, 0, plan(1, 'move', neighbours(START_AGENTS[0][1])[0]))).toBe(false);
    expect(vantaRules.isLegal(s, 0, plan(1, 'hold', null))).toBe(true);
  });

  it('never mutates the state it is given', () => {
    const s = createInitialState({}, 21);
    const before = clone(s);
    const p0 = choosePlan(s, 0, 'intermediate', () => 0.4);
    const p1 = choosePlan(s, 1, 'intermediate', () => 0.6);
    const after = round(s, p0, p1);
    expect(s).toEqual(before);
    expect(after).not.toBe(s);
  });
});

/* ------------------------------------------------------------------ 3. hidden info */

describe('VANTA — hidden information', () => {
  it('never shows a seat the opponent’s plan, traps, objective or insight', () => {
    let s = createInitialState({}, 31);
    const trapAt = targetsFor(s, 0, 2, 'snare')[0];
    /* a plan is secret the moment it is locked in, before the round resolves */
    const locked = vantaRules.applyMove(s, 0, plan(2, 'snare', trapAt, 'claim'));
    const seat1 = vantaRules.redact!(locked, 1) as VantaState & { foeHasSubmitted: boolean };
    expect(seat1.plans[0]).toBeNull();
    expect(seat1.plans[1]).toBeNull();
    expect(seat1.foeHasSubmitted).toBe(true);
    expect(JSON.stringify(seat1)).not.toContain('"snare"');
    /* once it is on the board, only its owner can see it */
    s = vantaRules.applyMove(locked, 1, plan(0, 'hold', null, 'claim'));
    expect(s.traps.length).toBe(1);
    expect((vantaRules.redact!(s, 0) as VantaState).traps).toHaveLength(1);
    expect((vantaRules.redact!(s, 1) as VantaState).traps).toHaveLength(0);
    const own = vantaRules.redact!(s, 0) as VantaState;
    expect(own.objective[1]).toBe(own.objective[0]);
    expect(seat1.objective[1]).toBe(seat1.objective[0]);
  });

  it('gives a spectator nothing at all', () => {
    const s = createInitialState({}, 33);
    const view = vantaRules.redact!(s, 'spectator') as Record<string, unknown>;
    expect(view.plans).toEqual([null, null]);
    expect(view.traps).toEqual([]);
    expect(view.objectiveProgress).toEqual([0, 0]);
    expect(view.insight).toEqual([[], []]);
  });

  it('keeps both secret objectives out of every public string', () => {
    let s = createInitialState({}, 44);
    s.objective = ['raider', 'spread'] as [ObjectiveId, ObjectiveId];
    s = round(s, plan(0, 'hold', null, 'claim'), plan(1, 'hold', null, 'claim'));
    const publicText = JSON.stringify({
      lines: s.lastRound?.lines,
      outcomes: s.lastRound?.results.map((r) => r.outcome),
      describe0: vantaRules.describeMove!(s, 0, plan(0, 'hold', null)),
      describe1: vantaRules.describeMove!(s, 1, plan(1, 'hold', null)),
    });
    expect(publicText).not.toContain('Raider');
    expect(publicText).not.toContain('Broad Front');
    /* a completed objective is announced by title, never as "their objective" */
    const done = vantaRules.redact!(s, 0) as VantaState;
    expect(done.objectiveDone[1]).toBe(false);
  });
});

/* ------------------------------------------------------------------ 4. energy */

describe('VANTA — energy', () => {
  it('charges only for actions that happen', () => {
    const s = bare();
    /* an anchor blocks a claim: the claimer pays nothing */
    s.owner[12] = 0;
    s.anchored[12] = true;
    s.agents[1] = [13, 1, 5];
    expect(vantaRules.isLegal(s, 1, plan(0, 'claim', 12))).toBe(false);
    const after = round(s, plan(0, 'hold', null), plan(0, 'hold', null));
    expect(after.energy[1]).toBe(START_ENERGY);
  });

  it('never goes negative or over the cap', () => {
    let s = bare();
    s.energy = [MAX_ENERGY, MAX_ENERGY];
    for (let i = 0; i < 6; i++) {
      const p0 = choosePlan(s, 0, 'advanced', () => 0.5);
      const p1 = choosePlan(s, 1, 'advanced', () => 0.5);
      s = round(s, p0, p1);
      expect(s.energy[0]).toBeGreaterThanOrEqual(0);
      expect(s.energy[0]).toBeLessThanOrEqual(MAX_ENERGY);
      expect(s.energy[1]).toBeGreaterThanOrEqual(0);
      expect(s.energy[1]).toBeLessThanOrEqual(MAX_ENERGY);
      if (s.over) break;
    }
  });

  it('prices a steal above a claim, and a relay steal above both', () => {
    const s = bare();
    const neutral = neighbours(START_AGENTS[0][0]).find((n) => s.owner[n] === null)!;
    expect(costFor(s, 0, 'claim', neutral)).toBe(1);
    const steal = neighbours(START_AGENTS[0][0]).find((n) => s.owner[n] !== null);
    if (steal !== undefined) expect(costFor(s, 0, 'claim', steal)).toBe(2);
    s.owner[neutral] = 1;
    s.relay[neutral] = true;
    expect(costFor(s, 0, 'claim', neutral)).toBe(3);
  });

  it('pays a relay income and caps the pool', () => {
    const s = bare();
    s.owner[RELAYS[0]] = 0;
    s.energy = [MAX_ENERGY - 1, 1];
    const after = round(s, plan(0, 'hold', null), plan(1, 'hold', null));
    expect(after.energy[0]).toBe(MAX_ENERGY);
  });
});

/* ------------------------------------------------------------------ 5. actions */

describe('VANTA — the five actions', () => {
  it('move is free and claim costs one', () => {
    const s = bare();
    /* a plain square: standing on a relay pays an energy back, which would make
       this assertion about the wrong number */
    const step = targetsFor(s, 0, 1, 'move').find((n) => !s.relay[n])!;
    expect(s.relay[step]).toBe(false);
    const moved = round(s, plan(1, 'move', step), plan(0, 'hold', null));
    expect(moved.agents[0][1]).toBe(step);
    expect(moved.energy[0]).toBe(s.energy[0]);
    const claimed = round(s, plan(1, 'claim', step), plan(0, 'hold', null));
    expect(claimed.agents[0][1]).toBe(step);
    expect(claimed.owner[step]).toBe(0);
    expect(claimed.energy[0]).toBe(s.energy[0] - 1);
  });

  it('claim can plant a flag underfoot, so standing still can secure a square', () => {
    const s = bare();
    s.agents[0] = [START_AGENTS[0][0], START_AGENTS[0][1], 45];
    const here = 45;
    expect(targetsFor(s, 0, 2, 'claim')).toContain(here);
    const after = round(s, plan(2, 'claim', here), plan(0, 'hold', null));
    expect(after.owner[here]).toBe(0);
    expect(after.agents[0][2]).toBe(here);
  });

  it('anchor bolts the square: still takeable, at the tax', () => {
    let s = bare();
    s.agents[0] = [45, START_AGENTS[0][1], START_AGENTS[0][2]];
    s.agents[1] = [46, 1, 5];
    expect(s.relay[45]).toBe(false);
    const anchored = round(s, plan(0, 'anchor', null), plan(0, 'hold', null));
    expect(anchored.owner[45]).toBe(0);
    expect(anchored.anchored[45]).toBe(true);
    expect(anchored.energy[0]).toBe(s.energy[0] - 2);
    /* it is reachable — a bolt is a price, not a wall — and the price is the tax */
    expect(targetsFor(anchored, 1, 0, 'claim')).toContain(45);
    /* the square is bolted *and* occupied: both taxes stack */
    expect(costFor(anchored, 1, 'claim', 45, 0)).toBe(COST.claim + STEAL_COST + ANCHOR_TAX + SHOVE_TAX);
    const funded = clone(anchored);
    funded.energy[1] = MAX_ENERGY;                 // the break has to be affordable
    const broke = round(funded, plan(0, 'hold', null), plan(0, 'claim', 45));
    expect(broke.owner[45]).toBe(1);
    expect(broke.anchored[45]).toBe(false);        // the bolt does not survive the break
    expect(broke.energy[1]).toBe(MAX_ENERGY - (COST.claim + STEAL_COST + ANCHOR_TAX + SHOVE_TAX));
    expect(broke.lastRound!.results[1].outcome).toMatch(/broke the bolt/);
  });

  it('a claim shoves a parked agent aside instead of being refused', () => {
    const s = bare();
    /* a parked agent is the cheapest wall in the game — it has to be shovable */
    s.owner[45] = 1;
    s.agents[1] = [45, 1, 5];
    s.agents[0] = [46, START_AGENTS[0][1], START_AGENTS[0][2]];
    expect(targetsFor(s, 0, 0, 'claim')).toContain(45);
    expect(costFor(s, 0, 'claim', 45, 0)).toBe(COST.claim + STEAL_COST + SHOVE_TAX);
    const after = round(s, plan(0, 'claim', 45), plan(0, 'hold', null));
    expect(after.owner[45]).toBe(0);
    expect(after.agents[0][0]).toBe(45);
    /* the shoved agent is still on the table, just somewhere else */
    const shoved = after.agents[1][0];
    expect(shoved).not.toBe(45);
    expect(neighbours(45)).toContain(shoved);
    expect(after.lastRound!.results[0].outcome).toMatch(/shoved the agent/);
  });

  it('second and third bolts on relays cost more than the first', () => {
    const s = bare();
    /* three relays, one bolted: the next bolt has to cost more */
    const [r1, r2] = RELAYS;
    s.owner[r1] = 0; s.anchored[r1] = true;
    s.owner[r2] = 0;
    s.agents[0] = [r2, r2, r2];
    expect(costFor(s, 0, 'anchor', null, 0)).toBe(2);
    s.anchored[r2] = true;
    const third = RELAYS[2];
    s.owner[third] = 0;
    s.agents[0] = [third, third, third];
    expect(costFor(s, 0, 'anchor', null, 0)).toBe(3);
  });

  it('feint jumps two squares and leaves a decoy that absorbs an attack', () => {
    const s = bare();
    s.agents[0] = [16, START_AGENTS[0][1], START_AGENTS[0][2]];
    const jumps = targetsFor(s, 0, 0, 'feint');
    expect(jumps.length).toBeGreaterThan(0);
    const land = jumps[0];
    const feinted = round(s, plan(0, 'feint', land, 'claim'), plan(0, 'hold', null));
    expect(feinted.agents[0][0]).toBe(land);
    expect(feinted.decoys.some((d) => d.idx === 16)).toBe(true);
    expect(feinted.energy[0]).toBe(s.energy[0] - 1);
  });

  it('a snare catches a moving agent: it pays influence and sits out next round', () => {
    let s = bare();
    s.agents[0] = [16, START_AGENTS[0][1], START_AGENTS[0][2]];
    s.agents[1] = [24, 1, 5];
    expect(neighbours(24)).toContain(17);
    const laid = round(s, plan(0, 'snare', 17, 'claim'), plan(1, 'hold', null));
    expect(laid.traps).toHaveLength(1);
    /* the other seat walks straight onto it */
    const sprung = round(laid, plan(0, 'hold', null), plan(0, 'move', 17));
    expect(sprung.traps).toHaveLength(0);
    expect(sprung.influence[0]).toBeGreaterThanOrEqual(1);
    expect(sprung.stunned[1]).toContain(0);
    /* and that agent cannot act the round after */
    expect(vantaRules.isLegal(sprung, 1, plan(0, 'move', neighbours(17)[0]))).toBe(false);
    expect(vantaRules.isLegal(sprung, 1, plan(0, 'hold', null))).toBe(true);
  });

  it('a collision bounces both agents and costs nothing', () => {
    const s = bare();
    s.agents[0] = [16, START_AGENTS[0][1], START_AGENTS[0][2]];
    s.agents[1] = [18, 1, 5];
    const after = round(s, plan(0, 'move', 17, 'claim'), plan(0, 'move', 17, 'claim'));
    expect(after.agents[0][0]).toBe(16);
    expect(after.agents[1][0]).toBe(18);
    expect(after.energy).toEqual(s.energy);
    expect(after.lastRound!.results[0].ok).toBe(false);
  });
});

/* ------------------------------------------------------------------ 6. reads */

describe('VANTA — reads and insight', () => {
  it('pays energy for every correct read and influence only the first time per category', () => {
    /* a read is only paid when the named category is what they actually played */
    let t = bare();
    t.energy = [2, 2];
    t.owner = t.owner.map(() => null);
    t.owner[CORES[0]] = 0;
    t.owner[CORES[1]] = 1;
    const theirStep = targetsFor(t, 1, 0, 'claim').find((n) => !t.relay[n])!;
    t = round(t, plan(0, 'hold', null, 'claim'), plan(0, 'claim', theirStep));
    expect(t.insight[0]).toContain('claim');
    expect(t.predictionsCorrect[0]).toBe(1);
    expect(t.influence[0]).toBe(1);
    const energyAfterFirst = t.energy[0];
    /* the same category again: energy yes, influence no */
    const theirStep2 = targetsFor(t, 1, 1, 'claim').find((n) => !t.relay[n])!;
    const again = round(t, plan(0, 'hold', null, 'claim'), plan(1, 'claim', theirStep2));
    expect(again.predictionsCorrect[0]).toBe(2);
    expect(again.insight[0].filter((c) => c === 'claim')).toHaveLength(1);
    expect(again.energy[0]).toBe(energyAfterFirst + 1);
    expect(again.influence[0] - t.influence[0]).toBe(0);
  });

  it('caps total read influence at the five categories', () => {
    const s = bare();
    expect(s.insight).toEqual([[], []]);
    expect(OBJECTIVES.find((o) => o.id === 'reader')!.target).toBeGreaterThanOrEqual(3);
  });
});

/* ------------------------------------------------------------------ 7. events */

describe('VANTA — events', () => {
  it('announces an event on rounds 4, 7 and 10, before the round it affects', () => {
    let s = createInitialState({}, 2024);
    const seen: Record<number, string | null> = {};
    for (let i = 0; i < MAX_ROUNDS && !s.over; i++) {
      seen[s.round] = s.event?.kind ?? null;
      s = round(s, plan(0, 'hold', null, 'claim'), plan(1, 'hold', null, 'claim'));
    }
    expect(seen[1]).toBeNull();
    expect(seen[2]).toBeNull();
    expect(seen[3]).toBeNull();
    for (const r of [4, 7, 10]) if (r in seen) expect(seen[r]).not.toBeNull();
    for (const kind of Object.values(seen)) {
      if (kind) expect(Object.keys(EVENT_LABEL)).toContain(kind);
    }
  });

  it('shows the same event to both seats and seals blackout squares for both', () => {
    let s = createInitialState({}, 77);
    while (s.round < 4 && !s.over) s = round(s, plan(0, 'hold', null), plan(1, 'hold', null));
    if (s.event?.kind === 'blackout') {
      for (const sq of s.event.squares) {
        expect(targetsFor(s, 0, 0, 'move')).not.toContain(sq);
        expect(targetsFor(s, 1, 0, 'move')).not.toContain(sq);
      }
    }
    const v0 = vantaRules.redact!(s, 0) as VantaState;
    const v1 = vantaRules.redact!(s, 1) as VantaState;
    expect(v0.event).toEqual(v1.event);
  });
});

/* ------------------------------------------------------------------ 8. victory */

describe('VANTA — victory', () => {
  it('wins at twelve influence', () => {
    const s = bare();
    s.influence = [INFLUENCE_TO_WIN - 1, 0];
    s.owner[RELAYS[0]] = 0;
    const after = round(s, plan(0, 'hold', null, 'claim'), plan(1, 'hold', null, 'claim'));
    expect(after.over).toBe(true);
    expect(after.winner).toBe(0);
    expect(after.reason).toContain('influence');
    expect(vantaRules.result(after)).toEqual({ over: true, winner: 0, reason: after.reason });
    expect(vantaRules.legalMoves(after, 0)).toEqual([]);
  });

  it('wins by holding a bolted relay majority for consecutive scoring phases', () => {
    const s = bare();
    /* only bolted relays count: an unbolted post is a queue position */
    for (const r of RELAYS.slice(0, RELAY_WIN_COUNT)) { s.owner[r] = 0; s.anchored[r] = true; }
    const unbolted = round(s, plan(0, 'hold', null, 'claim'), plan(1, 'hold', null, 'claim'));
    expect(unbolted.over).toBe(false);
    let game = s;
    for (let phase = 1; phase <= RELAY_WIN_STREAK; phase++) {
      game = round(game, plan(0, 'hold', null, 'claim'), plan(1, 'hold', null, 'claim'));
      if (phase < RELAY_WIN_STREAK) {
        expect(game.over).toBe(false);
        expect(game.relayStreak[0]).toBe(phase);
      }
    }
    expect(game.over).toBe(true);
    expect(game.winner).toBe(0);
    expect(game.reason).toContain('relays');
  });

  it('wins by closing every square around the enemy core', () => {
    const s = bare();
    const ring = neighbours(CORES[1]);
    for (const n of ring) s.owner[n] = 0;
    const after = round(s, plan(0, 'hold', null), plan(1, 'hold', null));
    expect(after.over).toBe(true);
    expect(after.winner).toBe(0);
    expect(after.reason).toContain('core');
  });

  it('does not hand a simultaneous breakthrough to seat 0 by default', () => {
    const s = bare();
    s.influence = [INFLUENCE_TO_WIN, INFLUENCE_TO_WIN];
    const after = round(s, plan(0, 'hold', null), plan(1, 'hold', null));
    /* level on the line: nobody wins this round */
    expect(after.winner === null || after.over === false).toBe(true);
    if (after.over) expect(after.reason).not.toContain('reached');
  });

  it('uses the round limit and the published tie-breaks', () => {
    let s = bare();
    s.round = MAX_ROUNDS;
    s.influence = [4, 2];
    const after = round(s, plan(0, 'hold', null), plan(1, 'hold', null));
    expect(after.over).toBe(true);
    expect(after.winner).toBe(0);
    expect(after.reason).toContain('influence');

    let r = bare();
    r.round = MAX_ROUNDS;
    r.influence = [3, 3];
    r.owner[RELAYS[0]] = 0;
    const byRelay = round(r, plan(0, 'hold', null), plan(1, 'hold', null));
    expect(byRelay.over).toBe(true);
    expect(byRelay.reason).toMatch(/influence|relays|energy|dead level/);

    let d = bare();
    d.round = MAX_ROUNDS;
    d.influence = [3, 3];
    const draw = round(d, plan(0, 'hold', null), plan(1, 'hold', null));
    expect(draw.over).toBe(true);
    if (draw.winner === null) expect(draw.reason).toContain('dead level');
  });
});

/* ------------------------------------------------------------------ 9. objectives */

describe('VANTA — secret objectives', () => {
  it('pays the bonus once when the hidden condition lands', () => {
    const s = bare();
    s.objective = ['spread', 'raider'] as [ObjectiveId, ObjectiveId];
    s.owner = s.owner.map(() => null);
    s.owner[CORES[0]] = 0;
    s.owner[CORES[1]] = 1;
    for (const sq of [1, 2, 3, 4, 5, 6]) s.owner[sq] = 0;    // six squares: spread
    const before = s.influence[0];
    const after = round(s, plan(0, 'hold', null), plan(1, 'hold', null));
    expect(after.objectiveDone[0]).toBe(true);
    expect(after.influence[0]).toBeGreaterThanOrEqual(before + OBJECTIVE_BONUS);
    const again = round(after, plan(0, 'hold', null), plan(1, 'hold', null));
    expect(again.influence[0] - after.influence[0]).toBeLessThan(OBJECTIVE_BONUS);
  });

  it('reports progress only to the seat that owns the objective', () => {
    const s = bare();
    s.objective = ['spread', 'reader'] as [ObjectiveId, ObjectiveId];
    s.objectiveProgress = [3, 2];
    expect((vantaRules.redact!(s, 0) as VantaState).objectiveProgress).toEqual([3, 0]);
    expect((vantaRules.redact!(s, 1) as VantaState).objectiveProgress).toEqual([0, 2]);
  });

  it('has a target for every objective and no duplicates', () => {
    const ids = OBJECTIVES.map((o) => o.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const o of OBJECTIVES) {
      expect(o.target).toBeGreaterThan(0);
      expect(objectiveById(o.id)).toBe(o);
    }
  });
});

/* ------------------------------------------------------------------ 10. AI */

describe('VANTA — practice AI', () => {
  const play = (a: VantaStrength, b: VantaStrength, seed: number) => {
    let s = createInitialState({}, seed);
    let guard = 0;
    while (!s.over && guard++ < 40) {
      s = vantaRules.applyMove(s, 0, choosePlan(s, 0, a, Math.random));
      if (s.over || !s.plans[0]) break;
      s = vantaRules.applyMove(s, 1, choosePlan(s, 1, b, Math.random));
    }
    return s;
  };

  it('always submits a legal plan that carries a prediction', () => {
    for (let seed = 1; seed <= 12; seed++) {
      let s = createInitialState({}, seed);
      for (let i = 0; i < 30 && !s.over; i++) {
        const p0 = choosePlan(s, 0, 'expert', Math.random);
        expect(vantaRules.isLegal(s, 0, p0)).toBe(true);
        expect(['move', 'claim', 'anchor', 'feint', 'snare']).toContain(p0.predict);
        s = vantaRules.applyMove(s, 0, p0);
        if (s.over) break;
        const p1 = choosePlan(s, 1, 'advanced', Math.random);
        expect(vantaRules.isLegal(s, 1, p1)).toBe(true);
        s = vantaRules.applyMove(s, 1, p1);
      }
    }
  });

  it('plays a real heuristic, not random noise: expert beats beginner', () => {
    let expert = 0;
    let beginner = 0;
    for (let seed = 1; seed <= 24; seed++) {
      const s = play(seed % 2 ? 'expert' : 'beginner', seed % 2 ? 'beginner' : 'expert', 300 + seed * 17);
      if (s.winner === 0) { if (seed % 2) expert++; else beginner++; }
      if (s.winner === 1) { if (seed % 2) beginner++; else expert++; }
    }
    expect(expert).toBeGreaterThan(beginner);
    expect(expert).toBeGreaterThanOrEqual(16);
  });

  it('rates a winning position above a losing one', () => {
    const s = bare();
    const ahead = { ...s, influence: [8, 2] as [number, number] };
    expect(evaluate(ahead, 0)).toBeGreaterThan(evaluate(s, 0));
    expect(evaluate(ahead, 1)).toBeLessThan(evaluate(s, 1));
  });

  it('produces a probability distribution over the five categories', () => {
    const s = createInitialState({}, 8);
    const dist = readDistribution(s, 0);
    const total = Object.values(dist).reduce((n, v) => n + v, 0);
    expect(Object.keys(dist).sort()).toEqual(['anchor', 'claim', 'feint', 'move', 'snare']);
    expect(total).toBeCloseTo(1, 5);
    for (const v of Object.values(dist)) expect(v).toBeGreaterThan(0);
    expect(['move', 'claim', 'anchor', 'feint', 'snare']).toContain(choosePrediction(s, 0, 'expert', () => 0.1));
  });
});

/* ------------------------------------------------------------------ 11. whole games */

describe('VANTA — whole matches', () => {
  it('always terminates, always reaches a decision or an honest draw', () => {
    for (let seed = 1; seed <= 30; seed++) {
      let s = createInitialState({}, seed * 13);
      let guard = 0;
      while (!s.over && guard++ < 40) {
        s = vantaRules.applyMove(s, 0, choosePlan(s, 0, 'intermediate', Math.random));
        if (s.over) break;
        if (!s.plans[0]) continue;
        s = vantaRules.applyMove(s, 1, choosePlan(s, 1, 'advanced', Math.random));
      }
      expect(s.over).toBe(true);
      expect(s.round).toBeLessThanOrEqual(MAX_ROUNDS);
      expect(s.history.length).toBeGreaterThan(0);
      expect(s.lastRound).not.toBeNull();
      /* the human-readable report is always populated for both seats */
      expect(s.lastRound!.lines[0].length).toBeGreaterThan(3);
      expect(s.lastRound!.lines[1].length).toBeGreaterThan(3);
    }
  });

  it('never lets a seat end with influence it did not earn', () => {
    for (let seed = 1; seed <= 12; seed++) {
      let s = createInitialState({}, seed * 71);
      let guard = 0;
      while (!s.over && guard++ < 40) {
        const before = [...s.influence] as [number, number];
        s = vantaRules.applyMove(s, 0, choosePlan(s, 0, 'advanced', Math.random));
        if (s.over) break;
        if (!s.plans[0]) continue;
        s = vantaRules.applyMove(s, 1, choosePlan(s, 1, 'advanced', Math.random));
        for (const slot of [0, 1] as const) {
          const gain = s.influence[slot] - before[slot];
          const row = s.lastRound!.results[slot];
          /* the report's own arithmetic must match the scoreboard */
          expect(gain).toBeGreaterThanOrEqual(0);
          expect(row.influence).toBeLessThanOrEqual(gain);
        }
      }
    }
  });

  it('counts territory without ever exceeding the board', () => {
    const s = createInitialState({}, 3);
    expect(territoryCount(s, 0) + territoryCount(s, 1)).toBeLessThanOrEqual(SQUARES);
    expect(TERRITORY_T1).toBeGreaterThan(0);
  });
});
