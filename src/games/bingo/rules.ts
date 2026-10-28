import type { Outcome, Slot, TurnGameRules } from '../types';
import { rng } from '../types';

/**
 * Bingo, played as a duel rather than as a hall game.
 *
 * The problem with bingo as a game for two is that it is not one: if the balls
 * are simply called in order, nobody at the table makes a decision and the whole
 * thing is a coin toss with extra steps. So the turn is a *choice* —
 *
 *   the player on turn is shown the next two balls and calls exactly one.
 *
 * Both cards are marked automatically with whatever is called, so calling a ball
 * that suits you is also calling a ball that may suit them. That single rule is
 * what turns luck into a decision: you are always weighing "does this finish my
 * row?" against "what does it hand over?".
 *
 * The unpicked ball goes to the back of the drum rather than being discarded, so
 * the drum still contains every ball that has not been called and the game is
 * bounded — one ball leaves the drum per turn, and a card of 24 numbers cannot
 * survive all 75 of them.
 *
 * Standard cards: five columns B I N G O drawn from 1–15, 16–30, 31–45, 46–60
 * and 61–75, with the centre square of the N column free. Cards are dealt from
 * the server's seed, so the same room always produces the same two cards, and a
 * reload cannot reshuffle them.
 */

export const CARD_COLS = 5;
export const CARD_ROWS = 5;
export const CARD_SIZE = CARD_COLS * CARD_ROWS;
export const FREE_INDEX = 12; // centre of the N column
export const BALLS = 75;
export const LETTERS = ['B', 'I', 'N', 'G', 'O'] as const;

/** `37 → N37`, the way a caller would say it. */
export function ballLabel(ball: number): string {
  const i = Math.min(LETTERS.length - 1, Math.max(0, Math.floor((ball - 1) / 15)));
  return `${LETTERS[i]}${ball}`;
}

/** Which column of a card a ball can appear in. */
export const ballColumn = (ball: number) => Math.min(4, Math.max(0, Math.floor((ball - 1) / 15)));

export interface BingoCard {
  /** 25 numbers, row-major; the free centre is 0 (never a real ball) */
  numbers: number[];
}

export interface BingoState {
  cards: [BingoCard, BingoCard];
  /** which numbers each seat has marked — the free square starts marked */
  marks: [boolean[], boolean[]];
  /** balls still in the drum, front first: the offer is the first two */
  pool: number[];
  /** every ball called so far, in order */
  drawn: number[];
  turn: Slot;
  /** completed lines per seat, always available for the HUD */
  lines: [number, number];
  pattern: 'line' | 'full';
  lastCall: { ball: number; by: Slot } | null;
  /** the seat that completed a line on a shared ball is recorded here */
  claim: Slot | null;
  over: boolean;
  winner: Slot | null;
  reason: string;
}

export type BingoMove = { type: 'pick'; index: number };

/* ------------------------------------------------------------------ cards */

function shuffle<T>(items: T[], random: () => number): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** A standard 5×5 card, free centre. Same seed ⇒ same card, always. */
export function dealCard(seed: number): BingoCard {
  const random = rng(seed >>> 0);
  const numbers: number[] = new Array(CARD_SIZE).fill(0);
  for (let col = 0; col < CARD_COLS; col++) {
    const range: number[] = [];
    for (let n = col * 15 + 1; n <= col * 15 + 15; n++) range.push(n);
    const column = shuffle(range, random).slice(0, CARD_ROWS);
    for (let row = 0; row < CARD_ROWS; row++) numbers[row * CARD_COLS + col] = column[row];
  }
  numbers[FREE_INDEX] = 0;
  return { numbers };
}

const sameCard = (a: BingoCard, b: BingoCard) => a.numbers.every((n, i) => n === b.numbers[i]);

export function dealCards(seed: number): [BingoCard, BingoCard] {
  // Math.imul keeps the two derived seeds inside int32, so the client and the
  // relay derive byte-identical cards instead of relying on float rounding.
  const first = dealCard(Math.imul(seed >>> 0, 0x9e3779b1) + 1);
  const base = Math.imul(seed >>> 0, 0x85ebca6b) + 7;
  let second = dealCard(base);
  // Two identical cards would be a flat game and, worse, an unfair one: the
  // second player would win every tie. Bump the seed until they differ.
  for (let guard = 0; sameCard(first, second) && guard < 16; guard++) second = dealCard(base + guard + 1);
  return [first, second];
}

/** The eight lines that end a "line" game, as index lists. */
export const LINES: number[][] = (() => {
  const out: number[][] = [];
  for (let r = 0; r < CARD_ROWS; r++) out.push(Array.from({ length: CARD_COLS }, (_, c) => r * CARD_COLS + c));
  for (let c = 0; c < CARD_COLS; c++) out.push(Array.from({ length: CARD_ROWS }, (_, r) => r * CARD_COLS + c));
  out.push(Array.from({ length: CARD_COLS }, (_, i) => i * CARD_COLS + i));
  out.push(Array.from({ length: CARD_COLS }, (_, i) => i * CARD_COLS + (CARD_COLS - 1 - i)));
  return out;
})();

