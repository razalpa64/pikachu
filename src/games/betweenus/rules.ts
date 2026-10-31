/**
 * BETWEEN US — THE FORGOTTEN FREQUENCY.
 *
 * Stage one: the signal room.
 *
 * Two people are locked in a bunker at opposite ends of the same room. One of
 * them stands at the **signal wall**, where three glyphs light up in sequence;
 * the other stands at the **console**, where three dials must be set and a lever
 * pulled. Neither can do it alone: the listener can see the glyphs but not the
 * dials, and the operator has the dials and a legend plate that turns a glyph
 * into a number — but cannot see which glyphs are lit.
 *
 * That is the whole game, and everything about it lives on the server:
 *
 *   • the glyphs are chosen here, so neither client can read them from the wire
 *     unless it is that player's business to know;
 *   • `redact` is the only thing standing between the operator and the answer,
 *     so it is the piece that gets tested hardest;
 *   • the operator's dials are checked here against the code, which means a
 *     client cannot pull the lever on a dial setting it never really had.
 *
 * Deliberately not in stage one: the second room, the voice link, the night
 * cycle. Stage one is one room, one puzzle, two people — playable start to
 * finish, which is the only way to prove the shape of the thing.
 */
import type { Outcome, Slot, TurnGameRules } from '../../games/types';

export const ROUNDS = 3;
export const DIALS = 3;
export const STRIKES = 3;
/** Glyph index → the number the operator's legend plate assigns it. */
export const SYMBOL_DIGIT = [3, 0, 6, 1, 7, 2, 5, 4] as const;
/** How many glyphs the wall can show. */
export const SYMBOLS = SYMBOL_DIGIT.length;

export interface BeuEvent {
  kind: 'dial' | 'wrong' | 'right' | 'strike' | 'done';
  slot?: Slot;
  index?: number;
  value?: number;
}

export interface BetweenUsState {
  round: number;
  rounds: number;
  /** glyph indices lit on the wall this round — private to the listener */
  code: number[];
  /** what the operator has set — public */
  dials: number[];
  strikes: number;
  solved: boolean;
  over: boolean;
  winner: Slot | null;
  reason: string;
  log: string[];
  event: BeuEvent | null;
  moves: number;
  seed: number;
}

export type BeuMove = { t: 'dial'; index: number; delta: number } | { t: 'pull' } | { t: 'wait' };

/** Deterministic per-round glyphs, so a reconnect shows the same wall. */
function glyphsFor(seed: number, round: number): number[] {
  let s = (seed ^ (round * 0x9e3779b9)) >>> 0;
  const next = () => {
    s = (Math.imul(s ^ (s >>> 15), 0x85ebca6b) + 0x165667b1) >>> 0;
    return s / 4294967296;
  };
  const pool = [...Array(SYMBOLS).keys()];
  const out: number[] = [];
  for (let i = 0; i < DIALS; i++) {
    const pick = Math.floor(next() * pool.length);
    out.push(pool.splice(pick, 1)[0]);
  }
  return out;
}

export const codeOf = (s: BetweenUsState): number[] => s.code.map((g) => SYMBOL_DIGIT[g]);
export const isCorrect = (s: BetweenUsState): boolean => codeOf(s).every((d, i) => d === s.dials[i]);

export function createInitial(seed = 1): BetweenUsState {
  const s = (seed >>> 0) || 1;
  return {
    round: 1,
    rounds: ROUNDS,
    code: glyphsFor(s, 1),
    dials: new Array(DIALS).fill(0),
    strikes: 0,
    solved: false,
    over: false,
    winner: null,
    reason: '',
    log: ['The room is awake. Three glyphs are lit on the wall.'],
    event: null,
    moves: 0,
    seed: s,
  };
}

const say = (state: BetweenUsState, line: string): string[] => [...state.log, line].slice(-12);

/**
 * The two players occupy different stations, and the station decides what you
 * are allowed to do: only the operator can turn a dial or reach the lever.
 */
export const stationOf = (slot: Slot): 'listener' | 'operator' => (slot === 0 ? 'listener' : 'operator');

