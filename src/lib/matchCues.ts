import { useEffect, useRef } from 'react';
import type { Cue } from './audio';

/**
 * Voices an online match.
 *
 * Sound used to live only in the solo views, so every Play Together match was
 * nearly silent: the shared board components are what a room renders, and four
 * of them (tic-tac-toe, Four in a Row, Spark Quiz, Wild Eights) never made a sound
 * at all. Rather than scatter `sfx()` through ten board files — and risk
 * double-firing wherever a solo view already emits the same cue — this hook
 * diffs successive match states in the one place that sees all nine games.
 *
 * It reads defensively. The relay redacts hidden information (an opponent's
 * hand, the unasked quiz questions, un-flipped memory cards), so a field may be
 * absent or a different shape than the solo state. Anything unreadable just
 * produces no cue instead of throwing inside a render.
 */

type Any = Record<string, unknown>;
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** Per-game snapshot of just the numbers we compare between renders. */
export interface Snap {
  moves: number;        // generic "a turn happened" counter
  secondary: number;    // captures / matches / discards — whatever is game-specific
  tertiary: number;     // kings, drawn cards, score
  tag: string;          // a string signal: phase, last shot, last SAN
}

function snapshot(gameId: string, s: Any | null | undefined): Snap | null {
  if (!s || typeof s !== 'object') return null;
  switch (gameId) {
    case 'tictactoe':
      return { moves: arr(s.moves).length, secondary: 0, tertiary: 0, tag: '' };
    case 'connect4':
      return { moves: arr(s.history).length, secondary: 0, tertiary: 0, tag: '' };
    case 'memory':
      return {
        moves: arr(s.revealed).length,
        secondary: arr(s.matched).length,
        tertiary: num(s.moves),
        tag: str(s.lastResult),
      };
    case 'chess': {
      const pgn = arr(s.pgnMoves) as string[];
      return { moves: pgn.length, secondary: 0, tertiary: 0, tag: str(pgn[pgn.length - 1]) };
    }
    case 'checkers': {
      // board is a flat array of pieces; 0/null means empty
      const board = arr(s.board);
      const men = board.filter((p) => !!p).length;
      const kings = board.filter((p) => typeof p === 'number' && Math.abs(p) > 1).length;
      return { moves: arr(s.history).length, secondary: men, tertiary: kings, tag: '' };
    }
    case 'battleship': {
      const ls = s.lastShot as Any | null;
      const tag = ls ? `${num(ls.cell)}:${ls.hit ? 'h' : 'm'}:${str(ls.sunk)}` : '';
      const ready = arr(s.ready).filter(Boolean).length;
      return { moves: 0, secondary: ready, tertiary: 0, tag: `${str(s.phase)}|${tag}` };
    }
    case 'reaction': {
      const resp = arr(s.responses).filter((r) => r !== null).length;
      const fs = arr(s.falseStart).filter(Boolean).length;
      return { moves: resp, secondary: fs, tertiary: num(s.round), tag: str(s.phase) };
    }
    case 'cards':
      return {
        moves: arr(s.discard).length,
        secondary: 0,                       // filled in by the caller (needs youSlot)
        tertiary: num(s.pendingDraw),
        tag: s.awaitingSuit ? 'suit' : str(s.suit),
      };
    case 'sketch':
      return {
        moves: arr(s.strokes).length,
        secondary: arr(s.guesses).length,
        tertiary: num(arr(s.scores)[0]) + num(arr(s.scores)[1]),
        tag: `${str(s.phase)}:${num(s.round)}`,
      };
    case 'reversi':
      return { moves: arr(s.history).length, secondary: num(arr(s.counts)[0]) + num(arr(s.counts)[1]), tertiary: 0, tag: '' };
    case 'gomoku':
      return { moves: arr(s.history).length, secondary: 0, tertiary: 0, tag: '' };
    case 'dots':
      return { moves: arr(s.history).length, secondary: num(arr(s.scores)[0]) + num(arr(s.scores)[1]), tertiary: num(s.lastGain), tag: '' };
    case 'mancala': {
      const board = arr(s.board) as number[];
      const pits = num(s.pits);
      return {
        moves: arr(s.history).length,
        secondary: num(board[pits]) + num(board[pits * 2 + 1]),
        tertiary: num(s.lastCapture),
        tag: '',
      };
    }
    case 'ludo': {
      const ev = s.event as Any | null;
      const kind = ev ? `${str(ev.kind)}:${num(ev.token)}` : '';
      return { moves: num(s.moves), secondary: 0, tertiary: 0, tag: `${s.dice ?? ''}|${kind}` };
    }
    case 'bingo': {
      const marks = arr(s.marks);
      const stamped = marks.reduce<number>((n, m) => n + arr(m).filter(Boolean).length, 0);
      const lines = arr(s.lines).reduce<number>((n, v) => n + num(v), 0);
      return { moves: arr(s.drawn).length, secondary: stamped, tertiary: lines, tag: '' };
    }
    case 'trivia':
      return {
        moves: num(s.index) || arr(s.asked).length,
        secondary: num(s.score) + num(s.rivalScore),
        tertiary: num(s.streak),
        tag: '',
      };
    default:
      return null;
  }
}

/** My own hand size, which the relay only ever sends for my seat. */
function myHand(s: Any | null | undefined, slot: 0 | 1): number {
  const hands = arr(s?.hands);
  const mine = hands[slot];
  return Array.isArray(mine) ? mine.length : 0;
}

/**
 * Which cues a state change deserves.
 *
 * Pure and exported so it can be tested without a renderer — the hook below only
 * decides *when* to call it and how to space the result.
 */
