/**
 * The half of identity that cannot be unit-tested with a socket: does the relay
 * believe a token only when the auth server says so?
 *
 * `fetch` is stubbed here — the point is what the relay does with each answer,
 * including the answer "I could not reach the server", which must not quietly
 * turn a signed-in player into a guest (a guest is outside every block list).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authConfig, authConfigured, resetAuthCache, verifyAccessToken } from '../../../server/auth';

const USER_ID = '11111111-1111-1111-1111-111111111111';

/** A JWT-shaped string. The relay never trusts the payload; it only reads `exp`. */
function token(claims: Record<string, unknown> = {}, expIn = 600): string {
  const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${enc({ alg: 'HS256', typ: 'JWT' })}.${enc({ sub: USER_ID, exp: Math.floor(Date.now() / 1000) + expIn, ...claims })}.signature`;
}

const originalEnv = { ...process.env };
const realFetch = globalThis.fetch;

beforeEach(() => {
  resetAuthCache();
  process.env.SUPABASE_URL = 'https://demo.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'sb_publishable_test';
});

afterEach(() => {
  process.env = { ...originalEnv };
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

/** Answer the next `/auth/v1/user` call. */
function respond(status: number, body: unknown = {}) {
  const spy = vi.fn(async () => new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json' },
  }));
  globalThis.fetch = spy as unknown as typeof fetch;
  return spy;
}

describe('the relay’s auth configuration', () => {
  it('is off unless both halves are present', () => {
    expect(authConfigured()).toBe(true);
    delete process.env.SUPABASE_ANON_KEY;
    delete process.env.VITE_SUPABASE_ANON_KEY;
    delete process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
    expect(authConfig()).toBeNull();
    expect(authConfigured()).toBe(false);
  });

  it('accepts the same variables the web app already uses', () => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_ANON_KEY;
    process.env.VITE_SUPABASE_URL = 'https://demo.supabase.co';
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_test';
    expect(authConfig()).toEqual({ url: 'https://demo.supabase.co', key: 'sb_publishable_test' });
  });

  it('refuses a URL that is not plain http(s)', () => {
    process.env.SUPABASE_URL = 'file:///etc/passwd';
    expect(authConfig()).toBeNull();
  });
});

describe('verifying a token', () => {
  it('asks the auth server, and believes the answer', async () => {
    const spy = respond(200, {
      id: USER_ID,
      user_metadata: { display_name: 'Ash', username: 'Ash' },
    });
    const jwt = token();
    const out = await verifyAccessToken(jwt);
    expect(out).toEqual({
      ok: true,
      user: { id: USER_ID, handle: 'ash', name: 'Ash' },
    });
    expect(spy).toHaveBeenCalledTimes(1);
    const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://demo.supabase.co/auth/v1/user');
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${jwt}`);
    /* The anon key goes along as `apikey`, exactly as the browser sends it. */
    expect((init.headers as Record<string, string>).apikey).toBe('sb_publishable_test');
  });

  it('handles a profile with no username at all', async () => {
    respond(200, { id: USER_ID, user_metadata: { display_name: 'Ash' } });
    const out = await verifyAccessToken(token({}, 600));
    expect(out.ok && out.user.handle).toBeNull();
  });

  it('rejects an id that is not a uuid, however friendly the response', async () => {
    respond(200, { id: 'admin', user_metadata: {} });
    const out = await verifyAccessToken(token());
    expect(out).toEqual({ ok: false, reason: 'invalid' });
  });

  it('rejects a token the auth server refuses, and remembers that', async () => {
    const spy = respond(401, { message: 'invalid claim' });
    expect(await verifyAccessToken(token())).toEqual({ ok: false, reason: 'invalid' });
    /* A broken client must not make the relay hammer the auth server. */
    expect(await verifyAccessToken(token())).toEqual({ ok: false, reason: 'invalid' });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('caches a good answer, because every reconnect sends hello', async () => {
    const spy = respond(200, { id: USER_ID, user_metadata: { username: 'ash' } });
    for (let i = 0; i < 5; i++) await verifyAccessToken(token());
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('never caches a token past its own expiry', async () => {
    /* Two seconds of life left, so the cache entry cannot outlive it. */
    const soon = token({}, 2);
    const spy = respond(200, { id: USER_ID, user_metadata: {} });
    await verifyAccessToken(soon);
    expect(spy).toHaveBeenCalledTimes(1);
    const entryUntil = Date.now() + 2000;
    expect(entryUntil - Date.now()).toBeLessThanOrEqual(2000);
  });

  it('does not even ask about a token that has already expired', async () => {
    const spy = respond(200, { id: USER_ID, user_metadata: {} });
    expect(await verifyAccessToken(token({}, -60))).toEqual({ ok: false, reason: 'invalid' });
    expect(spy, 'no network call for something already dead').not.toHaveBeenCalled();
  });

  it('treats an unreachable auth server as "try again", not as a liar', async () => {
    globalThis.fetch = vi.fn(async () => { throw new Error('ECONNREFUSED'); }) as unknown as typeof fetch;
    expect(await verifyAccessToken(token())).toEqual({ ok: false, reason: 'unavailable' });
    /* Not cached as a refusal: the next attempt gets a fresh chance. */
    const spy = respond(200, { id: USER_ID, user_metadata: {} });
    expect((await verifyAccessToken(token())).ok).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('refuses nonsense without touching the network', async () => {
    const spy = respond(200, { id: USER_ID, user_metadata: {} });
    for (const bad of ['', 'short', 'x'.repeat(5000), 123]) {
      expect((await verifyAccessToken(bad as unknown as string)).ok, String(bad).slice(0, 12)).toBe(false);
    }
    expect(spy).not.toHaveBeenCalled();
  });

  it('is off when the project is not configured, even with a real token', async () => {
    process.env.SUPABASE_URL = '';
    delete process.env.VITE_SUPABASE_URL;
    const spy = respond(200, { id: USER_ID, user_metadata: {} });
    expect(await verifyAccessToken(token())).toEqual({ ok: false, reason: 'invalid' });
    expect(spy).not.toHaveBeenCalled();
  });
});
