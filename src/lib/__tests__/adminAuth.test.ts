import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import { accountCandidates, allowlistSql, describeAdminProbeError, describeAuthError, missingEnvNames, notOnRosterProblem } from '../adminAuth';

/**
 * The admin door fails four different ways and each one has a different fix.
 * These tests make sure the four are told apart, because treating them the same
 * is exactly the bug: "not on the roster" for what was really an un-run
 * migration, or "sign-in failed" for a build with no project URL.
 */

describe('describeAuthError', () => {
  it('names an unconfirmed email and the one-step fix', () => {
    const p = describeAuthError({ message: 'Email not confirmed', code: 'email_not_confirmed' });
    expect(p.code).toBe('email_not_confirmed');
    expect(p.title).toMatch(/confirm/i);
    expect(p.hint).toMatch(/--fix|Confirm/i);
  });

  it('separates wrong credentials from a broken project', () => {
    const wrong = describeAuthError({ message: 'Invalid login credentials', status: 400 });
    expect(wrong.code).toBe('invalid_credentials');
    expect(wrong.hint).toMatch(/pikachu\.arcade/i);

    const down = describeAuthError({ message: 'Failed to fetch', name: 'TypeError' });
    expect(down.code).toBe('network');
    expect(down.hint).toMatch(/VITE_SUPABASE_URL/);
  });

  it('says to wait rather than retry on a rate limit', () => {
    const p = describeAuthError({ message: 'Request rate limit reached', status: 429 });
    expect(p.code).toBe('rate_limited');
    expect(p.hint).toMatch(/five minutes/i);
  });

  it('treats a 5xx as their side, not a wrong password', () => {
    expect(describeAuthError({ message: '', status: 503 }).code).toBe('server');
  });

  it('never claims a cause it does not know', () => {
    const p = describeAuthError(null);
    expect(p.code).toBe('unknown');
    expect(p.body).not.toMatch(/password|roster/i);
  });
});

describe('describeAdminProbeError', () => {
  it('reads a missing is_admin() as an un-run migration', () => {
    const p = describeAdminProbeError({ message: "Could not find the function public.is_admin in the schema cache", code: 'PGRST202' });
    expect(p.code).toBe('function_missing');
    expect(p.hint).toMatch(/0004_admin\.sql/);
  });

  it('passes anything else through the auth mapping', () => {
    expect(describeAdminProbeError({ message: 'Failed to fetch', name: 'TypeError' }).code).toBe('network');
  });
});

describe('accountCandidates', () => {
  it('uses a typed address exactly as typed', () => {
    expect(accountCandidates(' razalpa64@gmail.com ')).toEqual(['razalpa64@gmail.com']);
  });

  it('maps a bare username onto the synthetic domain', () => {
    expect(accountCandidates('Razal')[0]).toMatch(/@pikachu\.arcade$/);
  });

  it('has nothing to try for empty input', () => {
    expect(accountCandidates('   ')).toEqual([]);
  });
});

describe('allowlistSql', () => {
  it('prefills the session id and is idempotent', () => {
    const sql = allowlistSql('0f1e2d3c-aaaa-bbbb-cccc-1234567890ab', 'razalpa64@gmail.com');
    expect(sql).toContain("'0f1e2d3c-aaaa-bbbb-cccc-1234567890ab'");
    expect(sql).toMatch(/on conflict \(user_id\) do nothing/);
    expect(sql).toContain('-- razalpa64@gmail.com');
  });

  it('asks for the id rather than guessing by email when the id is unknown', () => {
    expect(allowlistSql(null, null)).toMatch(/Authentication/);
  });

  it('cannot break out of a SQL comment with a crafted address', () => {
    expect(allowlistSql('id', 'x*/\nselect 1')).not.toContain('*/\nselect');
  });
});