export function diffCues(
  gameId: string,
  before: Snap,
  now: Snap,
  hand: number,
  handBefore: number,
): Cue[] {
  const fire: Cue[] = [];
  switch (gameId) {
    case 'tictactoe':
      if (now.moves > before.moves) fire.push('place');
      break;
    case 'connect4':
      if (now.moves > before.moves) fire.push('drop');
      break;
    case 'memory':
      if (now.moves > before.moves) fire.push('flip');
      if (now.secondary > before.secondary) fire.push('coin');
      else if (now.tag === 'miss' && before.tag !== 'miss') fire.push('miss');
      break;
    case 'chess':
      if (now.moves > before.moves) {
        const san = now.tag;
        if (/[+#]/.test(san)) fire.push('check');
        else if (san.includes('x')) fire.push('capture');
        else fire.push('move');
      }
      break;
    case 'checkers':
      if (now.moves > before.moves) {
        fire.push(now.secondary < before.secondary ? 'capture' : 'move');
        if (now.tertiary > before.tertiary) fire.push('power');   // crowned
      }
      break;
    case 'battleship': {
      if (now.tag !== before.tag) {
        const shot = now.tag.split('|')[1] ?? '';
        if (shot) {
          const [, hm, sunk] = shot.split(':');
          if (sunk) fire.push('sunk');
          else if (hm === 'h') fire.push('hit');
          else fire.push('miss');
        }
      }
      if (now.secondary > before.secondary && now.secondary === 2) fire.push('go');
      break;
    }
    case 'reaction':
      if (now.tag !== before.tag) {
        if (now.tag === 'signal') fire.push('go');
        else if (now.tag === 'countdown') fire.push('countdown');
      }
      if (now.secondary > before.secondary) fire.push('error');      // false start
      else if (now.moves > before.moves) fire.push('hit');           // someone pressed
      break;
    case 'cards':
      if (now.moves > before.moves) fire.push('drop');               // a card hit the pile
      if (hand > handBefore && handBefore >= 0) fire.push('pickup'); // I drew
      if (now.tag === 'suit' && before.tag !== 'suit') fire.push('spark');
      break;
    case 'sketch': {
      // strokes are far too frequent to voice — only the events that matter
      if (now.tertiary > before.tertiary) fire.push('coin');         // someone guessed it
      else if (now.secondary > before.secondary) fire.push('flip');  // a wrong guess landed
      if (now.tag !== before.tag) {
        const [phase] = now.tag.split(':');
        const [wasPhase] = before.tag.split(':');
        if (phase === 'draw' && wasPhase === 'reveal') fire.push('go');   // next round
        else if (phase === 'reveal' && now.tertiary === before.tertiary) fire.push('miss');
      }
      break;
    }
    case 'reversi':
      if (now.moves > before.moves) fire.push('flip');
      break;
    case 'gomoku':
      if (now.moves > before.moves) fire.push('place');
      break;
    case 'dots':
      if (now.moves > before.moves) fire.push(now.secondary > before.secondary ? 'coin' : 'move');
      break;
    case 'mancala':
      if (now.tertiary > before.tertiary) fire.push('capture');
      else if (now.moves > before.moves) fire.push(now.secondary > before.secondary ? 'coin' : 'place');
      break;
    case 'ludo': {
      /* a roll and a move arrive as separate states, so both cues can breathe */
      const [dice, kind] = now.tag.split('|');
      const [wasDice, wasKind] = before.tag.split('|');
      if (dice !== wasDice && dice !== '') fire.push('die');
      if (kind !== wasKind) {
        const k = kind.split(':')[0];
        if (k === 'capture') fire.push('capture');
        else if (k === 'home' || k === 'out') fire.push('coin');
        else if (k === 'burn') fire.push('error');
        else if (k === 'move' || k === 'six') fire.push('hop');
        else if (k === 'pass') fire.push('cue');       // nothing to move: a soft tick
      }
      break;
    }
    case 'bingo':
      if (now.tertiary > before.tertiary) fire.push('coin');         // a line landed
      else if (now.moves > before.moves) fire.push('flip');          // a ball was called
      break;
    case 'trivia':
      if (now.moves > before.moves) fire.push('flip');               // next question
      else if (now.secondary > before.secondary) fire.push('coin');  // someone scored
      break;
  }
  return fire;
}

export function useMatchCues(
  gameId: string | undefined,
  state: unknown,
  slot: 0 | 1,
  sfx: (c: Cue) => void,
) {
  const prev = useRef<Snap | null>(null);
  const prevHand = useRef<number>(-1);
  const prevGame = useRef<string | undefined>(undefined);

  useEffect(() => {
    const s = state as Any | null;
    const now = snapshot(gameId ?? '', s);

    // a new game (or a rematch resetting the board) re-baselines instead of
    // firing a burst of cues for the difference
    if (gameId !== prevGame.current) {
      prevGame.current = gameId;
      prev.current = now;
      prevHand.current = myHand(s, slot);
      return;
    }
    const before = prev.current;
    prev.current = now;
    const hand = myHand(s, slot);
    const handBefore = prevHand.current;
    prevHand.current = hand;
    if (!now || !before) return;

    // a reset (rematch) runs the counters backwards — never sound on that
    if (now.moves < before.moves || now.secondary < before.secondary) return;

    const fire = diffCues(gameId ?? '', before, now, hand, handBefore);
    // at most two cues per state change; a pile-up just sounds like a glitch
    fire.slice(0, 2).forEach((c, i) => {
      if (i === 0) sfx(c);
      else setTimeout(() => sfx(c), 140);
    });
  }, [gameId, state, slot, sfx]);
}
