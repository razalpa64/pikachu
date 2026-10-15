/**
 * Progression: XP, per-game stats, achievements, favourites, recents.
 * Stored locally and mirrored to Supabase when credentials are configured
 * (see src/lib/supabase.ts). Local storage is NEVER the source of truth for an
 * online competitive result — the relay decides outcomes; this only records them.
 */
import { GAMES } from '../games/registry';

export interface GameStat { played: number; wins: number; losses: number; draws: number; best: number }
export interface ProgressState {
  xp: number;
  stats: Record<string, GameStat>;
  achievements: Record<string, number>;   // slug -> unlocked timestamp
  favourites: string[];
  recents: { gameId: string; at: number; mode: string }[];
  dailySeed: string;
  dailyProgress: Record<string, number>;
  versus: { wins: number; losses: number; draws: number };
  updatedAt: number;
}

const KEY = 'pikachu.progress.v1';
const EMPTY_STAT: GameStat = { played: 0, wins: 0, losses: 0, draws: 0, best: 0 };

export const LEVELS = [0, 120, 300, 560, 900, 1350, 1900, 2600, 3500, 4600, 6000, 7800, 10000];
export function levelFor(xp: number) {
  let level = 1;
  for (let i = 0; i < LEVELS.length; i++) if (xp >= LEVELS[i]) level = i + 1;
  const floor = LEVELS[level - 1] ?? 0;
  const ceil = LEVELS[level] ?? floor + 2500;
  return { level, floor, ceil, pct: Math.min(1, (xp - floor) / (ceil - floor)) };
}

export interface Achievement { slug: string; name: string; description: string; icon: string; secret?: boolean }
export const ACHIEVEMENTS: Achievement[] = [
  { slug: 'first-spark', name: 'First Spark', description: 'Finish your very first match.', icon: 'bolt' },
  { slug: 'arena-opener', name: 'Arena Opener', description: 'Create a private room.', icon: 'door' },
  { slug: 'two-of-us', name: 'Two of Us', description: 'Complete an online match against a real opponent.', icon: 'heart' },
  { slug: 'checkmate', name: 'Checkmate', description: 'Win a game of Chess Arena.', icon: 'crown' },
  { slug: 'unbeatable', name: 'Hold the Line', description: 'Draw the Expert tic-tac-toe AI.', icon: 'shield' },
  { slug: 'four-strike', name: 'Four Strike', description: 'Win Drop Four with a diagonal four.', icon: 'diagonal' },
  { slug: 'elephant', name: 'Elephant Memory', description: 'Clear a Memory Match board with a streak of 4+.', icon: 'brain' },
  { slug: 'reflex', name: 'Lightning Reflex', description: 'React in under 220 ms.', icon: 'flash' },
  { slug: 'admiral', name: 'Admiral', description: 'Win Paper Fleet without losing a ship.', icon: 'anchor' },
  { slug: 'crowned', name: 'Crowned', description: 'Promote three kings in one Checkers match.', icon: 'king' },
  { slug: 'serpent', name: 'Serpent', description: 'Reach length 25 in Snake Arena.', icon: 'snake' },
  { slug: 'puzzler', name: 'Chamber Cleared', description: 'Solve one of every Puzzle Quest type.', icon: 'key' },
  { slug: 'runner', name: 'Storm Runner', description: 'Score 2000 in Volt Runner.', icon: 'run' },
  { slug: 'rival', name: 'Rivals', description: 'Play 10 online matches together.', icon: 'swords' },
  { slug: 'night-owl', name: 'Night Owl', description: 'Finish a match after midnight.', icon: 'moon' },
  { slug: 'comeback', name: 'Comeback', description: 'Win a rematch right after losing.', icon: 'rotate' },
];

export function emptyProgress(): ProgressState {
  const stats: Record<string, GameStat> = {};
  for (const g of GAMES) stats[g.id] = { ...EMPTY_STAT };
  return {
    xp: 0, stats, achievements: {}, favourites: [], recents: [],
    dailySeed: todaySeed(), dailyProgress: {}, versus: { wins: 0, losses: 0, draws: 0 }, updatedAt: Date.now(),
  };
}

