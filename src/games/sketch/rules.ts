import type { Outcome, Slot, TurnGameRules } from '../types';

/**
 * Guess & Draw — rules.
 *
 * One of you draws the word you were given, the other types guesses. It is the
 * first genuinely *simultaneous* drawing game here, so two things matter:
 *
 *  1. **The word is hidden information.** The guesser must never receive it, not
 *     in the state, not in a hint, not in the stroke data. `redact` strips the
 *     whole word bank and only hands the current word to the drawer (and to
 *     both once the round is revealed). Everything the guesser gets is a
 *     masked hint.
 *  2. **Strokes are moves, not a side channel.** They go through the same
 *     server-authoritative path as a chess move, which means the server owns
 *     the canvas and a client cannot draw on your screen out of turn. One op
 *     per finished stroke keeps the volume sane — this is not a per-pointer-event
 *     firehose.
 *
 * Coordinates are integers 0..1000 in both axes, so the drawing is resolution
 * independent and the payload stays small.
 */

export type Stroke = {
  /** flattened [x0,y0,x1,y1,...], ints 0..1000 */
  p: number[];
  /** palette index */
  c: number;
  /** brush width index */
  w: number;
};

export interface Guess {
  by: Slot;
  text: string;
  hit: boolean;
  at: number;
}

export type SketchPhase = 'draw' | 'reveal' | 'done';

export interface SketchState {
  rounds: number;
  round: number;
  drawer: Slot;
  /** the bank for the whole match — ALWAYS stripped by `redact` */
  words: string[];
  /** filled in by `redact`: the drawer's word, or everyone's once revealed */
  word: string | null;
  /** masked form, safe for anyone to see: "_ _ _ _ _" with spaces preserved */
  hint: string;
  strokes: Stroke[];
  guesses: Guess[];
  phase: SketchPhase;
  /** epoch ms when the current phase expires */
  endsAt: number;
  scores: [number, number];
  /** set during `reveal` so both clients can show what it was */
  solvedBy: Slot | null;
  seed: number;
  over: boolean;
  winner: Slot | null;
  reason: string;
}

export type SketchMove =
  | { t: 'stroke'; p: number[]; c: number; w: number }
  | { t: 'undo' }
  | { t: 'clear' }
  | { t: 'guess'; text: string }
  | { t: 'skip' }
  | { t: 'next' };

export const CANVAS_BG = '#fffdf7';
export const PALETTE = ['#5c4035', '#f2779a', '#ffb703', '#2f9c71', '#37a0d6', '#9b7ad6', '#e05a74', '#b08968', CANVAS_BG];
export const ERASER_COLOR_INDEX = 8;
export const BRUSHES = [3, 7, 14, 26];
export const DRAW_MS = 90_000;
export const REVEAL_MS = 6_000;
export const MAX_STROKES = 400;
export const MAX_POINTS = 260;      // per stroke, after the client's own thinning

/**
 * Drawable nouns only — nothing abstract, nothing that needs text to read.
 * Tiered so a longer match can ramp without ever being unguessable.
 */
export const WORD_BANK: readonly string[][] = [
  // easy — instantly recognisable silhouettes
  ['cat', 'house', 'tree', 'star', 'fish', 'sun', 'moon', 'boat', 'apple', 'key',
    'cup', 'hat', 'book', 'clock', 'heart', 'cloud', 'flower', 'door', 'shoe', 'ball',
    'bed', 'cake', 'eye', 'leaf', 'ring', 'snake', 'sock', 'spoon', 'train', 'bee'],
  // medium — needs a little composition
  ['umbrella', 'guitar', 'rainbow', 'rocket', 'castle', 'bridge', 'camera', 'ladder', 'candle', 'bicycle',
    'penguin', 'pizza', 'robot', 'window', 'balloon', 'butterfly', 'lighthouse', 'mountain', 'teapot', 'kite',
    'anchor', 'cactus', 'dragon', 'igloo', 'jellyfish', 'mushroom', 'octopus', 'sandcastle', 'snowman', 'windmill'],
  // harder — two ideas at once
  ['thunderstorm', 'treehouse', 'hot air balloon', 'ice cream cone', 'shooting star', 'picnic basket',
    'paper plane', 'message in a bottle', 'cup of tea', 'birthday cake', 'pair of glasses', 'bunch of grapes',
    'roller coaster', 'camp fire', 'flower pot', 'love letter', 'shopping cart', 'traffic light',
    'ferris wheel', 'waterfall', 'telescope', 'typewriter', 'hammock', 'lantern'],
];

