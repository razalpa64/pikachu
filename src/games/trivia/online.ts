/**
 * Spark Quiz, refereed by the server.
 *
 * This is NOT the solo quiz with a second seat bolted on. The solo game is a
 * turn-taking loop against a simulated rival; online, both players answer the
 * same question at the same time and the clock belongs to the server. That
 * makes it a *simultaneous* game, like Spark Reflex: `currentPlayer` is always
 * null, and `tick()` — not a move — is what advances the round.
 *
 * Two properties matter and are enforced here rather than in the UI:
 *   1. An answer is scored against the server's own clock. A client that lies
 *      about how fast it was gains nothing, because it never reports a time.
 *   2. Until a question closes, neither player is told what the other picked.
 *      `redact` strips it. Otherwise the second answerer could just copy.
 */
import type { Slot, TurnGameRules, Outcome } from '../types';
import { shuffled } from '../types';
import { buildQueue, scoreAnswer, type QuizConfig } from './rules';
import type { Question } from './bank';

export type QuizPhase = 'question' | 'reveal' | 'done';

export interface OnlineAsked {
  question: Question;
  /** display order; `order[i]` indexes into `question.a` */
  order: number[];
  /** index into `order` each player picked, or null if they ran out of time */
  picked: [number | null, number | null];
  /** ms each player took, measured by the server */
  tookMs: [number, number];
  points: [number, number];
}

export interface OnlineQuizState {
  config: QuizConfig;
  seed: number;
  queue: Question[];
  index: number;
  phase: QuizPhase;
  /** server timestamp this phase ends at */
  phaseEndsAt: number;
  /** server timestamp the current question went live */
  askedAt: number;
  order: number[];
  picked: [number | null, number | null];
  tookMs: [number, number];
  score: [number, number];
  streak: [number, number];
  bestStreak: [number, number];
  history: OnlineAsked[];
  over: boolean;
  winner: Slot | null;
  reason: string;
}

export type QuizMove = { type: 'answer'; option: number };

/** how long the answer is shown before the next question */
export const REVEAL_MS = 2600;
/** fallback when the room disables the per-question timer */
const UNTIMED_MS = 45_000;

const orderFor = (seed: number, index: number) =>
  shuffled([0, 1, 2, 3], (seed ^ ((index + 1) * 0x27d4eb2f)) >>> 0);

const limitMs = (c: QuizConfig) => (c.perQuestion > 0 ? c.perQuestion * 1000 : UNTIMED_MS);

function openQuestion(s: OnlineQuizState, now: number): OnlineQuizState {
  if (s.index >= s.queue.length) return finish(s);
  return {
    ...s,
    phase: 'question',
    askedAt: now,
    phaseEndsAt: now + limitMs(s.config),
    order: orderFor(s.seed, s.index),
    picked: [null, null],
    tookMs: [0, 0],
  };
}

/** Close the current question, score it, and move to the reveal. */
function closeQuestion(s: OnlineQuizState, now: number): OnlineQuizState {
  const q = s.queue[s.index];
  const limit = s.config.perQuestion;
  const score: [number, number] = [s.score[0], s.score[1]];
  const streak: [number, number] = [s.streak[0], s.streak[1]];
  const best: [number, number] = [s.bestStreak[0], s.bestStreak[1]];
  const points: [number, number] = [0, 0];
  const took: [number, number] = [s.tookMs[0], s.tookMs[1]];

  for (const seat of [0, 1] as Slot[]) {
    const pick = s.picked[seat];
    // `a[0]` is always the correct answer; order maps display slot -> answer index
    const right = pick !== null && s.order[pick] === 0;
    if (pick === null) took[seat] = limitMs(s.config);
    const pts = scoreAnswer(right, took[seat], limit, streak[seat]);
    points[seat] = pts;
    score[seat] += pts;
    streak[seat] = right ? streak[seat] + 1 : 0;
    best[seat] = Math.max(best[seat], streak[seat]);
  }

  const entry: OnlineAsked = {
    question: q, order: s.order, picked: [s.picked[0], s.picked[1]], tookMs: took, points,
  };

  return {
    ...s,
    phase: 'reveal',
    phaseEndsAt: now + REVEAL_MS,
    tookMs: took,
    score, streak, bestStreak: best,
    history: [...s.history, entry],
  };
}

