/**
 * Word Bomb — a word chain with a fuse.
 *
 * A letter is lit. You answer with a word that starts with it; the *last* letter
 * of your word becomes the next light, and the bomb passes to the other side.
 * Miss the clock and you take a strike. Two strikes and it goes off.
 *
 * Design notes that matter:
 *   • the clock belongs to the server (`tick`), never to the client, so a slow
 *     tab or a paused laptop cannot buy anybody time;
 *   • a wrong word costs you nothing but the second it took — the bomb only
 *     explodes on silence. That keeps the game friendly and makes typing mistakes
 *     cheap;
 *   • the referee validates *shape*, not vocabulary (see `words.ts`). Both
 *     players are told this in the rules card rather than being quietly marked
 *     down for a word the arcade has never heard of.
 */
import type { Outcome, Slot, TurnGameRules } from '../types';
import { openingLetter, nextLetter, wordsStartingWith } from './words';

export interface WbConfig {
  /** ms per turn */
  turnMs: number;
  /** strikes allowed before the bomb goes off */
  strikes: number;
  /** total turns in a match — the second way a game can end */
  rounds: number;
}

export interface WbPlay {
  seat: Slot;
  /** null when the turn was burnt on the clock */
  word: string | null;
  letter: string;
  /** score after the turn */
  score: [number, number];
}

export interface WbState {
  config: WbConfig;
  seed: number;
  letter: string;
  turn: Slot;
  used: string[];
  score: [number, number];
  strikes: [number, number];
  phase: 'play' | 'done';
  turnEndsAt: number;
  history: WbPlay[];
  over: boolean;
  winner: Slot | null;
  reason: string;
}

export type WbMove = { type: 'word'; word: string };

export const DEFAULT_WB: WbConfig = { turnMs: 20_000, strikes: 2, rounds: 12 };

export const WORD_RE = /^[a-z]{3,20}$/;

/** The shape check, in one place so the UI can preview it and the server can
    enforce it without the two drifting apart. */
export function checkWord(state: WbState, raw: unknown): { ok: true; word: string } | { ok: false; why: string } {
  if (typeof raw !== 'string') return { ok: false, why: 'Type a word first.' };
  const word = raw.trim().toLowerCase();
  if (!word) return { ok: false, why: 'Type a word first.' };
  if (!WORD_RE.test(word)) return { ok: false, why: 'Letters only, three or more of them.' };
  if (word[0] !== state.letter) return { ok: false, why: `It has to start with “${state.letter.toUpperCase()}”.` };
  if (state.used.includes(word)) return { ok: false, why: 'That one has already been played.' };
  return { ok: true, word };
}

function finish(s: WbState, note = ''): WbState {
  const [a, b] = s.score;
  let winner: Slot | null;
  if (a !== b) winner = a > b ? 0 : 1;
  else if (s.strikes[0] !== s.strikes[1]) winner = s.strikes[0] < s.strikes[1] ? 0 : 1;
  else winner = null;
  const reason = winner === null
    ? `Level at ${a} each${note ? ` — ${note}` : ''}.`
    : `${winner === 0 ? 'Volt' : 'Spark'} wins it ${Math.max(a, b)} to ${Math.min(a, b)}${note ? ` — ${note}` : ''}.`;
  return { ...s, phase: 'done', over: true, winner, reason };
}

/**
 * Passing the bomb on after a turn.
 *
 * `letter` is passed in rather than derived, because the two ways a turn can end
 * want different things: a played word hands the *last letter of that word* on
 * (that is the chain, and the whole game), while a burnt turn resets to a fresh
 * answerable letter so the next player is not handed an impossible prompt.
 */
function passTurn(s: WbState, nextTurn: Slot, now: number, letter: string): WbState {
  return { ...s, turn: nextTurn, letter, turnEndsAt: now + s.config.turnMs };
}