/* ------------------------------------------------------------------ seeded rng */
function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Pick `n` distinct words, ramping difficulty across the match. */
export function pickWords(n: number, seed: number): string[] {
  const rnd = mulberry(seed);
  const used = new Set<string>();
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    // first third easy, last third hard
    const tier = n <= 2 ? 0 : Math.min(2, Math.floor((i / n) * 3));
    for (let tries = 0; tries < 60; tries++) {
      const pool = WORD_BANK[tier];
      const w = pool[Math.floor(rnd() * pool.length)];
      if (!used.has(w)) { used.add(w); out.push(w); break; }
    }
    if (out.length <= i) {
      // exhausted that tier (absurd round counts) — fall back to any unused word
      const all = WORD_BANK.flat().filter((w) => !used.has(w));
      const w = all.length ? all[Math.floor(rnd() * all.length)] : `word ${i + 1}`;
      used.add(w); out.push(w);
    }
  }
  return out;
}

/** "ice cream" -> "___ _____", preserving word breaks. Safe to show anyone. */
export function maskOf(word: string): string {
  return word.split(' ').map((w) => '_'.repeat(w.length)).join(' ');
}

/* ------------------------------------------------------------------ matching */
export function normalise(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]+/g, '').replace(/\s+/g, ' ').trim();
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length || !b.length) return Math.max(a.length, b.length);
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

/**
 * Is this guess the word? Exact after normalising, plus one typo of slack on
 * anything five characters or longer — losing a round to a missing letter is
 * miserable and adds nothing.
 */
export function isHit(guess: string, word: string): boolean {
  const g = normalise(guess), w = normalise(word);
  if (!g) return false;
  if (g === w) return true;
  if (w.length >= 5 && levenshtein(g, w) <= 1) return true;
  // allow dropping a leading article
  const bare = w.replace(/^(a|an|the|pair of|bunch of|cup of|message in a) /, '');
  return bare !== w && (g === bare || (bare.length >= 5 && levenshtein(g, bare) <= 1));
}

/** Points for a correct guess, scaled by how much of the round was left. */
export function pointsFor(msLeft: number): { guesser: number; drawer: number } {
  const frac = Math.max(0, Math.min(1, msLeft / DRAW_MS));
  const guesser = 5 + Math.round(frac * 10);     // 5..15
  return { guesser, drawer: 3 + Math.round(frac * 5) };  // 3..8
}

/* ------------------------------------------------------------------ rules */
function advance(s: SketchState, now: number): SketchState {
  const round = s.round + 1;
  if (round >= s.rounds) {
    const [a, b] = s.scores;
    return {
      ...s, phase: 'done', over: true, round: s.rounds - 1,
      winner: a === b ? null : a > b ? 0 : 1,
      reason: a === b ? 'Level pegging' : 'Most points after every round',
    };
  }
  return {
    ...s,
    round,
    drawer: (s.drawer === 0 ? 1 : 0) as Slot,
    strokes: [],
    guesses: [],
    phase: 'draw',
    endsAt: now + DRAW_MS,
    solvedBy: null,
    word: null,
    hint: maskOf(s.words[round]),
  };
}

