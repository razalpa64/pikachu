/**
 * Truth or Dare — rules.
 *
 * Pass-and-play for two. The engine's only real job is to deal fairly: never
 * repeat a card until the matching pile is exhausted, respect the heat levels
 * that are switched on, and keep an honest tally of what was done and skipped.
 */
import { shuffled } from '../types';
import { DECK, type Card, type Heat, type Kind } from './deck';

export type { Card, Heat, Kind } from './deck';

export interface DarePlayer {
  name: string;
  done: number;
  skipped: number;
  truths: number;
  dares: number;
}

export interface DareState {
  seed: number;
  heats: Heat[];
  /** indices into DECK, already shuffled; split by kind so a choice is always possible */
  truthPile: number[];
  darePile: number[];
  drawnTruths: number[];
  drawnDares: number[];
  turn: 0 | 1;
  players: [DarePlayer, DarePlayer];
  /** the card on the table, or null while the player is still choosing */
  current: { index: number; kind: Kind } | null;
  history: { player: 0 | 1; card: Card; outcome: 'done' | 'skipped' }[];
  round: number;
}

const blank = (name: string): DarePlayer => ({ name, done: 0, skipped: 0, truths: 0, dares: 0 });

function piles(heats: Heat[], seed: number) {
  const live = heats.length ? heats : (['sweet'] as Heat[]);
  const idx = DECK.map((c, i) => ({ c, i })).filter(({ c }) => live.includes(c.heat));
  return {
    truthPile: shuffled(idx.filter(({ c }) => c.kind === 'truth').map(({ i }) => i), seed),
    darePile: shuffled(idx.filter(({ c }) => c.kind === 'dare').map(({ i }) => i), seed ^ 0x5bf03635),
  };
}

export function createDare(heats: Heat[], names: [string, string], seed: number): DareState {
  const { truthPile, darePile } = piles(heats, seed);
  return {
    seed, heats: heats.slice(),
    truthPile, darePile, drawnTruths: [], drawnDares: [],
    turn: 0,
    players: [blank(names[0] || 'You'), blank(names[1] || 'Them')],
    current: null, history: [], round: 1,
  };
}

/** Re-deal when the heat switches change, keeping the running tally. */
export function reheat(state: DareState, heats: Heat[]): DareState {
  const { truthPile, darePile } = piles(heats, state.seed ^ (heats.length * 7919));
  return { ...state, heats: heats.slice(), truthPile, darePile, drawnTruths: [], drawnDares: [], current: null };
}

export const remaining = (s: DareState, kind: Kind) =>
  kind === 'truth' ? s.truthPile.length : s.darePile.length;

/**
 * Draw the next card of the chosen kind. When a pile runs dry it is reshuffled
 * from the cards already seen — the game never dead-ends, and we say so in the UI.
 */
export function draw(state: DareState, kind: Kind): DareState {
  if (state.current) return state;
  const pileKey = kind === 'truth' ? 'truthPile' : 'darePile';
  const seenKey = kind === 'truth' ? 'drawnTruths' : 'drawnDares';

  let pile = state[pileKey];
  let seen = state[seenKey];
  if (!pile.length) {
    if (!seen.length) return state; // no cards at all at this heat — UI prevents this
    pile = shuffled(seen, (state.seed ^ (state.round * 0x45d9f3b)) >>> 0);
    seen = [];
  }

  const [index, ...rest] = pile;
  return { ...state, [pileKey]: rest, [seenKey]: seen, current: { index, kind } } as DareState;
}

/** Resolve the card on the table. Skipping is free and always allowed. */
export function resolve(state: DareState, outcome: 'done' | 'skipped'): DareState {
  if (!state.current) return state;
  const { index, kind } = state.current;
  const card = DECK[index];
  const seenKey = kind === 'truth' ? 'drawnTruths' : 'drawnDares';

  const players = state.players.map((p, i) =>
    i !== state.turn ? p : {
      ...p,
      done: p.done + (outcome === 'done' ? 1 : 0),
      skipped: p.skipped + (outcome === 'skipped' ? 1 : 0),
      truths: p.truths + (outcome === 'done' && kind === 'truth' ? 1 : 0),
      dares: p.dares + (outcome === 'done' && kind === 'dare' ? 1 : 0),
    }) as [DarePlayer, DarePlayer];

  return {
    ...state,
    [seenKey]: [...state[seenKey], index],
    players,
    current: null,
    turn: (state.turn === 0 ? 1 : 0) as 0 | 1,
    round: state.round + (state.turn === 1 ? 1 : 0),
    history: [...state.history, { player: state.turn, card, outcome }],
  } as DareState;
}

/** Keep the scoreboard in step with the name fields without resetting the tally. */
export function rename(state: DareState, names: [string, string]): DareState {
  const a = names[0] || 'You';
  const b = names[1] || 'Them';
  if (state.players[0].name === a && state.players[1].name === b) return state;
  return {
    ...state,
    players: [{ ...state.players[0], name: a }, { ...state.players[1], name: b }],
  };
}

/**
 * The bottle picks who answers next. Only legal while the table is clear —
 * a spin can never yank a card away from the person already holding one.
 */
export function setTurn(state: DareState, turn: 0 | 1): DareState {
  if (state.current) return state;
  return { ...state, turn };
}

export const cardAt = (i: number): Card => DECK[i];
export const totalPlayed = (s: DareState) => s.history.length;
