import type { Slot, TurnGameRules, Outcome } from '../types';
import { shuffled } from '../types';

/** Stable asset identities — every card maps to one of these, never a random image. */
export const VOLT_CARDS = [
  { id: 'bolt',    name: 'Thunder Bolt',  hue: 48,  glyph: 'bolt' },
  { id: 'cheek',   name: 'Spark Cheek',   hue: 4,   glyph: 'circle' },
  { id: 'tail',    name: 'Zig Tail',      hue: 42,  glyph: 'tail' },
  { id: 'berry',   name: 'Volt Berry',    hue: 340, glyph: 'berry' },
  { id: 'coil',    name: 'Storm Coil',    hue: 196, glyph: 'coil' },
  { id: 'star',    name: 'Static Star',   hue: 56,  glyph: 'star' },
  { id: 'orb',     name: 'Charge Orb',    hue: 268, glyph: 'orb' },
  { id: 'leaf',    name: 'Grass Tuft',    hue: 132, glyph: 'leaf' },
  { id: 'cloud',   name: 'Thunder Cloud', hue: 215, glyph: 'cloud' },
  { id: 'gear',    name: 'Arc Gear',      hue: 28,  glyph: 'gear' },
  { id: 'feather', name: 'Sky Feather',   hue: 180, glyph: 'feather' },
  { id: 'ember',   name: 'Ember Mote',    hue: 14,  glyph: 'ember' },
  { id: 'moon',    name: 'Night Moon',    hue: 240, glyph: 'moon' },
  { id: 'shell',   name: 'Tide Shell',    hue: 160, glyph: 'shell' },
  { id: 'crown',   name: 'Champion Crown',hue: 36,  glyph: 'crown' },
  { id: 'ball',    name: 'Arena Ball',    hue: 0,   glyph: 'ball' },
  { id: 'rune',    name: 'Volt Rune',     hue: 88,  glyph: 'rune' },
  { id: 'prism',   name: 'Prism Shard',   hue: 300, glyph: 'prism' },
] as const;
export type CardId = (typeof VOLT_CARDS)[number]['id'];

export interface MemState {
  cols: number; rows: number;
  deck: CardId[];              // redacted for the client except revealed/matched
  revealed: number[];          // currently face-up this turn (max 2)
  matched: number[];           // permanently face-up
  owner: (Slot | null)[];      // who matched each index
  turn: Slot;
  score: [number, number];
  streak: [number, number];
  moves: number;
  coop: boolean;
  startedAt: number;
  over: boolean; winner: Slot | null; reason: string;
  lastResult: 'hit' | 'miss' | null;
}
export type MemMove = { flip: number } | { resolve: true };

export const memoryRules: TurnGameRules<MemState, MemMove> = {
  id: 'memory',
  createInitialState(config, seed) {
    const cols = Number(config.cols ?? 4);
    const rows = Number(config.rows ?? 4);
    const pairs = (cols * rows) / 2;
    const chosen = VOLT_CARDS.slice(0, pairs).map((c) => c.id as CardId);
    const deck = shuffled([...chosen, ...chosen], seed);
    return {
      cols, rows, deck, revealed: [], matched: [], owner: Array(cols * rows).fill(null),
      turn: 0, score: [0, 0], streak: [0, 0], moves: 0, coop: config.coop === true,
      startedAt: Date.now(), over: false, winner: null, reason: '', lastResult: null,
    };
  },
  currentPlayer: (s) => (s.over ? null : s.turn),
  legalMoves(s, p) {
    if (s.over || s.turn !== p) return [];
    if (s.revealed.length >= 2) return [{ resolve: true }];
    const out: MemMove[] = [];
    for (let i = 0; i < s.deck.length; i++)
      if (!s.matched.includes(i) && !s.revealed.includes(i)) out.push({ flip: i });
    return out;
  },
  isLegal(s, p, m): m is MemMove {
    const mv = m as any;
    if (s.over || s.turn !== p || !mv) return false;
    if (mv.resolve === true) return s.revealed.length >= 2;
    if (!Number.isInteger(mv.flip)) return false;
    return s.revealed.length < 2 && mv.flip >= 0 && mv.flip < s.deck.length
      && !s.matched.includes(mv.flip) && !s.revealed.includes(mv.flip);
  },
  applyMove(s, p, m) {
    if ('resolve' in m) {
      const [a, b] = s.revealed;
      const hit = s.deck[a] === s.deck[b];
      if (hit) {
        const owner = s.owner.slice(); owner[a] = p; owner[b] = p;
        const score = [...s.score] as [number, number];
        const streak = [...s.streak] as [number, number];
        streak[p] += 1;
        score[p] += 1 + Math.max(0, streak[p] - 1);      // streak bonus
        const matched = [...s.matched, a, b];
        const next: MemState = { ...s, matched, owner, revealed: [], score, streak, lastResult: 'hit' };
        if (matched.length === s.deck.length) {
          const w = s.coop ? null : score[0] === score[1] ? null : score[0] > score[1] ? 0 : 1;
          return { ...next, over: true, winner: w as Slot | null, reason: s.coop ? 'board cleared together' : score[0] === score[1] ? 'equal pairs' : 'most pairs' };
        }
        return next;   // matcher keeps the turn
      }
      const streak = [...s.streak] as [number, number];
      streak[p] = 0;
      return { ...s, revealed: [], streak, lastResult: 'miss', turn: (s.coop ? (p === 0 ? 1 : 0) : (p === 0 ? 1 : 0)) as Slot };
    }
    const revealed = [...s.revealed, m.flip];
    return { ...s, revealed, moves: s.moves + 1, lastResult: null };
  },
  result: (s): Outcome => (s.over ? { over: true, winner: s.winner, reason: s.reason } : { over: false }),
  /** Face-down card identities are never sent to any client. */
  redact(s) {
    const visible = new Set([...s.revealed, ...s.matched]);
    return { ...s, deck: s.deck.map((c, i) => (visible.has(i) ? c : null)) };
  },
  describeMove: (_s, p, m) => ('resolve' in m ? 'resolve' : `${p === 0 ? 'Volt' : 'Spark'} flips #${m.flip + 1}`),
};
