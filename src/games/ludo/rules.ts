/**
 * Ludo, refereed.
 *
 * One number per token — how far it has walked — and every rule is arithmetic on
 * that number. Which is why this file can be the whole game: the board is a ring
 * of 52 squares (`track.ts`), a token walks 51 of them, turns into its own
 * five-square lane, and must land exactly on home.
 *
 * The rules are the ones that make Ludo a game rather than a race:
 *
 *   • six brings a token out of the yard, or moves one already out;
 *   • a six earns another roll, and three sixes in a row burn the turn;
 *   • landing on an opponent sends it back to their yard — unless the square is
 *     safe, which the start squares and four stars are;
 *   • a capture earns another roll;
 *   • home needs the exact number: overshoot and you stay put.
 *
 * The dice are rolled *here*, from a seed carried in the state, so the relay
 * decides what you rolled. A client can pick which token to move; it cannot pick
 * the number, and it cannot move a token further than the board allows.
 */
import type { Outcome, Slot, TurnGameRules } from '../types';
import { HOME_STEP, RING, RING_STEPS, START, cellFor, isSafeRing, ringIndexOf } from './track';

export type LudoMove = { t: 'roll' } | { t: 'move'; token: number } | { t: 'pass' };

export type LudoEventKind = 'roll' | 'move' | 'capture' | 'home' | 'six' | 'burn' | 'pass' | 'out' | 'win';

export interface LudoEvent {
  kind: LudoEventKind;
  slot: Slot;
  token?: number;
  from?: number;
  to?: number;
  /** ring index of a captured token, so the board can fly it home */
  captured?: { slot: Slot; token: number }[];
  dice?: number;
}

export interface LudoState {
  /** which board seats are in play; two players sit opposite each other */
  seats: number[];
  /** progress per seat per token: −1 in the yard, 0…55 on the way, 56 home */
  tokens: number[][];
  turn: Slot;
  /** the number waiting to be spent, or null when it is time to roll */
  dice: number | null;
  /** consecutive sixes in this turn */
  sixes: number;
  /** what the next roll is derived from — carried in the state, so the relay decides */
  seed: number;
  winner: Slot | null;
  over: boolean;
  reason: string;
  moves: number;
  event: LudoEvent | null;
  log: string[];
}

export const TOKENS = 4;
/** two players, on opposite corners of the board */
export const SEATS = [0, 2] as const;
export const seatOf = (slot: Slot): number => SEATS[slot];
/** the cap that guarantees a room can end even if nobody can finish */
export const MOVE_LIMIT = 400;

/* ------------------------------------------------------------------ dice */

/** One step of a mulberry32 stream, without allocating a closure per roll. */
function nextSeed(a: number): { seed: number; value: number } {
  a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return { seed: a >>> 0, value: ((t ^ (t >>> 14)) >>> 0) / 4294967296 };
}

export function rollFrom(seed: number): { dice: number; seed: number } {
  const { seed: s, value } = nextSeed(seed >>> 0);
  return { dice: 1 + Math.floor(value * 6), seed: s };
}

/* ------------------------------------------------------------------ helpers */

export const progressOf = (state: LudoState, slot: Slot, token: number) => state.tokens[slot][token];
export const homeCount = (state: LudoState, slot: Slot) => state.tokens[slot].filter((p) => p >= HOME_STEP).length;
export const yardCount = (state: LudoState, slot: Slot) => state.tokens[slot].filter((p) => p < 0).length;

/** Total distance walked — the tie-break when the move cap is reached. */
export const progressTotal = (state: LudoState, slot: Slot) =>
  state.tokens[slot].reduce((sum, p) => sum + Math.max(0, p), 0);

/** Which tokens may move with `dice`. Empty when nothing can be played. */
export function movableTokens(state: LudoState, slot: Slot, dice: number): number[] {
  const out: number[] = [];
  const toks = state.tokens[slot];
  for (let i = 0; i < toks.length; i++) {
    const p = toks[i];
    if (p >= HOME_STEP) continue;                       // already home
    if (p < 0) { if (dice === 6) out.push(i); continue; }// only a six opens the yard
    if (p + dice <= HOME_STEP) out.push(i);             // and home needs the exact number
  }
  return out;
}

