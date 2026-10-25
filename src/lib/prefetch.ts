/**
 * Chunk prefetching.
 *
 * Every game view and every route is code-split, which keeps the first paint
 * small but means the *first* visit to a game pays for a network round-trip
 * before anything appears. This module pays that cost early, in the background,
 * at moments where nothing is competing for the main thread:
 *
 *   - `idlePrefetch()`   on boot, during idle time, in priority order
 *   - `prefetchGame(id)` on hover/focus/touch of a game card — by the time the
 *                        click lands the module is usually already parsed
 *   - `warmChessWorker()` boots the chess engine worker ahead of time, because
 *                        spawning a module worker is the slowest single step in
 *                        opening Chess Arena
 *
 * Everything here is idempotent, failure-tolerant (a prefetch that rejects is
 * simply forgotten — the real import will surface the error), and never blocks.
 */

import { SOLO_IMPORTERS } from '../games/views';

type Importer = () => Promise<unknown>;

/* One list, shared with the solo route: a game cannot be routable and
   un-warmable, or warmable and unroutable. */
const GAME_CHUNKS: Record<string, Importer> = SOLO_IMPORTERS as Record<string, Importer>;

const ROUTE_CHUNKS: Record<string, Importer> = {
  library: () => import('../screens/Library'),
  together: () => import('../screens/PlayTogether'),
  room: () => import('../screens/Room'),
  solo: () => import('../screens/SoloHub'),
  'solo-view': () => import('../screens/Solo'),
  challenges: () => import('../screens/Challenges'),
  achievements: () => import('../screens/Achievements'),
  profile: () => import('../screens/Profile'),
  settings: () => import('../screens/Settings'),
};

const started = new Set<string>();

function run(key: string, importer: Importer) {
  if (started.has(key)) return;
  started.add(key);
  // A failed prefetch must never reach the console as an unhandled rejection;
  // the real navigation will import again and report properly.
  void importer().catch(() => started.delete(key));
}

/** Warm one game's view chunk. Safe to call on every mouseenter. */
export function prefetchGame(gameId: string) {
  const importer = GAME_CHUNKS[gameId];
  if (importer) run(`game:${gameId}`, importer);
  // Opening any game also goes through the Solo route shell.
  run('route:solo-view', ROUTE_CHUNKS['solo-view']);
}

/** Warm one route chunk. Safe to call on every mouseenter of a nav link. */
export function prefetchRoute(name: keyof typeof ROUTE_CHUNKS | string) {
  const importer = ROUTE_CHUNKS[name];
  if (importer) run(`route:${name}`, importer);
}

/* ------------------------------------------------------------------ worker */

let warmWorker: Worker | null = null;

/**
 * Spawn the chess engine worker early and hand it a no-op so the module graph
 * is compiled before the player makes their first move. Returns the instance so
 * the chess view can adopt it instead of paying to spawn a second one.
 */
export function warmChessWorker(): Worker | null {
  if (typeof Worker === 'undefined') return null;
  if (warmWorker) return warmWorker;
  try {
    warmWorker = new Worker(new URL('../workers/chessEngine.worker.ts', import.meta.url), { type: 'module' });
    return warmWorker;
  } catch {
    warmWorker = null;
    return null;
  }
}

/** Hand the pre-warmed worker to the first caller; later callers spawn their own. */
export function takeWarmChessWorker(): Worker | null {
  const w = warmWorker;
  warmWorker = null;
  return w;
}

/* ------------------------------------------------------------------- idle */

function onIdle(fn: () => void, timeout = 2500) {
  if (typeof window === 'undefined') return;
  const ric = (window as unknown as {
    requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number;
  }).requestIdleCallback;
  if (ric) ric(fn, { timeout });
  else window.setTimeout(fn, 400);
}

let idleDone = false;

/**
 * Background-warm the app after first paint, cheapest and most-likely-first,
 * one chunk per idle slice so we never jank the home screen. Skipped entirely
 * on a metered or slow connection, where speculative downloads are rude.
 */
export function idlePrefetch() {
  if (idleDone || typeof window === 'undefined') return;
  idleDone = true;

  const conn = (navigator as unknown as {
    connection?: { saveData?: boolean; effectiveType?: string };
  }).connection;
  if (conn?.saveData) return;
  if (conn?.effectiveType && /(^|-)2g$/.test(conn.effectiveType)) return;

  const queue: Array<[string, Importer]> = [
    ['route:library', ROUTE_CHUNKS.library],
    ['route:solo', ROUTE_CHUNKS.solo],
    ['route:solo-view', ROUTE_CHUNKS['solo-view']],
    ['route:together', ROUTE_CHUNKS.together],
    ['route:room', ROUTE_CHUNKS.room],
    // the three quickest games to start — most likely first clicks
    ['game:tictactoe', GAME_CHUNKS.tictactoe],
    ['game:memory', GAME_CHUNKS.memory],
    ['game:connect4', GAME_CHUNKS.connect4],
    ['route:challenges', ROUTE_CHUNKS.challenges],
    ['route:achievements', ROUTE_CHUNKS.achievements],
    ['game:chess', GAME_CHUNKS.chess],
    ['game:checkers', GAME_CHUNKS.checkers],
    ['game:reaction', GAME_CHUNKS.reaction],
    ['game:snake', GAME_CHUNKS.snake],
    ['game:battleship', GAME_CHUNKS.battleship],
    ['game:puzzle', GAME_CHUNKS.puzzle],
    ['game:arcade', GAME_CHUNKS.arcade],
    ['route:profile', ROUTE_CHUNKS.profile],
    ['route:settings', ROUTE_CHUNKS.settings],
  ];

  let i = 0;
  const pump = () => {
    if (i >= queue.length) { onIdle(() => { warmChessWorker(); }, 6000); return; }
    const [key, importer] = queue[i++];
    run(key, importer);
    onIdle(pump, 4000);
  };
  onIdle(pump);
}