export const sketchRules: TurnGameRules<SketchState, SketchMove> = {
  id: 'sketch',

  createInitialState(config, seed) {
    const rounds = Math.max(2, Math.min(12, Number(config?.rounds) || 6));
    const words = pickWords(rounds, seed);
    return {
      rounds, round: 0, drawer: 0, words, word: null, hint: maskOf(words[0]),
      strokes: [], guesses: [], phase: 'draw', endsAt: Date.now() + DRAW_MS,
      scores: [0, 0], solvedBy: null, seed,
      over: false, winner: null, reason: '',
    };
  },

  /** Simultaneous: the drawer draws while the guesser guesses. */
  currentPlayer: () => null,

  legalMoves: () => [],   // free-form input; nothing to enumerate for an AI

  isLegal(s, p, m): m is SketchMove {
    const mv = m as SketchMove;
    if (!mv || typeof mv !== 'object' || typeof mv.t !== 'string' || s.over) return false;
    const isDrawer = p === s.drawer;
    switch (mv.t) {
      case 'stroke': {
        if (!isDrawer || s.phase !== 'draw') return false;
        if (!Array.isArray(mv.p) || mv.p.length < 2 || mv.p.length % 2 !== 0) return false;
        if (mv.p.length / 2 > MAX_POINTS) return false;
        if (s.strokes.length >= MAX_STROKES) return false;
        if (!mv.p.every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1000)) return false;
        return Number.isInteger(mv.c) && mv.c >= 0 && mv.c < PALETTE.length
          && Number.isInteger(mv.w) && mv.w >= 0 && mv.w < BRUSHES.length;
      }
      case 'undo':
      case 'clear':
        return isDrawer && s.phase === 'draw' && s.strokes.length > 0;
      case 'skip':
        return isDrawer && s.phase === 'draw';
      case 'guess':
        return !isDrawer && s.phase === 'draw'
          && typeof mv.text === 'string' && normalise(mv.text).length > 0 && mv.text.length <= 64;
      case 'next':
        return s.phase === 'reveal';
      default:
        return false;
    }
  },

  applyMove(s, p, m) {
    const now = Date.now();
    switch (m.t) {
      case 'stroke':
        return { ...s, strokes: [...s.strokes, { p: m.p.map((n) => Math.round(n)), c: m.c, w: m.w }] };
      case 'undo':
        return { ...s, strokes: s.strokes.slice(0, -1) };
      case 'clear':
        return { ...s, strokes: [] };
      case 'skip':
        return { ...s, phase: 'reveal', endsAt: now + REVEAL_MS, solvedBy: null, word: s.words[s.round] };
      case 'guess': {
        const word = s.words[s.round];
        const hit = isHit(m.text, word);
        const guesses = [...s.guesses, { by: p, text: m.text.slice(0, 64), hit, at: now }].slice(-40);
        if (!hit) return { ...s, guesses };
        const pts = pointsFor(s.endsAt - now);
        const scores: [number, number] = [...s.scores] as [number, number];
        scores[p] += pts.guesser;
        scores[s.drawer] += pts.drawer;
        return { ...s, guesses, scores, phase: 'reveal', endsAt: now + REVEAL_MS, solvedBy: p, word };
      }
      case 'next':
        return advance(s, now);
      default:
        return s;
    }
  },

  /** Drives the round clock and the automatic roll into the next round. */
  tick(s, nowMs) {
    if (s.over || nowMs < s.endsAt) return s;
    if (s.phase === 'draw') {
      return { ...s, phase: 'reveal', endsAt: nowMs + REVEAL_MS, solvedBy: null, word: s.words[s.round] };
    }
    if (s.phase === 'reveal') return advance(s, nowMs);
    return s;
  },

  result(s): Outcome {
    return s.over ? { over: true, winner: s.winner, reason: s.reason } : { over: false };
  },

  /**
   * The guesser must not be able to read the answer out of the payload. The
   * whole bank goes, and `word` is only populated for the drawer — or for
   * everyone once the round is over and it no longer matters.
   */
  redact(s, forPlayer) {
    const revealed = s.phase !== 'draw';
    const isDrawer = forPlayer === s.drawer;
    return {
      ...s,
      words: [],
      word: revealed || isDrawer ? s.words[s.round] ?? null : null,
      hint: maskOf(s.words[s.round] ?? ''),
    };
  },

  describeMove(s, p, m) {
    switch (m.t) {
      case 'stroke': return m.c === ERASER_COLOR_INDEX ? 'erased a stroke' : 'drew a stroke';
      case 'undo': return 'undid a stroke';
      case 'clear': return 'cleared the canvas';
      case 'skip': return 'gave up on the word';
      case 'guess': return isHit(m.text, s.words[s.round]) ? `guessed it: ${m.text}` : `guessed "${m.text}"`;
      case 'next': return 'moved to the next round';
      default: return '';
    }
  },
};