export function todaySeed() {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

export function loadProgress(): ProgressState {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const p = { ...emptyProgress(), ...JSON.parse(raw) } as ProgressState;
      for (const g of GAMES) p.stats[g.id] = { ...EMPTY_STAT, ...p.stats[g.id] };
      if (p.dailySeed !== todaySeed()) { p.dailySeed = todaySeed(); p.dailyProgress = {}; }
      return p;
    }
  } catch { /* ignore */ }
  return emptyProgress();
}
export function saveProgress(p: ProgressState) {
  p.updatedAt = Date.now();
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* ignore */ }
}

/* ---------------------------------------------------------------- daily challenges */
export interface DailyChallenge { id: string; title: string; detail: string; goal: number; xp: number; gameId: string }

export function dailyChallenges(seed = todaySeed()): DailyChallenge[] {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const pool: DailyChallenge[] = [
    { id: 'win-any', title: 'Storm Warm-up', detail: 'Win any two matches today.', goal: 2, xp: 60, gameId: 'any' },
    { id: 'memory-streak', title: 'Perfect Recall', detail: 'Hit a 3-match streak in Memory Match.', goal: 1, xp: 55, gameId: 'memory' },
    { id: 'c4-win', title: 'Cabinet Champion', detail: 'Beat the Drop Four AI on Intermediate or higher.', goal: 1, xp: 70, gameId: 'connect4' },
    { id: 'chess-move', title: 'Opening Theory', detail: 'Play 20 chess moves.', goal: 20, xp: 50, gameId: 'chess' },
    { id: 'react-fast', title: 'Hair Trigger', detail: 'Land a reaction under 300 ms.', goal: 1, xp: 65, gameId: 'reaction' },
    { id: 'snake-score', title: 'Neon Feast', detail: 'Score 120 in Snake Arena.', goal: 120, xp: 60, gameId: 'snake' },
    { id: 'puzzle-solve', title: 'Chamber Run', detail: 'Solve two Puzzle Quest challenges.', goal: 2, xp: 60, gameId: 'puzzle' },
    { id: 'together', title: 'Better Together', detail: 'Finish one online match with your rival.', goal: 1, xp: 90, gameId: 'any' },
  ];
  // Deterministic selection without collisions: draw from a shrinking pool so the
  // loop always terminates (a retry-until-unused loop can cycle on some LCG seeds).
  const rest = [...pool];
  const picked: DailyChallenge[] = [];
  while (picked.length < 3 && rest.length) {
    h = (Math.imul(h, 1103515245) + 12345) >>> 0;
    picked.push(rest.splice(h % rest.length, 1)[0]);
  }
  return picked;
}

/* ---------------------------------------------------------------- mutations */
export interface MatchRecord {
  gameId: string; mode: string; result: 'win' | 'loss' | 'draw';
  score?: number; opponent?: string; meta?: Record<string, unknown>;
}