export function applyMove(state: BetweenUsState, slot: Slot, move: BeuMove): BetweenUsState {
  if (state.over) return state;
  const operator = stationOf(slot) === 'operator';

  if (move.t === 'dial') {
    if (!operator) return state;
    if (!Number.isInteger(move.index) || move.index < 0 || move.index >= DIALS) return state;
    const delta = move.delta > 0 ? 1 : -1;
    const dials = state.dials.slice();
    dials[move.index] = (dials[move.index] + delta + 8) % 8;
    return {
      ...state,
      dials,
      moves: state.moves + 1,
      event: { kind: 'dial', slot, index: move.index, value: dials[move.index] },
    };
  }

  if (move.t === 'pull') {
    if (!operator) return state;
    if (isCorrect(state)) {
      if (state.round >= state.rounds) {
        return {
          ...state,
          solved: true,
          over: true,
          winner: null,
          moves: state.moves + 1,
          reason: 'Three frequencies carried. The door is open.',
          event: { kind: 'done', slot },
          log: say(state, 'The lever falls, the panel goes white — the door opens.'),
        };
      }
      const round = state.round + 1;
      return {
        ...state,
        round,
        code: glyphsFor(state.seed, round),
        dials: new Array(DIALS).fill(0),
        moves: state.moves + 1,
        event: { kind: 'right', slot },
        log: say(state, `Frequency ${state.round} carried. The wall shows a new signal.`),
      };
    }
    const strikes = state.strikes + 1;
    if (strikes >= STRIKES) {
      return {
        ...state,
        strikes,
        over: true,
        winner: null,
        reason: `Three bad frequencies. The room went dark on round ${state.round}.`,
        event: { kind: 'strike', slot },
        log: say(state, 'The lever falls on a dead frequency. The lights go out.'),
      };
    }
    return {
      ...state,
      strikes,
      moves: state.moves + 1,
      event: { kind: 'wrong', slot },
      log: say(state, `Dead air. That was not the frequency. ${STRIKES - strikes} left.`),
    };
  }

  return state;
}

/**
 * What one player is allowed to see. The listener gets the glyphs; the operator
 * gets the dials and a legend. Nobody gets both — that is the entire game.
 */
export function viewFor(state: BetweenUsState, slot: Slot | 'spectator') {
  /* a spectator is given neither half — there is nothing to see from outside */
  const listener = slot !== 'spectator' && stationOf(slot) === 'listener';
  const operator = slot !== 'spectator' && stationOf(slot) === 'operator';
  return {
    round: state.round,
    rounds: state.rounds,
    station: slot === 'spectator' ? ('spectator' as const) : stationOf(slot),
    /** lit glyph indices — empty for the operator */
    code: listener ? state.code : [],
    /** the digit each glyph stands for — the operator reads this off the plate */
    legend: operator ? [...SYMBOL_DIGIT] : [],
    dials: state.dials,
    strikes: state.strikes,
    strikesLeft: STRIKES - state.strikes,
    solved: state.solved,
    over: state.over,
    reason: state.reason,
    event: state.event,
    log: state.log,
    moves: state.moves,
  };
}

export type BetweenUsView = ReturnType<typeof viewFor>;

export const betweenUsRules: TurnGameRules<BetweenUsState, BeuMove> = {
  id: 'betweenus',
  createInitialState: (_config, seed) => createInitial(seed || 1),
  /* Both stations act whenever they like — this is not a turn-based game. */
  currentPlayer: (s) => (s.over ? null : null),
  legalMoves: (s, slot) => {
    if (s.over) return [];
    return stationOf(slot) === 'operator'
      ? [{ t: 'dial', index: 0, delta: 1 }, { t: 'pull' }]
      : [];
  },
  isLegal: (s, slot, move): move is BeuMove => {
    if (s.over || !move || typeof move !== 'object') return false;
    const m = move as BeuMove;
    if (stationOf(slot) !== 'operator') return false;
    if (m.t === 'pull') return true;
    if (m.t === 'dial') {
      return Number.isInteger(m.index) && m.index >= 0 && m.index < DIALS && Number.isFinite(m.delta);
    }
    return false;
  },
  applyMove: (s, slot, move) => (betweenUsRules.isLegal(s, slot, move) ? applyMove(s, slot, move) : s),
  result: (s): Outcome => (s.over ? { over: true, winner: null, reason: s.reason } : { over: false }),
  describeMove: (_s, slot, m) => {
    if (m.t === 'pull') return `${stationOf(slot)} pulled the lever`;
    if (m.t === 'dial') return `${stationOf(slot)} turned dial ${m.index + 1}`;
    return '';
  },
  /** The one thing that must never leak: the answer. */
  redact: (s, slot) => viewFor(s, slot),
};