function finish(s: OnlineQuizState): OnlineQuizState {
  const [a, b] = s.score;
  const winner: Slot | null = a === b ? null : a > b ? 0 : 1;
  const reason =
    a === b
      ? `Dead level on ${a} points.`
      : `${a > b ? 'Volt' : 'Spark'} took it ${Math.max(a, b)} to ${Math.min(a, b)}.`;
  return { ...s, phase: 'done', over: true, winner, reason };
}

export const quizOnlineRules: TurnGameRules<OnlineQuizState, QuizMove> = {
  id: 'trivia',

  createInitialState(config, seed) {
    const cfg: QuizConfig = {
      categories: Array.isArray(config.categories) && config.categories.length
        ? (config.categories as QuizConfig['categories'])
        : ['science', 'history', 'general', 'maths', 'geography', 'nature', 'philippines', 'society'],
      rounds: Math.max(1, Math.min(30, Number(config.rounds ?? 10))),
      perQuestion: Math.max(0, Math.min(90, Number(config.perQuestion ?? 20))),
    };
    // both players get the identical queue — same questions, same order
    const queue = buildQueue(cfg, 'intermediate', seed);
    const base: OnlineQuizState = {
      config: cfg, seed, queue, index: 0,
      phase: 'question', phaseEndsAt: 0, askedAt: 0,
      order: [0, 1, 2, 3], picked: [null, null], tookMs: [0, 0],
      score: [0, 0], streak: [0, 0], bestStreak: [0, 0],
      history: [], over: false, winner: null, reason: '',
    };
    return openQuestion(base, Date.now());
  },

  // simultaneous: nobody "has the turn", both may answer whenever they like
  currentPlayer: () => null,

  legalMoves(s, p) {
    if (s.over || s.phase !== 'question' || s.picked[p] !== null) return [];
    return [0, 1, 2, 3].map((option) => ({ type: 'answer', option }) as QuizMove);
  },

  isLegal(s, p, move): move is QuizMove {
    const m = move as QuizMove;
    if (!m || typeof m !== 'object' || m.type !== 'answer') return false;
    if (s.over || s.phase !== 'question') return false;
    if (s.picked[p] !== null) return false;            // one answer per question
    return Number.isInteger(m.option) && m.option >= 0 && m.option <= 3;
  },

  applyMove(s, p, m) {
    if (!this.isLegal(s, p, m)) return s;
    const now = Date.now();
    const picked: [number | null, number | null] = [s.picked[0], s.picked[1]];
    const took: [number, number] = [s.tookMs[0], s.tookMs[1]];
    picked[p] = m.option;
    // the server times the answer; the client is never asked how fast it was
    took[p] = Math.max(0, now - s.askedAt);
    const next = { ...s, picked, tookMs: took };
    // once both have answered there is nothing left to wait for
    if (picked[0] !== null && picked[1] !== null) return closeQuestion(next, now);
    return next;
  },

  result: (s): Outcome =>
    s.over ? { over: true, winner: s.winner, reason: s.reason } : { over: false },

  tick(s, now) {
    if (s.over) return s;
    if (s.phase === 'question' && now >= s.phaseEndsAt) return closeQuestion(s, now);
    if (s.phase === 'reveal' && now >= s.phaseEndsAt) {
      const advanced = { ...s, index: s.index + 1 };
      return advanced.index >= advanced.queue.length ? finish(advanced) : openQuestion(advanced, now);
    }
    return s;
  },

  /**
   * While a question is open, hide what the opponent picked — and hide the
   * rest of the queue, which would otherwise let a client read ahead.
   */
  redact(s, forPlayer) {
    const open = s.phase === 'question';
    const picked: [number | null, number | null] = open
      ? [
          forPlayer === 0 ? s.picked[0] : null,
          forPlayer === 1 ? s.picked[1] : null,
        ]
      : [s.picked[0], s.picked[1]];
    // `answered` keeps the "they're in" indicator honest without leaking the choice
    const answered: [boolean, boolean] = [s.picked[0] !== null, s.picked[1] !== null];
    return {
      ...s,
      picked,
      answered,
      // only the questions already asked — a client must not be able to read ahead.
      // `total` carries the real length, which the truncated queue can no longer tell you.
      queue: s.queue.slice(0, s.index + 1),
      total: s.queue.length,
    } as OnlineQuizState & { answered: [boolean, boolean]; total: number };
  },

  describeMove(s, p) {
    return `${p === 0 ? 'Volt' : 'Spark'} locked in an answer`;
  },
};
