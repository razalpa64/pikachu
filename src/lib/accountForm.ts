/**
 * Sign-up and sign-in rules, without a browser attached.
 *
 * The forms in `screens/Account.tsx` are the only caller today, but every rule
 * here is one a person can get wrong in a dozen ways — a two-character password,
 * a username with a space in it, an address with no dot after the `@` — and each
 * of those deserves its own sentence rather than a red box saying "invalid".
 * Keeping them pure means `accountForm.test.ts` can pin the sentences.
 */

export interface FieldProblem {
  field: 'username' | 'email' | 'password' | 'confirm' | 'form';
  message: string;
}

/** Usernames become `<name>@pikachu.arcade`, so they are an address local-part. */
export const USERNAME_MIN = 3;
export const USERNAME_MAX = 20;
export const PASSWORD_MIN = 8;

/**
 * The name a player picks.
 *
 * Deliberately narrow: it is rendered in rooms, on leaderboards and in the URL of
 * nothing, and it also has to survive being lowercased into an email local-part.
 * Letters, digits, dot, dash, underscore — no spaces, because "Ash Ketchum" would
 * silently become `ashketchum` and nobody would ever guess that signing in again
 * needs the space removed.
 */
export function checkUsername(raw: string): FieldProblem | null {
  const name = raw.trim();
  if (!name) return { field: 'username', message: 'Pick a trainer name.' };
  if (name.length < USERNAME_MIN) {
    return { field: 'username', message: `At least ${USERNAME_MIN} characters, please.` };
  }
  if (name.length > USERNAME_MAX) {
    return { field: 'username', message: `Keep it under ${USERNAME_MAX} characters.` };
  }
  if (!/^[a-zA-Z0-9._-]+$/.test(name)) {
    return {
      field: 'username',
      message: 'Letters, numbers, dots, dashes and underscores only — no spaces.',
    };
  }
  if (/^[._-]|[._-]$/.test(name)) {
    return { field: 'username', message: 'Cannot start or end with a dot, dash or underscore.' };
  }
  if (/^\d+$/.test(name)) {
    return { field: 'username', message: 'Add a letter too, so the name is yours.' };
  }
  return null;
}

/**
 * An optional recovery address.
 *
 * Optional because the app can mint one; but if a player types one, it has to be
 * a real address, because it is the only way back into the account.
 */
export function checkEmail(raw: string): FieldProblem | null {
  const value = raw.trim();
  if (!value) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value)) {
    return { field: 'email', message: 'That does not look like an email address.' };
  }
  return null;
}

/**
 * A password, judged the way an eight-year-old would ask: is it long enough.
 *
 * No character-class rules. "At least one symbol" produces `Password1!` for
 * everyone and makes the account *worse*; length is the part that actually costs
 * an attacker anything, and this is a Pokémon arcade, not a bank.
 */
export function checkPassword(raw: string): FieldProblem | null {
  if (!raw) return { field: 'password', message: 'Choose a password.' };
  if (raw.length < PASSWORD_MIN) {
    return { field: 'password', message: `At least ${PASSWORD_MIN} characters.` };
  }
  if (/^\s+$/.test(raw)) return { field: 'password', message: 'Not just spaces.' };
  return null;
}

export function checkConfirm(password: string, confirm: string): FieldProblem | null {
  if (!confirm) return { field: 'confirm', message: 'Type it once more.' };
  if (confirm !== password) return { field: 'confirm', message: 'The two passwords do not match.' };
  return null;
}

export interface SignUpDraft {
  username: string;
  email: string;
  password: string;
  confirm: string;
}

/** Every problem, in field order, so the form can show them all at once. */
export function validateSignUp(draft: SignUpDraft): FieldProblem[] {
  return [
    checkUsername(draft.username),
    checkEmail(draft.email),
    checkPassword(draft.password),
    checkConfirm(draft.password, draft.confirm),
  ].filter((p): p is FieldProblem => p !== null);
}

export interface SignInDraft {
  username: string;
  password: string;
}

export function validateSignIn(draft: SignInDraft): FieldProblem[] {
  const out: FieldProblem[] = [];
  if (!draft.username.trim()) {
    out.push({ field: 'username', message: 'Your trainer name or email.' });
  }
  if (!draft.password) out.push({ field: 'password', message: 'Your password.' });
  return out;
}

/**
 * Where to go after signing in.
 *
 * A player who was sent to sign in *from* a page should land back on that page.
 * The value comes from `?next=` and is therefore attacker-controlled, so only
 * same-site absolute paths are followed: `//evil.example` and `https://evil` both
 * start with a slash (or look like a path) and must fall through to the home page.
 */
export function safeNext(raw: string | null | undefined): string {
  if (!raw) return '/';
  if (!raw.startsWith('/') || raw.startsWith('//')) return '/';
  if (raw.includes('\\')) return '/';
  return raw;
}

/**
 * The rule the owner door follows: the same form for everyone, and the *answer*
 * comes from the server.
 *
 * There is no address, password or hint of one in this file. A player signs in
 * with exactly what an ordinary player signs in with; whether they then see a
 * dashboard is `public.admin_users` saying so, checked by Postgres on every
 * request. That is the only place the decision can safely live.
 */
export const SIGN_IN_COPY = {
  title: 'Sign in',
  lead: 'Your career, saves and achievements follow you between devices.',
} as const;
