/**
 * Spark Quiz — rules.
 *
 * Deterministic from (config, seed), pure transitions, no network.
 * Maths questions are *generated* so the category never repeats itself and the
 * difficulty tiers differ by the actual arithmetic, not by question rarity.
 */
import { rng, shuffled, type Difficulty } from '../types';
import { BANK, type Category, type Question, type Tier } from './bank';

export type { Category, Question } from './bank';

export interface QuizConfig {
  categories: Category[];
  rounds: number;
  /** seconds allowed per question; 0 disables the timer */
  perQuestion: number;
}

export interface Asked {
  question: Question;
  /** display order of `question.a`; `order[i]` indexes into `question.a` */
  order: number[];
  /** index *into `order`* that the player picked, or null if time ran out */
  picked: number | null;
  rivalPicked: number | null;
  /** ms the player took */
  tookMs: number;
  points: number;
  rivalPoints: number;
}

export interface QuizState {
  config: QuizConfig;
  seed: number;
  queue: Question[];
  index: number;
  asked: Asked[];
  score: number;
  rivalScore: number;
  streak: number;
  bestStreak: number;
  over: boolean;
}

export const DEFAULT_CONFIG: QuizConfig = {
  categories: ['science', 'history', 'general', 'maths', 'geography', 'nature'],
  rounds: 10,
  perQuestion: 20,
};

/* ─────────────────────────── maths generator ─────────────────────────── */

const uniq = (correct: number, make: () => number): [string, string, string, string] => {
  const set = new Set<number>([correct]);
  let guard = 0;
  while (set.size < 4 && guard++ < 200) {
    const v = make();
    if (Number.isFinite(v)) set.add(v);
  }
  // deterministic fallback so we can never emit fewer than four options
  let pad = correct + 1;
  while (set.size < 4) set.add(pad++);
  const rest = [...set].filter((v) => v !== correct);
  return [String(correct), String(rest[0]), String(rest[1]), String(rest[2])];
};

/** A generated arithmetic question. Tier 1 is single digit, tier 3 is two-step. */
export function mathsQuestion(seed: number, tier: Tier): Question {
  const r = rng(seed);
  const pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)];
  const int = (lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
  const near = (v: number, spread: number) => () => v + (int(1, spread) * (r() < 0.5 ? -1 : 1));

  if (tier === 1) {
    const op = pick(['+', '−', '×'] as const);
    const a = int(2, 12), b = int(2, 12);
    const v = op === '+' ? a + b : op === '−' ? Math.max(a, b) - Math.min(a, b) : a * b;
    const q = op === '−' ? `${Math.max(a, b)} − ${Math.min(a, b)} = ?` : `${a} ${op} ${b} = ?`;
    return { q, a: uniq(v, near(v, op === '×' ? 12 : 6)), cat: 'maths', tier };
  }

  if (tier === 2) {
    const kind = pick(['pct', 'div', 'sq', 'frac'] as const);
    if (kind === 'pct') {
      const p = pick([10, 20, 25, 50, 75]); const n = int(2, 20) * 20;
      const v = (p / 100) * n;
      return { q: `What is ${p}% of ${n}?`, a: uniq(v, near(v, Math.max(2, Math.round(v * 0.4)))), cat: 'maths', tier,
        note: `${p}% of ${n} is ${v}.` };
    }
    if (kind === 'div') {
      const b = int(3, 12), v = int(3, 15);
      return { q: `${b * v} ÷ ${b} = ?`, a: uniq(v, near(v, 6)), cat: 'maths', tier };
    }
    if (kind === 'sq') {
      const a = int(4, 19);
      return { q: `What is ${a} squared?`, a: uniq(a * a, near(a * a, 24)), cat: 'maths', tier };
    }
    const d = pick([2, 3, 4, 5]); const n = int(2, 9) * d;
    return { q: `What is ${n} ÷ ${d}, written as a whole number?`, a: uniq(n / d, near(n / d, 5)), cat: 'maths', tier };
  }

  // tier 3 — two steps, the kind of thing you have to hold in your head
  const kind = pick(['chain', 'order', 'solve'] as const);
  if (kind === 'chain') {
    const a = int(3, 15), b = int(2, 9), c = int(2, 12);
    const v = a * b + c;
    return { q: `${a} × ${b} + ${c} = ?`, a: uniq(v, near(v, 14)), cat: 'maths', tier };
  }
  if (kind === 'order') {
    const a = int(2, 12), b = int(2, 9), c = int(2, 9);
    const v = a + b * c;
    return { q: `${a} + ${b} × ${c} = ?`, a: uniq(v, near(v, 12)), cat: 'maths', tier,
      note: 'Multiplication binds tighter than addition — do the × first.' };
  }
  const x = int(2, 15), m = int(2, 9), k = int(1, 20);
  return { q: `If ${m}x + ${k} = ${m * x + k}, what is x?`, a: uniq(x, near(x, 7)), cat: 'maths', tier };
}

/* ─────────────────────────── building a round ─────────────────────────── */

const TIER_MIX: Record<Difficulty, Tier[]> = {
  beginner: [1, 1, 1, 2],
  casual: [1, 1, 2, 2],
  intermediate: [1, 2, 2, 3],
  advanced: [2, 2, 3, 3],
  expert: [2, 3, 3, 3],
};

