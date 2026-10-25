/**
 * Would You Rather — the referee.
 *
 * The game is not "pick a side and see what they picked" — that is a
 * conversation, not a game, and it has no winner. It is a *bet*:
 *
 *   one player is the **chooser**, and answers honestly;
 *   the other is the **guesser**, and tries to predict the answer.
 *
 * The roles swap every round, so both people spend half the game being known and
 * half the game knowing someone. A round is worth exactly one point: the guesser
 * takes it by matching, the chooser takes it by surprising.
 *
 * Both decisions are simultaneous and secret. Until the reveal, `redact` hides
 * the opponent's pick — otherwise the guesser could simply read the answer, which
 * would make the whole game pointless and is exactly the sort of thing a client
 * cannot be trusted to hide on its own.
 */
import { shuffled, type Outcome, type Slot, type TurnGameRules } from '../types';
import { DILEMMAS, type Dilemma } from './deck';

export type Side = 'a' | 'b';

export interface WyrConfig {
  rounds: number;
  /** ms each round stays open before an unanswered side is treated as a pass */
  turnMs: number;
}

export interface WyrRound {
  dilemma: Dilemma;
  chooser: Slot;
  choice: Side | null;
  guess: Side | null;
  /** the guesser read it right */
  hit: boolean;
  /** who took the point; null when nobody did (the chooser ran out of time) */
  points: Slot | null;
}

export interface WyrState {
  config: WyrConfig;
  seed: number;
  /** dilemma ids, shuffled once — the order never changes mid-game */
  order: number[];
  index: number;
  phase: 'choose' | 'reveal' | 'done';
  phaseEndsAt: number;
  picked: [Side | null, Side | null];
  history: WyrRound[];
  score: [number, number];
  over: boolean;
  winner: Slot | null;
  reason: string;
}

export type WyrMove = { type: 'pick'; side: Side };

export const REVEAL_MS = 3200;

export const DEFAULT_WYR: WyrConfig = { rounds: 10, turnMs: 25_000 };

/** Roles alternate: even rounds slot 0 chooses, odd rounds slot 1 chooses. */
export const chooserFor = (index: number): Slot => (index % 2 === 0 ? 0 : 1);

const dilemmaAt = (order: number[], index: number): Dilemma =>
  DILEMMAS.find((d) => d.id === order[index]) ?? DILEMMAS[0];

export function buildOrder(seed: number, rounds: number, pool: Dilemma[] = DILEMMAS): number[] {
  return shuffled(pool.map((d) => d.id), seed).slice(0, Math.max(1, rounds));
}

function openRound(s: WyrState, now: number): WyrState {
  if (s.index >= s.order.length) return finish(s);
  return { ...s, phase: 'choose', phaseEndsAt: now + s.config.turnMs, picked: [null, null] };
}

function resolve(s: WyrState, now: number): WyrState {
  const dilemma = dilemmaAt(s.order, s.index);
  const chooser = chooserFor(s.index);
  const guesser: Slot = chooser === 0 ? 1 : 0;
  const choice = s.picked[chooser];
  const guess = s.picked[guesser];

  const hit = choice !== null && guess !== null && choice === guess;
  const points: Slot | null = choice === null ? null : hit ? guesser : chooser;

  const round: WyrRound = { dilemma, chooser, choice, guess, hit, points };
  const score: [number, number] = [s.score[0], s.score[1]];
  if (points !== null) score[points] += 1;

  return {
    ...s,
    phase: 'reveal',
    phaseEndsAt: now + REVEAL_MS,
    score,
    history: [...s.history, round],
  };
}

function finish(s: WyrState): WyrState {
  const [a, b] = s.score;
  const winner: Slot | null = a === b ? null : a > b ? 0 : 1;
  const reason = a === b
    ? `Level at ${a} each — you know each other equally well.`
    : `${winner === 0 ? 'Volt' : 'Spark'} read it better, ${Math.max(a, b)} to ${Math.min(a, b)}.`;
  return { ...s, phase: 'done', over: true, winner, reason };
}

export const wyrRules: TurnGameRules<WyrState, WyrMove> = {
  id: 'wyr',

  createInitialState(config, seed) {
    const cfg: WyrConfig = {
      rounds: Math.max(3, Math.min(20, Number(config.rounds ?? DEFAULT_WYR.rounds))),
      turnMs: Math.max(8000, Math.min(90_000, Number(config.turnMs ?? DEFAULT_WYR.turnMs))),
    };
    const base: WyrState = {
      config: cfg, seed, order: buildOrder(seed, cfg.rounds), index: 0,
      phase: 'choose', phaseEndsAt: 0, picked: [null, null],
      history: [], score: [0, 0], over: false, winner: null, reason: '',
    };
    return openRound(base, Date.now());
  },

  // simultaneous: both seats act in the same window, so nobody "has the turn"
  currentPlayer: () => null,

  legalMoves(s, p) {
    if (s.over || s.phase !== 'choose' || s.picked[p] !== null) return [];
    return [{ type: 'pick', side: 'a' }, { type: 'pick', side: 'b' }] as WyrMove[];
  },

  isLegal(s, p, move): move is WyrMove {
    const m = move as WyrMove;
    if (!m || typeof m !== 'object' || m.type !== 'pick') return false;
    if (s.over || s.phase !== 'choose') return false;
    if (s.picked[p] !== null) return false;
    return m.side === 'a' || m.side === 'b';
  },

  applyMove(s, p, m) {
    if (!this.isLegal(s, p, m)) return s;
    const picked: [Side | null, Side | null] = [s.picked[0], s.picked[1]];
    picked[p] = m.side;
    const next = { ...s, picked };
    if (picked[1 - p] !== null) return resolve(next, Date.now());
    return next;
  },

  result: (s): Outcome => (s.over ? { over: true, winner: s.winner, reason: s.reason } : { over: false }),

  tick(s, now) {
    if (s.over) return s;
    if (s.phase === 'choose' && now >= s.phaseEndsAt) return resolve(s, now);
    if (s.phase === 'reveal' && now >= s.phaseEndsAt) {
      const advanced = { ...s, index: s.index + 1 };
      return advanced.index >= advanced.order.length ? finish(advanced) : openRound(advanced, now);
    }
    return s;
  },

  /**
   * While the round is open, each client sees only its own pick, plus a flag
   * saying whether the other side has locked in. At the reveal everything is
   * visible. The dilemma order beyond the current round is also trimmed, so a
   * modified client cannot read ahead to the next ten questions.
   */
  redact(s, forPlayer) {
    const open = s.phase === 'choose';
    const picked: [Side | null, Side | null] = open
      ? [forPlayer === 0 ? s.picked[0] : null, forPlayer === 1 ? s.picked[1] : null]
      : [s.picked[0], s.picked[1]];
    return {
      ...s,
      picked,
      lockedIn: [s.picked[0] !== null, s.picked[1] !== null],
      order: s.order.slice(0, s.index + 1),
      total: s.order.length,
    } as WyrState & { lockedIn: [boolean, boolean]; total: number };
  },

  describeMove(s, p) {
    const chooser = chooserFor(s.index);
    return p === chooser ? `${p === 0 ? 'Volt' : 'Spark'} answered` : `${p === 0 ? 'Volt' : 'Spark'} guessed`;
  },
};