/** How many of the eight lines are complete. */
export function countLines(marks: boolean[]): number {
  return LINES.reduce((n, line) => n + (line.every((i) => marks[i]) ? 1 : 0), 0);
}

/** True when the card needs no more balls. */
export const isFull = (marks: boolean[]) => marks.every(Boolean);

const startMarks = (card: BingoCard): boolean[] =>
  card.numbers.map((n) => n === 0); // only the free centre

function markBall(marks: boolean[], card: BingoCard, ball: number): boolean[] {
  const next = marks.slice();
  for (let i = 0; i < CARD_SIZE; i++) if (card.numbers[i] === ball) next[i] = true;
  return next;
}

const other = (slot: Slot): Slot => (slot === 0 ? 1 : 0);

/* ------------------------------------------------------------------ referee */

/** The one legality check, shared by `isLegal` and `applyMove` so the two can
 *  never disagree about what a well-formed pick is. */
function legalPick(s: BingoState, player: Slot, move: unknown): move is BingoMove {
  if (!move || typeof move !== 'object') return false;
  const m = move as BingoMove;
  if (m.type !== 'pick') return false;
  if (!Number.isInteger(m.index) || m.index < 0) return false;
  if (s.over || s.pool.length === 0) return false;
  if (player !== s.turn) return false;
  return m.index < Math.min(2, s.pool.length);
}

export const bingoRules: TurnGameRules<BingoState, BingoMove> = {
  id: 'bingo',

  createInitialState(config, seed) {
    const pattern = config.pattern === 'full' ? 'full' : 'line';
    const cards = dealCards(seed >>> 0);
    const marks: [boolean[], boolean[]] = [startMarks(cards[0]), startMarks(cards[1])];
    const pool = shuffle(Array.from({ length: BALLS }, (_, i) => i + 1), rng((seed ^ 0x5f3759df) >>> 0));
    return {
      cards, marks, pool, drawn: [], turn: 0, lines: [0, 0],
      pattern, lastCall: null, claim: null, over: false, winner: null, reason: '',
    };
  },

  currentPlayer: (s) => (s.over || s.pool.length === 0 ? null : s.turn),

  legalMoves(s, player) {
    if (s.over || s.pool.length === 0 || player !== s.turn) return [];
    return s.pool.slice(0, 2).map((_, index) => ({ type: 'pick' as const, index }));
  },

  isLegal(s, player, move): move is BingoMove {
    return legalPick(s, player, move);
  },

  applyMove(s, player, move) {
    if (!legalPick(s, player, move)) return s;
    const picked = move as BingoMove;
    const ball = s.pool[picked.index];
    const pool = s.pool.slice();
    pool.splice(picked.index, 1);

    const marks: [boolean[], boolean[]] = [
      markBall(s.marks[0], s.cards[0], ball),
      markBall(s.marks[1], s.cards[1], ball),
    ];
    const lines: [number, number] = [countLines(marks[0]), countLines(marks[1])];
    const done = (seat: Slot) => (s.pattern === 'full' ? isFull(marks[seat]) : lines[seat] > 0);

    const next: BingoState = {
      ...s,
      pool,
      marks,
      lines,
      drawn: [...s.drawn, ball],
      turn: other(player),
      lastCall: { ball, by: player },
    };

    /* Both cards can complete on the same ball. The player who called it wins
       that tie, because they chose the ball and they own the risk of the offer. */
    if (done(player)) {
      return {
        ...next, over: true, winner: player, claim: player,
        reason: s.pattern === 'full' ? `filled the whole card on ${ballLabel(ball)}` : `${ballLabel(ball)} completed a line`,
      };
    }
    if (done(other(player))) {
      return {
        ...next, over: true, winner: other(player), claim: other(player),
        reason: `${ballLabel(ball)} was called and it finished their line`,
      };
    }
    if (pool.length === 0) {
      return { ...next, over: true, winner: null, reason: 'the drum ran dry' };
    }
    return next;
  },

  result: (s): Outcome => (s.over ? { over: true, winner: s.winner, reason: s.reason } : { over: false }),

  describeMove(s, player, move) {
    const ball = s.pool[move.index];
    if (!ball) return 'waited';
    return `${player === s.turn ? 'called' : 'chose'} ${ballLabel(ball)}`;
  },
};

/** Numbers still to be called, for a "remaining" counter in the HUD. */
export const ballsLeft = (s: BingoState) => s.pool.length;

/** The two balls currently on offer — `[]` when the drum is empty or the game is over. */
export const offer = (s: BingoState): number[] => (s.over ? [] : s.pool.slice(0, 2));