/** How often the AI rival answers correctly, and how fast. */
export const RIVAL: Record<Difficulty, { accuracy: number; minMs: number; maxMs: number }> = {
  beginner: { accuracy: 0.35, minMs: 5200, maxMs: 11000 },
  casual: { accuracy: 0.5, minMs: 4200, maxMs: 9000 },
  intermediate: { accuracy: 0.65, minMs: 3200, maxMs: 7500 },
  advanced: { accuracy: 0.8, minMs: 2400, maxMs: 6000 },
  expert: { accuracy: 0.92, minMs: 1600, maxMs: 4500 },
};

export function buildQueue(config: QuizConfig, difficulty: Difficulty, seed: number): Question[] {
  const r = rng(seed);
  const tiers = TIER_MIX[difficulty];
  const cats = config.categories.length ? config.categories : DEFAULT_CONFIG.categories;
  const wanted = Math.max(1, config.rounds);

  // pool of bank questions in the chosen categories, hardest-appropriate first
  const pool = shuffled(BANK.filter((q) => cats.includes(q.cat) && tiers.includes(q.tier)), seed);
  const relaxed = shuffled(BANK.filter((q) => cats.includes(q.cat)), seed ^ 0x9e37);

  const out: Question[] = [];
  const used = new Set<string>();
  const mathsOnly = cats.length === 1 && cats[0] === 'maths';

  for (let i = 0; i < wanted; i++) {
    const tier = tiers[Math.floor(r() * tiers.length)];
    const wantMaths = mathsOnly || (cats.includes('maths') && r() < 1 / cats.length);
    if (wantMaths) { out.push(mathsQuestion((seed ^ (i * 0x45d9f3b)) >>> 0, tier)); continue; }
    const next = pool.find((q) => !used.has(q.q)) ?? relaxed.find((q) => !used.has(q.q));
    if (next) { used.add(next.q); out.push(next); }
    // The written bank is finite. Rather than silently returning a short round
    // — which is what used to happen once the chosen topics ran dry — fall back
    // to a generated question so a 50-round game is still a 50-round game.
    else out.push(mathsQuestion((seed ^ (i * 0x45d9f3b)) >>> 0, tier));
  }
  return out;
}

export function createQuiz(config: QuizConfig, difficulty: Difficulty, seed: number): QuizState {
  const queue = buildQueue(config, difficulty, seed);
  return {
    config: { ...config, rounds: queue.length },
    seed, queue, index: 0, asked: [],
    score: 0, rivalScore: 0, streak: 0, bestStreak: 0,
    over: queue.length === 0,
  };
}

/** Option display order for the question at `index` — stable for a given seed. */
export function orderFor(state: QuizState, index: number): number[] {
  return shuffled([0, 1, 2, 3], (state.seed ^ ((index + 1) * 0x27d4eb2f)) >>> 0);
}

/**
 * Score: 100 for a correct answer, plus up to 60 for speed, plus a streak bonus.
 * Speed only counts when the question is timed — otherwise it would reward
 * nothing but a fast internet connection.
 */
export function scoreAnswer(correct: boolean, tookMs: number, limitSec: number, streak: number): number {
  if (!correct) return 0;
  const speed = limitSec > 0 ? Math.round(60 * Math.max(0, 1 - tookMs / (limitSec * 1000))) : 0;
  const bonus = Math.min(50, streak * 10);
  return 100 + speed + bonus;
}

export function answer(
  state: QuizState,
  pickedSlot: number | null,
  tookMs: number,
  rivalSlot: number | null,
): QuizState {
  if (state.over) return state;
  const question = state.queue[state.index];
  const order = orderFor(state, state.index);
  const correctSlot = order.indexOf(0);

  const right = pickedSlot !== null && pickedSlot === correctSlot;
  const rivalRight = rivalSlot !== null && rivalSlot === correctSlot;
  const streak = right ? state.streak + 1 : 0;

  const points = scoreAnswer(right, tookMs, state.config.perQuestion, state.streak);
  const rivalPoints = rivalRight ? 100 + Math.round(Math.random() * 50) + 10 : 0;

  const asked: Asked = { question, order, picked: pickedSlot, rivalPicked: rivalSlot, tookMs, points, rivalPoints };
  const index = state.index + 1;

  return {
    ...state,
    index,
    asked: [...state.asked, asked],
    score: state.score + points,
    rivalScore: state.rivalScore + rivalPoints,
    streak,
    bestStreak: Math.max(state.bestStreak, streak),
    over: index >= state.queue.length,
  };
}

/** Which option slot the AI picks, and after how long. Deterministic per round. */
export function rivalAnswer(state: QuizState, difficulty: Difficulty): { slot: number; afterMs: number } {
  const r = rng((state.seed ^ ((state.index + 7) * 0x85ebca6b)) >>> 0);
  const cfg = RIVAL[difficulty];
  const order = orderFor(state, state.index);
  const correctSlot = order.indexOf(0);
  const afterMs = Math.round(cfg.minMs + r() * (cfg.maxMs - cfg.minMs));
  if (r() < cfg.accuracy) return { slot: correctSlot, afterMs };
  const wrong = [0, 1, 2, 3].filter((s) => s !== correctSlot);
  return { slot: wrong[Math.floor(r() * wrong.length)], afterMs };
}

export const accuracyOf = (s: QuizState) => {
  if (!s.asked.length) return 0;
  const right = s.asked.filter((a) => a.picked !== null && a.order[a.picked] === 0).length;
  return right / s.asked.length;
};

export const correctCount = (s: QuizState) =>
  s.asked.filter((a) => a.picked !== null && a.order[a.picked] === 0).length;