/** Where a token would end up, and which ring square that is. */
export function destination(state: LudoState, slot: Slot, token: number, dice: number) {
  const from = state.tokens[slot][token];
  const to = from < 0 ? 0 : from + dice;
  return { from, to, ring: ringIndexOf(seatOf(slot), to) };
}

/** Opponent tokens standing on the ring square a move would land on. */
export function capturesAt(state: LudoState, slot: Slot, to: number): { slot: Slot; token: number }[] {
  const ring = ringIndexOf(seatOf(slot), to);
  if (ring === null) return [];
  if (isSafeRing(seatOf(slot), to)) return [];
  const out: { slot: Slot; token: number }[] = [];
  for (const other of [0, 1] as Slot[]) {
    if (other === slot) continue;
    state.tokens[other].forEach((p, i) => {
      if (ringIndexOf(seatOf(other), p) === ring) out.push({ slot: other, token: i });
    });
  }
  return out;
}

const clone = (tokens: number[][]): number[][] => tokens.map((row) => row.slice());

/* ------------------------------------------------------------------ the game */

export function createInitial(): LudoState {
  return {
    seats: [...SEATS],
    tokens: [new Array(TOKENS).fill(-1), new Array(TOKENS).fill(-1)],
    turn: 0,
    dice: null,
    sixes: 0,
    seed: 1,
    winner: null,
    over: false,
    reason: '',
    moves: 0,
    event: null,
    log: ['Roll a six to bring a token out.'],
  };
}

export function createWithSeed(seed: number): LudoState {
  return { ...createInitial(), seed: ((seed >>> 0) || 1) };
}

const say = (state: LudoState, line: string): string[] => [...state.log, line].slice(-12);

function endTurn(state: LudoState): LudoState {
  const turn: Slot = state.turn === 0 ? 1 : 0;
  return { ...state, turn, dice: null, sixes: 0 };
}

function finishIfWon(state: LudoState): LudoState {
  for (const slot of [0, 1] as Slot[]) {
    if (homeCount(state, slot) === TOKENS) {
      return {
        ...state,
        over: true,
        winner: slot,
        dice: null,
        reason: `${slot === 0 ? 'Gold' : 'Rose'} brought every token home in ${state.moves} rolls.`,
        event: { kind: 'win', slot },
        log: say(state, `${slot === 0 ? 'Gold' : 'Rose'} wins.`),
      };
    }
  }
  if (state.moves >= MOVE_LIMIT) {
    const a = progressTotal(state, 0), b = progressTotal(state, 1);
    const winner = a === b ? null : a > b ? 0 : 1;
    return {
      ...state,
      over: true,
      winner,
      dice: null,
      reason: winner === null
        ? `Level after ${MOVE_LIMIT} rolls.`
        : `Out of rolls — ${winner === 0 ? 'gold' : 'rose'} was further along.`,
      event: { kind: 'win', slot: (winner ?? 0) as Slot },
    };
  }
  return state;
}

/** Roll, resolve a burn, and hand the state back with a number to spend. */
function roll(state: LudoState, slot: Slot): LudoState {
  const { dice, seed } = rollFrom(state.seed);
  const sixes = dice === 6 ? state.sixes + 1 : 0;
  const base: LudoState = { ...state, seed, dice, sixes, moves: state.moves + 1, event: { kind: 'roll', slot, dice } };

  if (sixes >= 3) {
    return {
      ...endTurn(base),
      event: { kind: 'burn', slot, dice },
      log: say(base, `${slot === 0 ? 'Gold' : 'Rose'} rolled a third six — the turn is burnt.`),
    };
  }
  return base;
}

