import type { Outcome, Slot, TurnGameRules } from '../types';

/**
 * Mancala (Kalah).
 *
 * Six pits each and a store at the end of your own row. On your turn you lift every
 * seed from one of your pits and sow them one by one, counter-clockwise, skipping
 * the opponent's store. Two rules give the game its shape:
 *
 *   • the last seed landing in **your store** buys you another turn;
 *   • the last seed landing in an **empty pit of your own** captures that seed plus
 *     everything in the pit directly opposite.
 *
 * The round ends the moment one side's six pits are empty; whatever is left on the
 * other side is swept into that player's store. Most seeds wins.
 *
 * Layout: indices 0–5 are slot 0's pits, 6 is slot 0's store, 7–12 are slot 1's
 * pits (ordered so that index 0 is furthest from slot 0's store) and 13 is slot 1's
 * store. That single ordering makes sowing a plain `+1` walk.
 */

export const PITS = 6;
export const SEEDS = 4;

export interface MancalaState {
  pits: number;
  board: number[];
  turn: Slot;
  /** the indices the last sowing touched, in order, so the UI can animate them */
  sown: number[];
  lastCapture: number;
  over: boolean;
  winner: Slot | null;
  reason: string;
  history: { pit: number; slot: Slot }[];
}

export type MancalaMove = { pit: number };

export const boardLen = (pits: number) => pits * 2 + 2;
/** index of a player's store, which shifts with the pit count */
export const storeOf = (s: { pits: number }, p: Slot) => (p === 0 ? s.pits : s.pits * 2 + 1);
/** board index of the mover's `pit`-th pit (0-based from their store end) */
export const pitIndex = (s: { pits: number }, slot: Slot, pit: number) => (slot === 0 ? pit : s.pits + 1 + pit);
export const myPits = (s: MancalaState, p: Slot) => Array.from({ length: s.pits }, (_, i) => pitIndex(s, p, i));
/** the pit directly across the board — the one a capture takes with it */
const opposite = (s: { pits: number }, i: number) => s.pits * 2 - i;

export function seedsIn(s: MancalaState, p: Slot): number {
  return myPits(s, p).reduce((n, i) => n + s.board[i], 0);
}

/** Advance one step, skipping the store that is not ours. */
function step(s: MancalaState, i: number, p: Slot) {
  const len = boardLen(s.pits);
  let j = (i + 1) % len;
  if (j === storeOf(s, p === 0 ? 1 : 0)) j = (j + 1) % len;
  return j;
}

export const mancalaRules: TurnGameRules<MancalaState, MancalaMove> = {
  id: 'mancala',
  createInitialState(config) {
    const pits = Math.max(4, Math.min(8, Number(config.pits ?? PITS)));
    const seeds = Math.max(2, Math.min(8, Number(config.seeds ?? SEEDS)));
    const board = Array(boardLen(pits)).fill(seeds);
    board[pits] = 0;              // slot 0 store
    board[pits * 2 + 1] = 0;      // slot 1 store
    return { pits, board, turn: 0, sown: [], lastCapture: 0, over: false, winner: null, reason: '', history: [] };
  },

  currentPlayer: (s) => (s.over ? null : s.turn),

  legalMoves(s, p) {
    if (s.over || s.turn !== p) return [];
    const out: MancalaMove[] = [];
    myPits(s, p).forEach((i, pit) => { if (s.board[i] > 0) out.push({ pit }); });
    return out;
  },

  isLegal(s, p, m): m is MancalaMove {
    const mv = m as MancalaMove;
    if (!mv || typeof mv.pit !== 'number' || !Number.isInteger(mv.pit)) return false;
    if (s.over || s.turn !== p) return false;
    if (mv.pit < 0 || mv.pit >= s.pits) return false;
    return s.board[pitIndex(s, p, mv.pit)] > 0;
  },

  applyMove(s, p, m) {
    if (!this.isLegal(s, p, m)) return s;
    const board = s.board.slice();
    const store = storeOf(s, p);
    const from = pitIndex(s, p, m.pit);
    let seeds = board[from];
    board[from] = 0;

    let at = from;
    const sown: number[] = [];
    while (seeds > 0) {
      at = step(s, at, p);
      board[at] += 1;
      seeds -= 1;
      sown.push(at);
    }

    let lastCapture = 0;
    const mine = new Set(myPits(s, p));
    // capture: last seed in an empty pit of ours takes the pit opposite with it
    if (at !== store && mine.has(at) && board[at] === 1) {
      const opp = opposite(s, at);
      const taken = board[at] + board[opp];
      if (taken > 0) {
        board[store] += taken;
        board[at] = 0;
        board[opp] = 0;
        lastCapture = taken;
      }
    }

    const extra = at === store;
    const next: MancalaState = {
      ...s, board, sown, lastCapture,
      history: [...s.history, { pit: m.pit, slot: p }],
      turn: extra ? p : (p === 0 ? 1 : 0),
    };

    const empty = (slot: Slot) => myPits(s, slot).every((i) => board[i] === 0);
    if (empty(0) || empty(1)) {
      // sweep: the side that still has seeds keeps them
      for (const slot of [0, 1] as Slot[]) {
        if (empty(slot)) continue;
        for (const i of myPits(s, slot)) { board[storeOf(s, slot)] += board[i]; board[i] = 0; }
      }
      const a = board[storeOf(s, 0)], b = board[storeOf(s, 1)];
      return {
        ...next, over: true,
        winner: a === b ? null : a > b ? 0 : 1,
        reason: 'a pit row ran dry',
      };
    }
    return next;
  },

  result: (s): Outcome => (s.over ? { over: true, winner: s.winner, reason: s.reason } : { over: false }),

  describeMove: (_s, p, m) => `${p === 0 ? 'Volt' : 'Spark'} sows pit ${m.pit + 1}`,
};
