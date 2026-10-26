/**
 * The admin door, and why it sometimes does not open.
 *
 * `/admin` has exactly four ways to fail, and until now all four produced the
 * same shrug: a red line saying "Sign-in failed", or a page that never explains
 * itself. They need four different answers, because they need four different
 * fixes:
 *
 *   1. **the build has no Supabase keys** — nothing can be signed in to, and the
 *      fix is an `.env` file and a restart, not a password;
 *   2. **the address or password is wrong** — often because a bare username is
 *      looked up as `name@pikachu.arcade` while the account was created with a
 *      real email address;
 *   3. **the email is unconfirmed** — Supabase refuses the sign-in outright, and
 *      the fix is one click in the dashboard or one `--fix` from the doctor;
 *   4. **the account is fine but the roster does not list it** — the migration
 *      ran, the account exists, and nobody ever inserted the `admin_users` row.
 *
 * This file is the mapping from "what the API said" to "what to do about it",
 * plus the two strings the UI needs: the address a bare username actually tried,
 * and the exact SQL that allowlists the account. It is pure, so the mapping is
 * tested rather than eyeballed (`adminAuth.test.ts`).
 */
import { usernameToEmail } from './supabase';

export type AdminAuthCode =
  | 'no_cloud'
  | 'missing_fields'
  | 'invalid_credentials'
  | 'email_not_confirmed'
  | 'rate_limited'
  | 'banned'
  | 'network'
  | 'server'
  | 'function_missing'
  | 'not_admin'
  | 'unknown';

export interface AdminAuthProblem {
  code: AdminAuthCode;
  /** One line, sentence case, no trailing full stop — it is a heading. */
  title: string;
  /** What actually happened, in plain words. */
  body: string;
  /** The next action, when there is a single obvious one. */
  hint?: string;
  /** SQL that fixes it, when a paste is genuinely the fix. */
  sql?: string;
}

/** What a Supabase auth error looks like once it has been flattened. */
export interface RawAuthError {
  message?: string;
  code?: string;
  status?: number;
  name?: string;
}

const has = (haystack: string, ...needles: string[]) =>
  needles.some((n) => haystack.includes(n));

/**
 * Turn whatever came back into something a person can act on.
 *
 * Order matters: an unconfirmed address also fails with a 400, and a rate limit
 * also mentions nothing useful, so the specific phrases are checked before the
 * generic status codes.
 */
export function describeAuthError(raw: RawAuthError | null | undefined): AdminAuthProblem {
  const message = String(raw?.message ?? '').trim();
  const lower = message.toLowerCase();
  const code = String(raw?.code ?? '');

  if (!raw || (!message && !code && !raw.status && !raw.name)) {
    return {
      code: 'unknown',
      title: 'Sign-in failed',
      body: 'The auth service refused the attempt without saying why.',
      hint: 'Try once more; if it keeps happening, run `npm run admin:doctor`.',
    };
  }

  if (has(lower, 'email not confirmed', 'email_not_confirmed') || code === 'email_not_confirmed') {
    return {
      code: 'email_not_confirmed',
      title: 'This account has not confirmed its email',
      body: 'The password was accepted, but Supabase will not issue a session until the address is confirmed.',
      hint:
        'Confirm it in Supabase → Authentication → Users (the ⋯ menu → “Confirm email”), ' +
        'or run `npm run admin:doctor -- --fix`.',
    };
  }

  if (has(lower, 'invalid login credentials', 'invalid_credentials') || code === 'invalid_credentials') {
    return {
      code: 'invalid_credentials',
      title: 'That address and password do not match an account',
      body: 'Supabase found no user with this address and password combination.',
      hint: 'Check the address — a bare username is looked up as that-name@pikachu.arcade.',
    };
  }

  if (has(lower, 'rate limit', 'too many requests', 'over_request_rate_limit', 'over_email_send_rate_limit')) {
    return {
      code: 'rate_limited',
      title: 'Too many attempts',
      body: 'Supabase is rate-limiting sign-ins from this address for a few minutes.',
      hint: 'Wait about five minutes, then try once — not repeatedly, which extends the limit.',
    };
  }

  if (has(lower, 'banned', 'user_banned')) {
    return {
      code: 'banned',
      title: 'This account is banned',
      body: 'Supabase has this user marked as banned, so no session is issued.',
      hint: 'Unban it in Authentication → Users, then sign in again.',
    };
  }

  if (has(lower, 'failed to fetch', 'networkerror', 'load failed', 'econnrefused') || raw.name === 'TypeError') {
    return {
      code: 'network',
      title: 'The auth service could not be reached',
      body: 'The request never arrived — wrong project URL, no connection, or a blocked domain.',
      hint: 'Check VITE_SUPABASE_URL in .env points at the project (https://<ref>.supabase.co).',
    };
  }

  if ((raw.status ?? 0) >= 500 || has(lower, 'internal server error', 'service unavailable')) {
    return {
      code: 'server',
      title: 'Supabase returned a server error',
      body: message || 'The project answered with a 5xx.',
      hint: 'That is their side. Check the project’s status, then try again.',
    };
  }

  return {
    code: 'unknown',
    title: 'Sign-in failed',
    body: message || 'The auth service refused the attempt.',
    hint: 'If the message means nothing to you, run `npm run admin:doctor` for a diagnosis.',
  };
}

