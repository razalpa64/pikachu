import type { Slot, TurnGameRules, Outcome } from '../types';
import { rng } from '../types';

/**
 * Server-authoritative timing. The browser only reports "I pressed"; the SERVER stamps the time.
 * Network latency means the two players never have perfectly identical conditions — we surface
 * each player's measured round-trip so the result is honest rather than pretending otherwise.
 */
export type RDPhase = 'idle' | 'countdown' | 'armed' | 'signal' | 'reveal' | 'done';

export interface RDRound {
  index: number;
  signalAt: number | null;
  responses: [number | null, number | null];   // ms after signal
  falseStart: [boolean, boolean];
  winner: Slot | null;
}
export interface RDState {
  bestOf: number;
  round: number;
  phase: RDPhase;
  phaseEndsAt: number;
  signalAt: number | null;
  armDelay: number;
  responses: [number | null, number | null];
  falseStart: [boolean, boolean];
  wins: [number, number];
  rounds: RDRound[];
  seed: number;
  over: boolean; winner: Slot | null; reason: string;
}
export type RDMove = { type: 'press' } | { type: 'advance' };

const COUNTDOWN_MS = 2600;
const REVEAL_MS = 2400;

function armNext(s: RDState, now: number): RDState {
  const r = rng(s.seed + s.round * 7919);
  const delay = 1300 + Math.floor(r() * 3200);
  return { ...s, phase: 'countdown', phaseEndsAt: now + COUNTDOWN_MS, armDelay: delay, signalAt: null, responses: [null, null], falseStart: [false, false] };
}

function scoreRound(s: RDState): RDState {
  const [a, b] = s.responses;
  const [fa, fb] = s.falseStart;
  let winner: Slot | null = null;
  if (fa && fb) winner = null;
  else if (fa) winner = 1;
  else if (fb) winner = 0;
  else if (a !== null && b !== null) winner = a === b ? null : a < b ? 0 : 1;
  else if (a !== null) winner = 0;
  else if (b !== null) winner = 1;

  const wins = [...s.wins] as [number, number];
  if (winner !== null) wins[winner] += 1;
  const rounds = [...s.rounds, { index: s.round, signalAt: s.signalAt, responses: s.responses, falseStart: s.falseStart, winner }];
  const need = Math.floor(s.bestOf / 2) + 1;
  const done = wins[0] >= need || wins[1] >= need || rounds.length >= s.bestOf;
  const champ = wins[0] === wins[1] ? null : wins[0] > wins[1] ? 0 : 1;
  return {
    ...s, wins, rounds, phase: done ? 'done' : 'reveal',
    phaseEndsAt: Date.now() + REVEAL_MS,
    over: done, winner: done ? (champ as Slot | null) : null,
    reason: done ? (champ === null ? 'dead heat' : 'fastest reflexes') : '',
  };
}

export const reactionRules: TurnGameRules<RDState, RDMove> = {
  id: 'reaction',
  createInitialState(config, seed) {
    const bestOf = Number(config.bestOf ?? 5);
    const base: RDState = {
      bestOf, round: 0, phase: 'idle', phaseEndsAt: 0, signalAt: null, armDelay: 0,
      responses: [null, null], falseStart: [false, false], wins: [0, 0], rounds: [],
      seed, over: false, winner: null, reason: '',
    };
    return armNext(base, Date.now());
  },
  currentPlayer: () => null,               // both players may act at any time
  legalMoves: (s) => (s.over ? [] : [{ type: 'press' }]),
  isLegal(s, _p, m): m is RDMove {
    const mv = m as RDMove;
    if (!mv || typeof mv.type !== 'string' || s.over) return false;
    if (mv.type === 'advance') return true;
    return s.phase === 'countdown' || s.phase === 'armed' || s.phase === 'signal';
  },
  applyMove(s, p, m) {
    const now = Date.now();
    if (m.type === 'advance') return s;
    if (s.phase === 'signal' && s.signalAt !== null) {
      if (s.responses[p] !== null) return s;
      const responses = [...s.responses] as [number | null, number | null];
      responses[p] = Math.max(0, now - s.signalAt);
      const next = { ...s, responses };
      if (responses[0] !== null && responses[1] !== null) return scoreRound(next);
      return next;
    }
    // pressed before the signal → false start
    if (s.falseStart[p]) return s;
    const falseStart = [...s.falseStart] as [boolean, boolean];
    falseStart[p] = true;
    const next = { ...s, falseStart };
    if (falseStart[0] && falseStart[1]) return scoreRound(next);
    if (next.phase === 'signal' && next.responses[(p === 0 ? 1 : 0)] !== null) return scoreRound(next);
    return next;
  },
  result: (s): Outcome => (s.over ? { over: true, winner: s.winner, reason: s.reason } : { over: false }),
  tick(s, now) {
    if (s.over) return s;
    if (s.phase === 'countdown' && now >= s.phaseEndsAt) {
      return { ...s, phase: 'armed', phaseEndsAt: now + s.armDelay };
    }
    if (s.phase === 'armed' && now >= s.phaseEndsAt) {
      // both already false-started → round resolves without a signal
      if (s.falseStart[0] && s.falseStart[1]) return scoreRound(s);
      return { ...s, phase: 'signal', signalAt: now, phaseEndsAt: now + 4000 };
    }
    if (s.phase === 'signal' && now >= s.phaseEndsAt) return scoreRound(s);
    if (s.phase === 'reveal' && now >= s.phaseEndsAt) {
      return armNext({ ...s, round: s.round + 1 }, now);
    }
    return s;
  },
};