describe('missingEnvNames', () => {
  it('names the variable, not the symptom', () => {
    expect(missingEnvNames({ hasUrl: false, hasKey: false, secretRefused: false })).toEqual([
      'VITE_SUPABASE_URL',
      'VITE_SUPABASE_PUBLISHABLE_KEY',
    ]);
  });

  it('explains a refused secret key', () => {
    expect(missingEnvNames({ hasUrl: true, hasKey: false, secretRefused: true }).join(' ')).toMatch(/secret key/i);
  });
});

/* ---------------------------------------------------------------- sign in */

const rpc = vi.fn();
const signIn = vi.fn();
const getUser = vi.fn();

vi.mock('../supabase', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../supabase')>();
  return {
    ...actual,
    supabaseEnabled: () => true,
    supabaseConfigState: () => ({
      configured: true, hasUrl: true, hasKey: true, secretRefused: false, projectHost: 'demo.supabase.co',
    }),
    supabase: async () => ({
      rpc,
      auth: { signInWithPassword: signIn, getUser, signOut: vi.fn() },
    }),
  };
});

describe('signInAdmin / probeAdmin', () => {
  beforeEach(() => {
    rpc.mockReset();
    signIn.mockReset();
    getUser.mockReset();
  });

  afterEach(() => vi.resetModules());

  it('opens for a roster account', async () => {
    const { signInAdmin } = await import('../admin');
    signIn.mockResolvedValue({ data: { user: { id: 'u1', email: 'razalpa64@gmail.com', user_metadata: { display_name: 'Razal' } } }, error: null });
    rpc.mockResolvedValue({ data: true, error: null });
    const result = await signInAdmin('razalpa64@gmail.com', 'pw');
    expect(result).toMatchObject({ ok: true, admin: true, name: 'Razal', userId: 'u1' });
    expect(result.problem).toBeUndefined();
  });

  it('keeps the session but explains the roster when is_admin() says no', async () => {
    const { signInAdmin } = await import('../admin');
    signIn.mockResolvedValue({ data: { user: { id: 'u2', email: 'someone@example.com', user_metadata: {} } }, error: null });
    rpc.mockResolvedValue({ data: false, error: null });
    const result = await signInAdmin('someone@example.com', 'pw');
    expect(result).toMatchObject({ ok: true, admin: false, userId: 'u2' });
    expect(result.problem?.code).toBe('not_admin');
    /* The fix is a prefilled row, not a vague "ask an admin". */
    expect(result.problem?.sql).toContain("'u2'");
  });

  it('reports a missing migration instead of "not on the roster"', async () => {
    const { signInAdmin } = await import('../admin');
    signIn.mockResolvedValue({ data: { user: { id: 'u3', email: 'a@b.c', user_metadata: {} } }, error: null });
    rpc.mockResolvedValue({ data: null, error: { message: 'Could not find the function public.is_admin', code: 'PGRST202' } });
    const result = await signInAdmin('a@b.c', 'pw');
    expect(result.admin).toBe(false);
    expect(result.problem?.code).toBe('function_missing');
  });

  it('does not retry an unconfirmed email against other addresses', async () => {
    const { signInAdmin } = await import('../admin');
    signIn.mockResolvedValue({ data: { user: null }, error: { message: 'Email not confirmed', status: 400 } });
    const result = await signInAdmin('Razal', 'pw');
    expect(signIn).toHaveBeenCalledTimes(1);
    expect(result.problem?.code).toBe('email_not_confirmed');
  });

  it('needs both fields', async () => {
    const { signInAdmin } = await import('../admin');
    const result = await signInAdmin('  ', '');
    expect(result.problem?.code).toBe('missing_fields');
    expect(signIn).not.toHaveBeenCalled();
  });

  it('probeAdmin distinguishes "no" from "could not ask"', async () => {
    const { probeAdmin } = await import('../admin');
    rpc.mockResolvedValueOnce({ data: false, error: null });
    expect(await probeAdmin()).toEqual({ state: 'no' });
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'Failed to fetch', name: 'TypeError' } });
    expect((await probeAdmin()).state).toBe('error');
  });
});
