/**
 * Wild Eights — rules.
 *
 * Crazy Eights (public domain, also known as Switch or Mau Mau), implemented
 * properly: a real 52-card deck, a stock that reshuffles from the discard pile
 * when it runs dry, eights as wild cards that rename the suit, and an optional
 * action-card layer. Everything is pure and deterministic from (config, seed).
 *
 * Card encoding: 0–51, `suit = n / 13`, `rank = n % 13` with rank 0 = Ace.
 */
import { rng, shuffled, type Slot, type TurnGameRules } from '../types';

export const SUITS = ['hearts', 'diamonds', 'clubs', 'spades'] as const;
export type Suit = (typeof SUITS)[number];
export const SUIT_SYMBOL: Record<Suit, string> = { hearts: '♥', diamonds: '♦', clubs: '♣', spades: '♠' };
export const SUIT_RED: Record<Suit, boolean> = { hearts: true, diamonds: true, clubs: false, spades: false };
export const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'] as const;

export const suitOf = (card: number): Suit => SUITS[Math.floor(card / 13)];
export const rankOf = (card: number): number => card % 13;
export const rankLabel = (card: number): string => RANKS[rankOf(card)];
export const cardName = (card: number) => `${rankLabel(card)} of ${suitOf(card)}`;
/** Eights are rank index 7. */
export const isWild = (card: number) => rankOf(card) === 7;

/** Penalty points left in a losing hand — the traditional scoring. */
export function cardValue(card: number): number {
  const r = rankOf(card);
  if (r === 7) return 50;          // eight
  if (r >= 9) return 10;           // 10 J Q K
  if (r === 0) return 1;           // ace
  return r + 1;                    // 2–9 at face value
}

export interface EightsConfig {
  /** cards dealt to each player */
  handSize: number;
  /** 2 = draw two, J = skip a turn, A = reverse (acts as a skip with two players) */
  actionCards: boolean;
  /** how many cards you may draw before the turn passes */
  drawLimit: number;
}

export const DEFAULT_EIGHTS: EightsConfig = { handSize: 7, actionCards: true, drawLimit: 3 };

export interface EightsState {
  config: EightsConfig;
  seed: number;
  hands: [number[], number[]];
  stock: number[];
  discard: number[];
  /** the suit in force — differs from the top card's suit after a wild */
  suit: Suit;
  turn: Slot;
  /** cards drawn so far this turn */
  drawnThisTurn: number;
  /** pending draw penalty stacked by 2s */
  pendingDraw: number;
  /** set while the player who just played an eight chooses a suit */
  awaitingSuit: boolean;
  over: boolean;
  winner: Slot | null;
  reason: string;
  /** short log for the table feed */
  log: string[];
  /** suits a player visibly failed to follow — the AI's only legal memory */
  passedOn: [Suit[], Suit[]];
}

export const topCard = (s: EightsState) => s.discard[s.discard.length - 1];

export function createEights(config: EightsConfig, seed: number): EightsState {
  const deck = shuffled(Array.from({ length: 52 }, (_, i) => i), seed);
  const hands: [number[], number[]] = [[], []];
  const size = Math.max(3, Math.min(10, config.handSize));
  for (let i = 0; i < size; i++) { hands[0].push(deck.pop()!); hands[1].push(deck.pop()!); }

  // the starter may not be a wild — flip past any eight so the first turn is clean
  let starter = deck.pop()!;
  const buried: number[] = [];
  while (isWild(starter) && deck.length) { buried.push(starter); starter = deck.pop()!; }

  return {
    config: { ...config, handSize: size },
    seed,
    hands,
    stock: [...buried, ...deck],
    discard: [starter],
    suit: suitOf(starter),
    turn: 0,
    drawnThisTurn: 0,
    pendingDraw: 0,
    awaitingSuit: false,
    over: false, winner: null, reason: '',
    log: [`Table opens on the ${cardName(starter)}.`],
    passedOn: [[], []],
  };
}

/** A card is playable if it is an eight, matches the live suit, or matches the rank. */
export function canPlay(state: EightsState, card: number): boolean {
  if (state.over || state.awaitingSuit) return false;
  // while a draw penalty is live you may only answer it with another 2
  if (state.pendingDraw > 0) return state.config.actionCards && rankOf(card) === 1;
  if (isWild(card)) return true;
  return suitOf(card) === state.suit || rankOf(card) === rankOf(topCard(state));
}

export const playable = (s: EightsState, who: Slot): number[] => s.hands[who].filter((c) => canPlay(s, c));
export const mustDraw = (s: EightsState, who: Slot) => playable(s, who).length === 0;

/** Rebuild the stock from everything but the top discard. Keeps long games alive. */
function refill(state: EightsState): EightsState {
  if (state.stock.length > 0 || state.discard.length <= 1) return state;
  const top = state.discard[state.discard.length - 1];
  const rest = state.discard.slice(0, -1);
  return {
    ...state,
    stock: shuffled(rest, (state.seed ^ (state.discard.length * 0x9e3779b9)) >>> 0),
    discard: [top],
    log: [...state.log, 'Stock ran out — the pile was shuffled back in.'],
  };
}