export const wordBombRules: TurnGameRules<WbState, WbMove> = {
  id: 'wordbomb',

  createInitialState(config, seed) {
    const cfg: WbConfig = {
      turnMs: Math.max(8000, Math.min(60_000, Number(config.turnMs ?? DEFAULT_WB.turnMs))),
      strikes: Math.max(1, Math.min(4, Number(config.strikes ?? DEFAULT_WB.strikes))),
      rounds: Math.max(4, Math.min(40, Number(config.rounds ?? DEFAULT_WB.rounds))),
    };
    return {
      config: cfg, seed,
      letter: openingLetter(seed),
      turn: 0,
      used: [], score: [0, 0], strikes: [0, 0],
      phase: 'play', turnEndsAt: Date.now() + cfg.turnMs,
      history: [], over: false, winner: null, reason: '',
    };
  },

  currentPlayer: (s) => (s.over || s.phase === 'done' ? null : s.turn),

  /**
   * Free text cannot be enumerated in full, so this lists the *known* words that
   * are legal right now. Anything of the right shape is equally legal — the UI
   * takes typed input — but an enumerable move list keeps the referee honest for
   * tests, hints and the AI, which all drive the game through this list.
   */
  legalMoves(s, p) {
    if (s.over || s.phase !== 'play' || s.turn !== p) return [];
    return wordsStartingWith(s.letter)
      .filter((w) => !s.used.includes(w))
      .map((w) => ({ type: 'word', word: w }) as WbMove);
  },

  isLegal(s, p, move): move is WbMove {
    const m = move as WbMove;
    if (!m || typeof m !== 'object' || m.type !== 'word') return false;
    if (s.over || s.phase !== 'play' || s.turn !== p) return false;
    return checkWord(s, m.word).ok;
  },

  applyMove(s, p, m) {
    if (!this.isLegal(s, p, m)) return s;
    const { word } = checkWord(s, m.word) as { ok: true; word: string };
    const now = Date.now();
    const score: [number, number] = [s.score[0], s.score[1]];
    score[p] += 1;
    const next: WbState = {
      ...s,
      used: [...s.used, word],
      score,
      history: [...s.history, { seat: p, word, letter: s.letter, score }],
    };
    // a match can simply run out of turns — the fuse is a way to lose, not the
    // only way to finish
    if (next.history.length >= next.config.rounds) return finish(next, 'every turn played');
    return passTurn(next, (p === 0 ? 1 : 0) as Slot, now, word[word.length - 1]);
  },

  result: (s): Outcome => (s.over ? { over: true, winner: s.winner, reason: s.reason } : { over: false }),

  tick(s, now) {
    if (s.over || s.phase !== 'play') return s;
    if (now < s.turnEndsAt) return s;
    const strikes: [number, number] = [s.strikes[0], s.strikes[1]];
    strikes[s.turn] += 1;
    const burnt: WbState = {
      ...s,
      strikes,
      history: [...s.history, { seat: s.turn, word: null, letter: s.letter, score: [s.score[0], s.score[1]] }],
    };
    if (strikes[s.turn] >= s.config.strikes) {
      // the bomb goes off: whoever is holding it loses, whatever the score says
      const winner = (s.turn === 0 ? 1 : 0) as Slot;
      return {
        ...burnt, phase: 'done', over: true, winner,
        reason: `${s.turn === 0 ? 'Volt' : 'Spark'} held the bomb too long — ${burnt.score[winner]} to ${burnt.score[s.turn]}.`,
      };
    }
    if (burnt.history.length >= burnt.config.rounds) return finish(burnt, 'the fuse ran out with the scores level');
    // a fresh, answerable letter — never the one that just beat the player
    return passTurn(burnt, (s.turn === 0 ? 1 : 0) as Slot, now, nextLetter(burnt.seed, burnt.history.length, s.letter));
  },

  /** Nothing is secret in this game — the chain is public — but the deadline is
      recomputed from the server's clock by every client, so it is sent as-is. */
  describeMove(s, p, m) {
    const w = (m as WbMove).word;
    return `${p === 0 ? 'Volt' : 'Spark'} played “${w}”`;
  },
};