export function recordMatch(p: ProgressState, rec: MatchRecord): { next: ProgressState; unlocked: Achievement[]; xpGained: number } {
  const next: ProgressState = structuredClone(p);
  const st = next.stats[rec.gameId] ?? { ...EMPTY_STAT };
  st.played += 1;
  if (rec.result === 'win') st.wins += 1;
  else if (rec.result === 'loss') st.losses += 1;
  else st.draws += 1;
  if (typeof rec.score === 'number') st.best = Math.max(st.best, rec.score);
  next.stats[rec.gameId] = st;

  if (rec.mode === 'online') {
    if (rec.result === 'win') next.versus.wins += 1;
    else if (rec.result === 'loss') next.versus.losses += 1;
    else next.versus.draws += 1;
  }

  const xpGained = (rec.result === 'win' ? 45 : rec.result === 'draw' ? 25 : 15) + (rec.mode === 'online' ? 20 : 0);
  next.xp += xpGained;

  next.recents = [{ gameId: rec.gameId, at: Date.now(), mode: rec.mode },
    ...next.recents.filter((r) => r.gameId !== rec.gameId)].slice(0, 8);

  const unlocked: Achievement[] = [];
  const unlock = (slug: string) => {
    if (next.achievements[slug]) return;
    const a = ACHIEVEMENTS.find((x) => x.slug === slug);
    if (!a) return;
    next.achievements[slug] = Date.now();
    unlocked.push(a);
  };

  unlock('first-spark');
  if (rec.mode === 'online') unlock('two-of-us');
  if (rec.gameId === 'chess' && rec.result === 'win') unlock('checkmate');
  if (new Date().getHours() < 5) unlock('night-owl');
  const onlineTotal = next.versus.wins + next.versus.losses + next.versus.draws;
  if (onlineTotal >= 10) unlock('rival');
  const meta = rec.meta ?? {};
  if (meta.diagonalWin) unlock('four-strike');
  if (meta.memoryStreak && (meta.memoryStreak as number) >= 4) unlock('elephant');
  if (meta.reactionMs && (meta.reactionMs as number) < 220) unlock('reflex');
  if (meta.flawlessFleet) unlock('admiral');
  if (meta.kings && (meta.kings as number) >= 3) unlock('crowned');
  if (meta.snakeLength && (meta.snakeLength as number) >= 25) unlock('serpent');
  if (meta.arcadeScore && (meta.arcadeScore as number) >= 2000) unlock('runner');
  if (meta.ttt_expert_draw) unlock('unbeatable');
  if (meta.rematchWin) unlock('comeback');
  if (meta.puzzleKinds && Array.isArray(meta.puzzleKinds) && (meta.puzzleKinds as string[]).length >= 5) unlock('puzzler');

  // daily challenge ticking
  const tick = (id: string, by = 1) => { next.dailyProgress[id] = (next.dailyProgress[id] ?? 0) + by; };
  if (rec.result === 'win') tick('win-any');
  if (rec.mode === 'online') tick('together');
  if (rec.gameId === 'connect4' && rec.result === 'win') tick('c4-win');
  if (rec.gameId === 'puzzle' && rec.result === 'win') tick('puzzle-solve');
  if (rec.gameId === 'snake' && rec.score) next.dailyProgress['snake-score'] = Math.max(next.dailyProgress['snake-score'] ?? 0, rec.score);
  if (rec.gameId === 'memory' && meta.memoryStreak && (meta.memoryStreak as number) >= 3) tick('memory-streak');
  if (rec.gameId === 'reaction' && meta.reactionMs && (meta.reactionMs as number) < 300) tick('react-fast');
  if (rec.gameId === 'chess' && meta.moves) next.dailyProgress['chess-move'] = (next.dailyProgress['chess-move'] ?? 0) + (meta.moves as number);

  for (let i = 0; i < unlocked.length; i++) next.xp += 40;
  return { next, unlocked, xpGained };
}

export function unlockAchievement(p: ProgressState, slug: string): { next: ProgressState; unlocked: Achievement[] } {
  if (p.achievements[slug]) return { next: p, unlocked: [] };
  const a = ACHIEVEMENTS.find((x) => x.slug === slug);
  if (!a) return { next: p, unlocked: [] };
  const next = structuredClone(p);
  next.achievements[slug] = Date.now();
  next.xp += 40;
  return { next, unlocked: [a] };
}

export function toggleFavourite(p: ProgressState, gameId: string): ProgressState {
  const next = structuredClone(p);
  next.favourites = next.favourites.includes(gameId)
    ? next.favourites.filter((g) => g !== gameId)
    : [...next.favourites, gameId];
  return next;
}

export function noteVisit(p: ProgressState, gameId: string, mode: string): ProgressState {
  const next = structuredClone(p);
  next.recents = [{ gameId, at: Date.now(), mode }, ...next.recents.filter((r) => r.gameId !== gameId)].slice(0, 8);
  return next;
}
