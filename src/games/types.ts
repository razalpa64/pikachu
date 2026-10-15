/**
 * PIKACHU — shared game contract.
 *
 * Every turn-based game implements `TurnGameRules`. The SAME module is imported by
 *   • the browser (optimistic rendering + solo/AI play), and
 *   • the authoritative relay server (validation of every submitted action).
 * That is what makes multiplayer trustworthy: the client never decides outcomes.
 */

export type Slot = 0 | 1;
export type Outcome =
  | { over: false }
  | { over: true; winner: Slot | null; reason: string };

export interface TurnGameRules<S, M> {
  /** registry id, must match GameMeta.id */
  readonly id: string;
  /** deterministic given (config, seed) — the server owns the seed */
  createInitialState(config: Record<string, unknown>, seed: number): S;
  /** which slot must act now; null when nobody can act (game over / waiting on timer) */
  currentPlayer(state: S): Slot | null;
  /** full enumeration used by AI + UI hints (keep cheap) */
  legalMoves(state: S, player: Slot): M[];
  /** authoritative legality check — must not trust shape of `move` */
  isLegal(state: S, player: Slot, move: unknown): move is M;
  /** pure transition. Never mutate `state`. */
  applyMove(state: S, player: Slot, move: M): S;
  result(state: S): Outcome;
  /** strip information the given slot must not see (hidden-info games) */
  redact?(state: S, forPlayer: Slot | 'spectator'): unknown;
  /** optional: server-side tick for games with timers (reaction duel) */
  tick?(state: S, nowMs: number): S;
  /** human-readable move, used in move history + AI explanations */
  describeMove?(state: S, player: Slot, move: M): string;
}

export type GameMode = 'solo' | 'ai' | 'online' | 'local' | 'coop';
export type Genre = 'strategy' | 'arcade' | 'puzzle' | 'party' | 'racing';
export type Difficulty = 'beginner' | 'casual' | 'intermediate' | 'advanced' | 'expert';

export interface GameMeta {
  id: string;
  slug: string;
  title: string;
  tagline: string;
  description: string;
  genre: Genre;
  modes: GameMode[];
  players: [min: number, max: number];
  /** average length, minutes */
  duration: number;
  accent: string;
  /** palette used by the procedural key-art */
  artKey: string;
  status: 'live' | 'soon';
  difficulties?: Difficulty[];
  /** true when the bundled relay server knows how to referee it */
  serverRefereed: boolean;
  settings?: GameSetting[];
}

export interface GameSetting {
  key: string;
  label: string;
  type: 'select' | 'toggle';
  options?: { value: string | number | boolean; label: string }[];
  default: string | number | boolean;
}

/** Deterministic PRNG (mulberry32) — same sequence on server & client. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffled<T>(items: T[], seed: number): T[] {
  const r = rng(seed);
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export const other = (p: Slot): Slot => (p === 0 ? 1 : 0);