export function applyLudo(state: LudoState, slot: Slot, move: LudoMove): LudoState {
  if (state.over || slot !== state.turn) return state;

  if (move.t === 'roll') {
    if (state.dice !== null) return state;
    return finishIfWon(roll(state, slot));
  }

  if (move.t === 'pass') {
    if (state.dice === null) return state;
    if (movableTokens(state, slot, state.dice).length > 0) return state;
    return finishIfWon({
      ...endTurn(state),
      event: { kind: 'pass', slot, dice: state.dice },
      log: say(state, `${slot === 0 ? 'Gold' : 'Rose'} had nothing to move with a ${state.dice}.`),
    });
  }

  const dice = state.dice;
  if (dice === null) return state;
  const token = Math.trunc(move.token);
  if (!Number.isInteger(token) || token < 0 || token >= TOKENS) return state;
  if (!movableTokens(state, slot, dice).includes(token)) return state;

  const { from, to } = destination(state, slot, token, dice);
  const captured = capturesAt(state, slot, to);

  const tokens = clone(state.tokens);
  tokens[slot][token] = to;
  for (const c of captured) tokens[c.slot][c.token] = -1;

  const name = slot === 0 ? 'Gold' : 'Rose';
  const target = cellFor(seatOf(slot), to);
  let next: LudoState = {
    ...state,
    tokens,
    moves: state.moves + 1,
    event: captured.length
      ? { kind: 'capture', slot, token, from, to, captured }
      : to >= HOME_STEP
        ? { kind: 'home', slot, token, from, to }
        : from < 0
          ? { kind: 'out', slot, token, from, to }
          : { kind: 'move', slot, token, from, to },
  };

  if (from < 0) next.log = say(next, `${name} brought a token out.`);
  else if (to >= HOME_STEP) next.log = say(next, `${name} brought a token home.`);
  else if (captured.length) next.log = say(next, `${name} captured on ${target ? `${target[0]},${target[1]}` : 'the board'}.`);
  else next.log = say(next, `${name} moved ${dice}.`);

  const finished = finishIfWon(next);
  if (finished.over) return finished;

  // a six or a capture buys another roll
  if (dice === 6 || captured.length > 0) return { ...finished, dice: null };
  return endTurn(finished);
}

/* ------------------------------------------------------------------ referee */

export const ludoRules: TurnGameRules<LudoState, LudoMove> = {
  id: 'ludo',
  createInitialState: (_config, seed) => createWithSeed(seed === 0 ? 1 : seed),
  currentPlayer: (s) => (s.over ? null : s.turn),
  legalMoves: (s, player) => {
    if (s.over || player !== s.turn) return [];
    if (s.dice === null) return [{ t: 'roll' }];
    const movable = movableTokens(s, player, s.dice);
    if (!movable.length) return [{ t: 'pass' }];
    return movable.map((token) => ({ t: 'move', token }) as LudoMove);
  },
  isLegal: (s, player, move): move is LudoMove => {
    if (s.over || player !== s.turn || !move || typeof move !== 'object') return false;
    const m = move as LudoMove;
    if (m.t === 'roll') return s.dice === null;
    if (m.t === 'pass') return s.dice !== null && movableTokens(s, player, s.dice).length === 0;
    if (m.t === 'move') {
      if (s.dice === null) return false;
      if (!Number.isInteger(m.token) || m.token < 0 || m.token >= TOKENS) return false;
      return movableTokens(s, player, s.dice).includes(m.token);
    }
    return false;
  },
  applyMove: (s, player, move) => (ludoRules.isLegal(s, player, move) ? applyLudo(s, player, move) : s),
  result: (s): Outcome => (s.over ? { over: true, winner: s.winner, reason: s.reason } : { over: false }),
  describeMove: (s, _p, m) => {
    if (m.t === 'roll') return `rolled ${s.dice ?? 'the die'}`;
    if (m.t === 'pass') return `rolled ${s.event?.dice ?? '—'}, nothing to move`;
    const at = s.tokens[s.turn][m.token];
    const where = at < 0 ? 'out of the yard' : at + (s.dice ?? 0) >= HOME_STEP ? 'home' : 'along the ring';
    return `token ${m.token + 1} ${where}`;
  },
};

export { HOME_STEP, RING, RING_STEPS, START, cellFor, ringIndexOf, isSafeRing };