/** Seat-neutral names. Both players receive the same log, so "you" is wrong here. */
export const SLOT_NAME: [string, string] = ['Volt', 'Spark'];
const nameFor = (who: Slot) => SLOT_NAME[who];

/**
 * Rewrite a broadcast log line for one reader. The engine always says
 * "Volt"/"Spark"; the view decides what those mean to the person looking.
 */
export function humanise(line: string, names: [string, string]): string {
  return line.split('Volt').join(names[0]).split('Spark').join(names[1]);
}

export function drawCard(state: EightsState, who: Slot): EightsState {
  if (state.over || state.turn !== who || state.awaitingSuit) return state;
  let s = refill(state);
  if (!s.stock.length) {
    // genuinely nothing left to draw: pass the turn rather than deadlock
    return { ...s, turn: (who === 0 ? 1 : 0) as Slot, drawnThisTurn: 0, log: [...s.log, 'No cards left to draw — turn passes.'] };
  }
  const card = s.stock[0];
  const hands: [number[], number[]] = [s.hands[0].slice(), s.hands[1].slice()];
  hands[who] = [...hands[who], card];
  return { ...s, stock: s.stock.slice(1), hands, drawnThisTurn: s.drawnThisTurn + 1 };
}

/** Take the stacked +2 penalty and lose the turn. */
export function takePenalty(state: EightsState, who: Slot): EightsState {
  if (state.over || state.turn !== who || state.pendingDraw <= 0) return state;
  let s = state;
  const n = s.pendingDraw;
  for (let i = 0; i < n; i++) {
    s = refill(s);
    if (!s.stock.length) break;
    const hands: [number[], number[]] = [s.hands[0].slice(), s.hands[1].slice()];
    hands[who] = [...hands[who], s.stock[0]];
    s = { ...s, stock: s.stock.slice(1), hands };
  }
  return {
    ...s, pendingDraw: 0, drawnThisTurn: 0,
    turn: (who === 0 ? 1 : 0) as Slot,
    log: [...s.log, `${nameFor(who)} picked up ${n}.`],
  };
}

export function pass(state: EightsState, who: Slot): EightsState {
  if (state.over || state.turn !== who || state.awaitingSuit) return state;
  if (playable(state, who).length > 0) return state;   // you may not pass on a playable hand
  const live = state.suit;
  const passedOn: [Suit[], Suit[]] = [state.passedOn[0].slice(), state.passedOn[1].slice()];
  if (!passedOn[who].includes(live)) passedOn[who].push(live);
  return {
    ...state, turn: (who === 0 ? 1 : 0) as Slot, drawnThisTurn: 0, passedOn,
    log: [...state.log, `${nameFor(who)} passed.`],
  };
}

export function playCard(state: EightsState, who: Slot, card: number): EightsState {
  if (state.over || state.turn !== who || state.awaitingSuit) return state;
  if (!state.hands[who].includes(card) || !canPlay(state, card)) return state;

  const hands: [number[], number[]] = [state.hands[0].slice(), state.hands[1].slice()];
  hands[who] = hands[who].filter((c) => c !== card);
  const opponent = (who === 0 ? 1 : 0) as Slot;

  let s: EightsState = {
    ...state,
    hands,
    discard: [...state.discard, card],
    suit: suitOf(card),
    drawnThisTurn: 0,
    log: [...state.log, `${nameFor(who)} played the ${cardName(card)}.`],
  };

  if (!hands[who].length) {
    const points = hands[opponent].reduce((t, c) => t + cardValue(c), 0);
    return {
      ...s, over: true, winner: who, awaitingSuit: false,
      reason: `${nameFor(who)} went out — ${points} points left in ${nameFor(opponent)}'s hand.`,
      log: [...s.log, `${nameFor(who)} went out.`],
    };
  }

  if (isWild(card)) return { ...s, awaitingSuit: true };

  if (s.config.actionCards) {
    const r = rankOf(card);
    if (r === 1) return { ...s, pendingDraw: s.pendingDraw + 2, turn: opponent };    // two
    if (r === 10 || r === 0) {                                                       // jack or ace
      return { ...s, turn: who, log: [...s.log, `${nameFor(opponent)} misses a turn.`] };
    }
  }
  return { ...s, turn: opponent };
}

export function chooseSuit(state: EightsState, who: Slot, suit: Suit): EightsState {
  if (!state.awaitingSuit || state.turn !== who) return state;
  return {
    ...state, suit, awaitingSuit: false,
    turn: (who === 0 ? 1 : 0) as Slot,
    log: [...state.log, `${nameFor(who)} called ${suit}.`],
  };
}

