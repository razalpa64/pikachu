/**
 * Optional Supabase layer.
 *
 * The app is fully playable with no credentials: the bundled relay handles online
 * rooms and progress lives in localStorage. When VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
 * are provided, profiles, match results and per-game stats are mirrored to Postgres
 * under Row Level Security (see supabase/migrations).
 *
 * Only the public anon key is ever referenced here. A service-role key must never
 * appear in browser code.
 *
 * The SDK itself (~200 kB) is loaded with a dynamic import and only when both env
 * vars are present, so the default credential-free setup never downloads it.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Identity } from './identity';
import type { MatchRecord, ProgressState } from './progress';

const URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;

/* Accept either the current publishable key or the legacy anon JWT. */
const RAW_KEY =
  (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined) ??
  (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined);

/**
 * Hard stop on a secret key reaching the browser.
 *
 * Vite inlines every VITE_* variable into the client bundle, so putting a
 * `sb_secret_…` key (or a service_role JWT, whose payload contains
 * `"role":"service_role"`) in .env would publish full database access to every
 * visitor. Rather than quietly using it, refuse and say so loudly.
 */
function isSecretKey(k: string): boolean {
  if (k.startsWith('sb_secret_')) return true;
  if (k.startsWith('eyJ')) {
    try {
      const body = JSON.parse(atob(k.split('.')[1] ?? ''));
      if (body?.role === 'service_role') return true;
    } catch { /* not a readable JWT — treat as publishable */ }
  }
  return false;
}

const ANON = RAW_KEY && isSecretKey(RAW_KEY) ? undefined : RAW_KEY;

if (RAW_KEY && !ANON) {
  console.error(
    '[supabase] REFUSING to start: a secret / service_role key is set in VITE_SUPABASE_*. ' +
    'That key would be bundled into the browser. Rotate it immediately in your Supabase ' +
    'dashboard and use the publishable (anon) key instead. Cloud sync stays disabled.',
  );
}

let client: SupabaseClient | null = null;
let booting: Promise<SupabaseClient | null> | null = null;
let warned = false;

export function supabaseEnabled(): boolean {
  return Boolean(URL && ANON && /^https?:\/\//.test(URL));
}

/**
 * Which half of the configuration is missing — **names only, never values**.
 *
 * "Cloud sync is not configured" is true and useless: it does not say whether to
 * add a URL or a key, and the two live in different places. This is what the
 * admin door needs in order to name the variable that is actually absent.
 */
export function supabaseConfigState(): {
  configured: boolean;
  hasUrl: boolean;
  hasKey: boolean;
  secretRefused: boolean;
  projectHost: string | null;
} {
  let projectHost: string | null = null;
  if (URL && /^https?:\/\//.test(URL)) {
    try { projectHost = new globalThis.URL(URL).host; } catch { projectHost = null; }
  }
  return {
    configured: supabaseEnabled(),
    hasUrl: Boolean(URL && /^https?:\/\//.test(URL)),
    hasKey: Boolean(ANON),
    secretRefused: Boolean(RAW_KEY && !ANON),
    projectHost,
  };
}

/**
 * Resolve the client, importing the SDK on first use. Returns null when cloud
 * sync is not configured — every caller must handle that, because the no-cloud
 * path is the normal one.
 */
export function supabase(): Promise<SupabaseClient | null> {
  if (!supabaseEnabled()) return Promise.resolve(null);
  if (client) return Promise.resolve(client);
  if (!booting) {
    booting = import('@supabase/supabase-js')
      .then(({ createClient }) => {
        client = createClient(URL!, ANON!, { auth: { persistSession: true, autoRefreshToken: true } });
        return client;
      })
      .catch((e) => {
        if (!warned) { warned = true; console.warn('[supabase] SDK failed to load', e); }
        booting = null;
        return null;
      });
  }
  return booting;
}

async function currentUserId(): Promise<string | null> {
  const sb = await supabase();
  if (!sb) return null;
  const { data } = await sb.auth.getUser();
  return data.user?.id ?? null;
}

export async function signInWithEmail(email: string) {
  const sb = await supabase();
  if (!sb) throw new Error('Cloud sync is not configured.');
  const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin } });
  if (error) throw error;
}

export function usernameToEmail(username: string): string {
  const clean = username.trim().toLowerCase().replace(/[^a-z0-9_\-\.]/g, '');
  return `${clean || 'trainer'}@pikachu.arcade`;
}

