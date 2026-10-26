/**
 * Who is signed in, and which accounts they have blocked.
 *
 * Everything here is optional: with no Supabase project configured the session
 * is simply empty, the relay is told nothing, and the game plays exactly as it
 * did before accounts existed. What changes when somebody *is* signed in is that
 * the relay can verify them, and that their block list travels with the socket so
 * two people who have blocked each other never end up in the same room.
 *
 * The block list is cached in localStorage per account. It is not a secret from
 * the person whose browser it is — it is a copy of *their* settings — and keeping
 * a copy means the relay can be told about blocks on the very first `hello`,
 * before any query has had a chance to come back.
 */
import { useSyncExternalStore } from 'react';
import { supabase, supabaseEnabled } from './supabase';

export interface SessionState {
  /** False until the first answer from Supabase (or the fact that it is off). */
  ready: boolean;
  userId: string | null;
  handle: string | null;
  name: string | null;
  email: string | null;
  /** The access token the relay verifies. Refreshed by the SDK; read on demand. */
  token: string | null;
}

const EMPTY: SessionState = { ready: false, userId: null, handle: null, name: null, email: null, token: null };
const BLOCKS_KEY = 'pikachu.blocks.v1';

let state: SessionState = EMPTY;
let blocked = new Set<string>();
let started = false;
let starting: Promise<void> | null = null;
let listener: ((s: SessionState) => void) | null = null;
const subscribers = new Set<() => void>();

function emit() {
  for (const fn of subscribers) fn();
  listener?.(state);
}

/* --------------------------------------------------------------- block cache */

type BlockCache = Record<string, string[]>;

function readCache(): BlockCache {
  try {
    const raw = localStorage.getItem(BLOCKS_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed as BlockCache : {};
  } catch {
    return {};
  }
}

function writeCache(userId: string | null, ids: Iterable<string>) {
  if (!userId) return;
  try {
    const all = readCache();
    all[userId] = [...ids].slice(0, 500);
    localStorage.setItem(BLOCKS_KEY, JSON.stringify(all));
  } catch { /* storage disabled is fine, the database is the truth */ }
}

/** What the relay should be told on `hello`. */
export function blockedIds(): string[] {
  return [...blocked];
}

export function isBlocked(accountId: string | null | undefined): boolean {
  return Boolean(accountId && blocked.has(accountId));
}

/**
 * Pull the block list from Postgres. Called when a session appears and after
 * every block or unblock. Failures keep the cached copy, because a stale block
 * list is better than none.
 */
export async function refreshBlocks(): Promise<void> {
  const sb = await supabase();
  const userId = state.userId;
  if (!sb || !userId) {
    blocked = new Set();
    emit();
    return;
  }
  try {
    const { data, error } = await sb.from('blocks').select('blocked');
    if (error) throw error;
    blocked = new Set((data ?? []).map((row: { blocked: string }) => String(row.blocked)));
    writeCache(userId, blocked);
  } catch {
    const cached = readCache()[userId];
    blocked = new Set(Array.isArray(cached) ? cached : []);
  }
  emit();
}

/* ------------------------------------------------------------------ session */

function fromSession(session: { user?: any } | null): SessionState {
  const user = session?.user;
  if (!user) return { ...EMPTY, ready: true };
  const meta = user.user_metadata ?? {};
  const rawHandle = meta.username ?? meta.handle ?? '';
  const handle = String(rawHandle).toLowerCase().replace(/[^a-z0-9_]/g, '');
  return {
    ready: true,
    userId: user.id ?? null,
    handle: handle.length >= 3 ? handle : null,
    name: typeof meta.display_name === 'string' ? meta.display_name : null,
    email: user.email ?? null,
    token: (session as { access_token?: string })?.access_token ?? null,
  };
}

/**
 * Start listening, once. Safe to call from several components; the first call
 * wins and the rest await it.
 */
export function startSession(): Promise<void> {
  if (started) return Promise.resolve();
  if (starting) return starting;
  starting = (async () => {
    if (!supabaseEnabled()) {
      state = { ...EMPTY, ready: true };
      emit();
      started = true;
      return;
    }
    const sb = await supabase();
    if (!sb) {
      state = { ...EMPTY, ready: true };
      emit();
      started = true;
      return;
    }
    const { data } = await sb.auth.getSession();
    state = fromSession(data.session);
    if (state.userId) {
      const cached = readCache()[state.userId];
      blocked = new Set(Array.isArray(cached) ? cached : []);
    }
    emit();
    void refreshBlocks();

    sb.auth.onAuthStateChange((_event, session) => {
      const next = fromSession(session);
      const changedAccount = next.userId !== state.userId;
      state = next;
      if (changedAccount) {
        const cached = next.userId ? readCache()[next.userId] : undefined;
        blocked = new Set(Array.isArray(cached) ? cached : []);
        emit();
        if (next.userId) void refreshBlocks();
      } else {
        emit();
      }
    });

    started = true;
  })();
  return starting;
}

/** The freshest token available, for a socket that is about to (re)connect. */
export async function currentToken(): Promise<string | null> {
  if (!supabaseEnabled()) return null;
  const sb = await supabase();
  if (!sb) return null;
  try {
    const { data } = await sb.auth.getSession();
    return data.session?.access_token ?? null;
  } catch {
    return null;
  }
}

export function sessionSnapshot(): SessionState {
  return state;
}

/** Called by the relay bridge when the signed-in identity changes. */
export function onSessionChange(fn: (s: SessionState) => void) {
  listener = fn;
  return () => { if (listener === fn) listener = null; };
}

function subscribe(fn: () => void) {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

export function useSession(): SessionState {
  return useSyncExternalStore(subscribe, sessionSnapshot, sessionSnapshot);
}

/** Tests only. */
export function __resetSession() {
  state = EMPTY;
  blocked = new Set();
  started = false;
  starting = null;
  subscribers.clear();
  listener = null;
}
