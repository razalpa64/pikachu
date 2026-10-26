/**
 * Who is on the other end of the socket.
 *
 * Until now the relay believed whatever `playerId` a client claimed. That is
 * fine for a private room whose code you had to be given — the code *is* the
 * credential — and it is not fine the moment there is a friend list, a block
 * list or a report button: a player who can type any id can wear somebody else's
 * name, come back after being blocked, and file reports as their victim.
 *
 * So a client may present the Supabase access token it already holds, and the
 * relay asks the auth server who that is. The token is never trusted on its own
 * (a JWT payload is just base64 until somebody verifies it) and the anon key is
 * used as the `apikey`, exactly as the browser does.
 *
 * Nothing here is required. With no Supabase project configured — or a player
 * who has not signed in — the relay behaves precisely as it did before: guests
 * queue, play and chat. Verification only makes an account harder to impersonate.
 */

export interface AuthConfig {
  url: string;
  key: string;
}

export interface VerifiedUser {
  id: string;
  handle: string | null;
  name: string | null;
}

const TOKEN_TTL_MS = 1000 * 60 * 5;
/** A token that has failed is remembered briefly, so a broken client cannot make
 *  the relay hammer the auth server once a second. */
const REFUSAL_TTL_MS = 1000 * 30;
const MAX_CACHED = 2000;

type Entry = { user: VerifiedUser | null; until: number };
const cache = new Map<string, Entry>();

function env(...names: string[]): string | undefined {
  for (const n of names) {
    const v = process.env[n];
    if (v && v.trim()) return v.trim();
  }
  return undefined;
}

/**
 * The relay reuses the same two variables the web app already needs, so turning
 * this on is not a new deployment step — and a deployment without them simply
 * has no accounts, which is a supported way to run the game.
 */
export function authConfig(): AuthConfig | null {
  const url = env('SUPABASE_URL', 'VITE_SUPABASE_URL');
  const key = env('SUPABASE_ANON_KEY', 'VITE_SUPABASE_ANON_KEY', 'VITE_SUPABASE_PUBLISHABLE_KEY');
  if (!url || !key) return null;
  if (!/^https:\/\/|^http:\/\/(localhost|127\.0\.0\.1)/.test(url)) return null;
  return { url: url.replace(/\/+$/, ''), key };
}

export function authConfigured(): boolean {
  return authConfig() !== null;
}

/** `exp` from the payload, or null if this is not a readable JWT. Never trusted
 *  for identity — only used to avoid caching something already dead. */
function tokenExpiry(token: string): number | null {
  const part = token.split('.')[1];
  if (!part) return null;
  try {
    const json = Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    const exp = JSON.parse(json)?.exp;
    return typeof exp === 'number' ? exp * 1000 : null;
  } catch {
    return null;
  }
}

function handleFrom(meta: Record<string, unknown> | undefined): string | null {
  const raw = (meta?.username ?? meta?.handle ?? '') as string;
  const clean = String(raw).toLowerCase().replace(/[^a-z0-9_]/g, '');
  return clean.length >= 3 && clean.length <= 20 ? clean : null;
}

function remember(token: string, user: VerifiedUser | null, ttl: number) {
  if (cache.size >= MAX_CACHED) {
    /* Drop the oldest handful rather than growing without bound; the map keeps
       insertion order, so the first keys are the oldest. */
    let n = 0;
    for (const k of cache.keys()) {
      cache.delete(k);
      if (++n >= 200) break;
    }
  }
  cache.set(token, { user, until: Date.now() + ttl });
}

export type VerifyResult =
  | { ok: true; user: VerifiedUser }
  | { ok: false; reason: 'invalid' | 'unavailable' };

/**
 * Ask the auth server about a token. Cached for five minutes (or until the token
 * itself expires, whichever is sooner) because the relay sees a `hello` on every
 * reconnect and this is the only outbound request it ever makes.
 */
export async function verifyAccessToken(token: string): Promise<VerifyResult> {
  const conf = authConfig();
  if (!conf) return { ok: false, reason: 'invalid' };
  if (typeof token !== 'string' || token.length < 20 || token.length > 4096) {
    return { ok: false, reason: 'invalid' };
  }

  const now = Date.now();
  const hit = cache.get(token);
  if (hit && hit.until > now) {
    return hit.user ? { ok: true, user: hit.user } : { ok: false, reason: 'invalid' };
  }

  const exp = tokenExpiry(token);
  if (exp !== null && exp <= now) {
    remember(token, null, REFUSAL_TTL_MS);
    return { ok: false, reason: 'invalid' };
  }

  let res: Response;
  try {
    res = await fetch(`${conf.url}/auth/v1/user`, {
      headers: { apikey: conf.key, Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(6000),
    });
  } catch {
    /* Supabase unreachable. Not the player's fault, and not evidence that the
       token is bad — the caller decides to refuse rather than quietly downgrade
       a signed-in player to a guest (which would defeat every block). */
    return { ok: false, reason: 'unavailable' };
  }

  if (!res.ok) {
    remember(token, null, REFUSAL_TTL_MS);
    return { ok: false, reason: 'invalid' };
  }

  let body: any;
  try {
    body = await res.json();
  } catch {
    return { ok: false, reason: 'unavailable' };
  }

  const id = body?.id;
  if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) {
    remember(token, null, REFUSAL_TTL_MS);
    return { ok: false, reason: 'invalid' };
  }

  const meta = (body?.user_metadata ?? {}) as Record<string, unknown>;
  const user: VerifiedUser = {
    id: id.toLowerCase(),
    handle: handleFrom(meta),
    name: typeof meta.display_name === 'string' ? String(meta.display_name).slice(0, 24) : null,
  };

  const ttl = exp === null ? TOKEN_TTL_MS : Math.min(TOKEN_TTL_MS, Math.max(1000, exp - now));
  remember(token, user, ttl);
  return { ok: true, user };
}

/** Tests only: forget what has been looked up. */
export function resetAuthCache() {
  cache.clear();
}