export async function signUpWithPassword(username: string, password: string, email?: string) {
  const sb = await supabase();
  if (!sb) throw new Error('Cloud sync is not configured.');
  const cleanUser = username.trim();
  if (!cleanUser || cleanUser.length < 2) throw new Error('Username must be at least 2 characters.');
  if (!password || password.length < 6) throw new Error('Password must be at least 6 characters.');

  const authEmail = email && email.includes('@') ? email.trim() : usernameToEmail(cleanUser);
  const { data, error } = await sb.auth.signUp({
    email: authEmail,
    password,
    options: {
      data: {
        display_name: cleanUser,
        username: cleanUser.toLowerCase(),
      },
    },
  });
  if (error) throw error;

  if (data.user) {
    try {
      await sb.from('profiles').upsert({
        id: data.user.id,
        display_name: cleanUser,
        mascot: 'classic',
        updated_at: new Date().toISOString(),
      });
    } catch { /* trigger also handles this */ }
  }
  return data;
}

export async function signInWithPassword(usernameOrEmail: string, password: string) {
  const sb = await supabase();
  if (!sb) throw new Error('Cloud sync is not configured.');
  const input = usernameOrEmail.trim();
  if (!input) throw new Error('Please enter your username or email.');
  if (!password) throw new Error('Please enter your password.');

  const authEmail = input.includes('@') ? input : usernameToEmail(input);
  const { data, error } = await sb.auth.signInWithPassword({
    email: authEmail,
    password,
  });
  if (error) {
    if (error.message.toLowerCase().includes('invalid login credentials')) {
      throw new Error('Incorrect username or password.');
    }
    throw error;
  }
  return data;
}

export async function signOut() {
  await (await supabase())?.auth.signOut();
}

export async function fetchRemoteUserData(): Promise<{ name?: string; mascot?: string; stats?: Record<string, any> } | null> {
  const sb = await supabase();
  if (!sb) return null;
  const uid = await currentUserId();
  if (!uid) return null;
  try {
    const { data: profile } = await sb.from('profiles').select('display_name, mascot').eq('id', uid).maybeSingle();
    const { data: statsRows } = await sb.from('player_stats').select('*').eq('user_id', uid);
    const stats: Record<string, any> = {};
    if (statsRows) {
      for (const row of statsRows) {
        stats[row.game_id] = {
          played: row.matches_played,
          wins: row.wins,
          losses: row.losses,
          draws: row.draws,
          best: row.best_score,
        };
      }
    }
    return {
      name: profile?.display_name,
      mascot: profile?.mascot,
      stats: Object.keys(stats).length ? stats : undefined,
    };
  } catch (e) {
    if (!warned) { warned = true; console.warn('[supabase] data fetch unavailable', e); }
    return null;
  }
}

export async function logRoomMessage(roomCode: string, senderId: string, senderName: string, message: string) {
  const sb = await supabase();
  if (!sb) return;
  try {
    /* Every one of these is clamped to the CHECK constraint in
       supabase/migrations/0003_feedback.sql. A mirror that fails because somebody's
       name is 41 characters long is a mirror that quietly stops working. */
    await sb.from('room_messages').insert({
      room_code: roomCode.toUpperCase().slice(0, 10),
      sender_id: String(senderId).slice(0, 64),
      sender_name: (senderName || 'A player').slice(0, 40),
      message: message.slice(0, 300),
    });
  } catch { /* best effort */ }
}

export async function upsertRemoteProfile(identity: Identity) {
  const sb = await supabase();
  if (!sb) return;
  try {
    const uid = await currentUserId();
    if (!uid) return;
    await sb.from('profiles').upsert({
      id: uid,
      display_name: (identity.name || 'Trainer').slice(0, 40),   // profiles.display_name is 1–40
      mascot: identity.mascot,
      updated_at: new Date().toISOString(),
    });
  } catch (e) {
    if (!warned) { warned = true; console.warn('[supabase] profile sync unavailable', e); }
  }
}

export async function pushRemoteMatch(rec: MatchRecord, progress: ProgressState) {
  const sb = await supabase();
  if (!sb) return;
  try {
    const uid = await currentUserId();
    if (!uid) return;
    await sb.from('match_results').insert({
      user_id: uid, game_id: rec.gameId, mode: rec.mode, result: rec.result,
      score: rec.score ?? null, metadata: rec.meta ?? {},
    });
    const st = progress.stats[rec.gameId];
    if (st) {
      await sb.from('player_stats').upsert({
        user_id: uid, game_id: rec.gameId, matches_played: st.played, wins: st.wins,
        losses: st.losses, draws: st.draws, best_score: st.best, updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id,game_id' });
    }
  } catch (e) {
    if (!warned) { warned = true; console.warn('[supabase] match sync unavailable', e); }
  }
}