/** Hidden-information guard, mirroring the convention used by Memory and Battleship. */
export function redact(state: EightsState, forPlayer: Slot | 'spectator'): unknown {
  const hide = (h: number[]) => h.map(() => -1);
  if (forPlayer === 'spectator') return { ...state, hands: [hide(state.hands[0]), hide(state.hands[1])], stock: hide(state.stock) };
  const other = forPlayer === 0 ? 1 : 0;
  const hands: [number[], number[]] = [[], []];
  hands[forPlayer] = state.hands[forPlayer];
  hands[other] = hide(state.hands[other]);
  return { ...state, hands, stock: hide(state.stock) };
}

export const handValue = (hand: number[]) => hand.reduce((t, c) => t + cardValue(c), 0);

/** Sorted for display: by suit, then rank. Never changes play. */
export const sortHand = (hand: number[]) =>
  hand.slice().sort((a, b) => (Math.floor(a / 13) - Math.floor(b / 13)) || (rankOf(a) - rankOf(b)));

export function randomSeed() { return (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0; }
export { rng };

/* ══════════════════════════════════════════════════════════════════════════
 * Online adapter
 *
 * The same module the browser imports is imported directly by the relay, so
 * the server re-validates every action against these functions. The client is
 * never trusted: `isLegal` re-derives legality from the server's own state, and
 * `redact` strips the opponent's hand and the stock before any broadcast.
 * ══════════════════════════════════════════════════════════════════════════ */

export type EightsMove =
  | { type: 'play'; card: number }
  | { type: 'draw' }
  | { type: 'pass' }
  | { type: 'take' }
  | { type: 'suit'; suit: Suit };

const isSuit = (v: unknown): v is Suit => typeof v === 'string' && (SUITS as readonly string[]).includes(v);

export const eightsRules: TurnGameRules<EightsState, EightsMove> = {
  id: 'cards',

  createInitialState(config, seed) {
    return createEights(
      {
        handSize: Number(config.handSize ?? DEFAULT_EIGHTS.handSize),
        actionCards: config.actionCards === undefined ? DEFAULT_EIGHTS.actionCards : Boolean(config.actionCards),
        drawLimit: Number(config.drawLimit ?? DEFAULT_EIGHTS.drawLimit),
      },
      seed,
    );
  },

  currentPlayer: (s) => (s.over ? null : s.turn),

  legalMoves(s, p) {
    if (s.over || s.turn !== p) return [];
    if (s.awaitingSuit) return SUITS.map((suit) => ({ type: 'suit', suit }) as EightsMove);
    if (s.pendingDraw > 0) {
      const counters = s.hands[p].filter((c) => canPlay(s, c)).map((card) => ({ type: 'play', card }) as EightsMove);
      return [...counters, { type: 'take' }];
    }
    const plays = playable(s, p).map((card) => ({ type: 'play', card }) as EightsMove);
    if (plays.length) return plays;
    return s.drawnThisTurn < s.config.drawLimit && s.stock.length + s.discard.length > 1
      ? [{ type: 'draw' }]
      : [{ type: 'pass' }];
  },

  isLegal(s, p, move): move is EightsMove {
    const m = move as EightsMove;
    if (!m || typeof m !== 'object' || typeof m.type !== 'string') return false;
    if (s.over || s.turn !== p) return false;

    if (m.type === 'suit') return s.awaitingSuit && isSuit(m.suit);
    if (s.awaitingSuit) return false;                       // nothing else may happen mid-choice

    if (m.type === 'play') {
      return Number.isInteger(m.card) && m.card >= 0 && m.card < 52
        && s.hands[p].includes(m.card) && canPlay(s, m.card);
    }
    if (m.type === 'take') return s.pendingDraw > 0;
    if (s.pendingDraw > 0) return false;                    // must answer the penalty first
    if (m.type === 'draw') {
      return s.drawnThisTurn < s.config.drawLimit && s.stock.length + s.discard.length > 1;
    }
    if (m.type === 'pass') return playable(s, p).length === 0;
    return false;
  },

  applyMove(s, p, m) {
    switch (m.type) {
      case 'play': return playCard(s, p, m.card);
      case 'draw': return drawCard(s, p);
      case 'pass': return pass(s, p);
      case 'take': return takePenalty(s, p);
      case 'suit': return chooseSuit(s, p, m.suit);
    }
  },

  result(s) {
    return s.over && s.winner !== null
      ? { over: true, winner: s.winner, reason: s.reason }
      : s.over
        ? { over: true, winner: null, reason: s.reason || 'The deck ran out.' }
        : { over: false };
  },

  redact,

  describeMove(s, p, m) {
    const who = p === 0 ? 'Volt' : 'Spark';
    switch (m.type) {
      case 'play': return `${who} played the ${cardName(m.card)}`;
      case 'draw': return `${who} drew a card`;
      case 'pass': return `${who} passed`;
      case 'take': return `${who} picked up ${s.pendingDraw}`;
      case 'suit': return `${who} called ${m.suit}`;
    }
  },
};