/** The `is_admin()` call itself failed — usually because migration 0004 is missing. */
export function describeAdminProbeError(raw: RawAuthError | null | undefined): AdminAuthProblem {
  const message = String(raw?.message ?? '').toLowerCase();
  const code = String(raw?.code ?? '');
  if (code === 'PGRST202' || has(message, 'could not find the function', 'schema cache')) {
    return {
      code: 'function_missing',
      title: 'The admin schema is not installed',
      body: 'The database answered, but there is no public.is_admin() to ask — so no account can be on the roster.',
      hint: 'Run supabase/migrations/0004_admin.sql in the SQL editor, then reload this page.',
    };
  }
  return describeAuthError(raw);
}

/** An account that plainly is not on the roster. */
export function notOnRosterProblem(userId: string | null, email: string | null): AdminAuthProblem {
  return {
    code: 'not_admin',
    title: 'Signed in — but this account is not on the roster',
    body:
      'The password worked and the session is real. Authority is a row in public.admin_users, and this ' +
      'account has none, so the desk stays shut. That is the design: guessing this URL grants nothing.',
    hint: 'Run this once in the Supabase SQL editor, then reload.',
    sql: allowlistSql(userId, email),
  };
}

/**
 * The addresses worth trying for what was typed.
 *
 * A typed address is used exactly as typed. A bare word is a username, and the
 * app's usernames live on a synthetic domain — which is worth *saying* out loud
 * when it fails, because an account created in the Supabase dashboard with a
 * real email address will never match `razal@pikachu.arcade`.
 */
export function accountCandidates(input: string): string[] {
  const typed = input.trim();
  if (!typed) return [];
  if (typed.includes('@')) return [typed];
  const synthetic = usernameToEmail(typed);
  return synthetic && synthetic !== typed ? [synthetic] : [];
}

/**
 * The SQL that puts an account on the roster.
 *
 * Prefilled with the id the session actually has, so the fix is a copy and a
 * paste rather than a query the user has to assemble from the docs. It is
 * deliberately id-based: `where lower(email) = …` silently does nothing when the
 * address is spelled differently, which is one of the ways people end up here.
 */
export function allowlistSql(userId: string | null, email: string | null): string {
  const who = userId ? `'${userId}'` : 'null /* paste the user id from Authentication → Users */';
  const comment = email ? `-- ${email.replace(/\*\//g, '* /')}\n` : '';
  return (
    `${comment}insert into public.admin_users (user_id, note)\n` +
    `values (${who}, 'owner')\n` +
    'on conflict (user_id) do nothing;'
  );
}

/** Which build-time variables are present — names only, never values. */
export function missingEnvNames(state: {
  hasUrl: boolean;
  hasKey: boolean;
  secretRefused: boolean;
}): string[] {
  const missing: string[] = [];
  if (!state.hasUrl) missing.push('VITE_SUPABASE_URL');
  if (!state.hasKey) missing.push('VITE_SUPABASE_PUBLISHABLE_KEY');
  if (state.secretRefused) missing.push('(a secret key was refused — replace it with the publishable one)');
  return missing;
}
