/**
 * Reading a project's user list, and the two questions it answers.
 *
 * "Invalid login credentials" means one thing — Supabase found no user with that
 * address and that password — but it has several causes, and they are only
 * distinguishable by looking at the project's own user table:
 *
 *   - the account was never created;
 *   - it exists at a *different* address (a typo, a `+tag`, or the username
 *     domain this app mints: `name@pikachu.arcade`);
 *   - it exists, at that address, with a *different* password.
 *
 * The first two are visible in a user list; the third is not, which is why the
 * answer to it is "set a new one" rather than "guess". These helpers are pure so
 * both the browser and `scripts/admin-doctor.ts` can use them, and so the
 * matching rules can be tested instead of trusted.
 */
import { addressFor, isEmailLike } from './authAddress';

export interface AccountRow {
  id: string;
  email: string | null;
  /** Supabase will not issue a session until this is true. */
  confirmed: boolean;
  createdAt?: string | null;
  /** Whether `public.admin_users` lists it, when the roster was readable. */
  admin?: boolean;
}

const local = (email: string | null | undefined) => (email ?? '').toLowerCase().split('@')[0] ?? '';
const domain = (email: string | null | undefined) => (email ?? '').toLowerCase().split('@')[1] ?? '';

/** The account at exactly this address — as typed, or as the username rule would spell it. */
export function findAccount(users: AccountRow[], input: string): AccountRow | null {
  const wanted = addressFor(input);
  if (!wanted) return null;
  const target = wanted.toLowerCase();
  return users.find((u) => (u.email ?? '').toLowerCase() === target) ?? null;
}

/**
 * Accounts that might be the one somebody meant.
 *
 * Not a search engine: it is checked against a list of a few dozen accounts, and
 * its whole job is to turn "no user with that address" into "*this* is the
 * address you have". So it only proposes things that share real characters — a
 * prefix of the local part (3+ characters), the same local part on another
 * domain, or the same domain with a local part that contains the typed word.
 */
export function nearMisses(users: AccountRow[], input: string, limit = 4): AccountRow[] {
  const wanted = addressFor(input);
  if (!wanted) return [];
  const wl = local(wanted);
  const wd = domain(wanted);
  const scored: { user: AccountRow; score: number }[] = [];
  for (const user of users) {
    const email = (user.email ?? '').toLowerCase();
    if (!email || email === wanted.toLowerCase()) continue;
    const ul = local(email);
    const ud = domain(email);
    let score = 0;
    if (ul === wl && ud !== wd) score = 3;                                  // same person, other project/domain
    else if (wl.length >= 3 && ul.startsWith(wl)) score = 2;                // razal → razalpa64
    else if (ul.length >= 3 && wl.startsWith(ul)) score = 2;                // razalpa64 → razal
    else if (wd && ud === wd && ul.length >= 3 && (ul.includes(wl) || wl.includes(ul))) score = 1;
    if (score) scored.push({ user, score });
  }
  return scored
    .sort((a, b) => b.score - a.score || String(a.user.email).localeCompare(String(b.user.email)))
    .slice(0, limit)
    .map((s) => s.user);
}

/**
 * A password nobody has to invent.
 *
 * Used by `admin:doctor -- --setup --generate`, printed once to the terminal and
 * stored nowhere in this repository. Uses the platform CSPRNG, avoids characters
 * that are hard to read aloud (`l`, `1`, `I`, `O`, `0`), and guarantees one of
 * each class so it survives any "must contain" rule a project might have.
 */
export function generatePassword(length = 20): string {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnopqrstuvwxyz';
  const digits = '23456789';
  const symbols = '!@#$%^&*-_=+';
  const all = upper + lower + digits + symbols;
  const pick = (set: string) => {
    const limit = 256 - (256 % set.length);
    const buf = new Uint8Array(1);
    for (;;) {
      globalThis.crypto.getRandomValues(buf);
      if (buf[0] < limit) return set[buf[0] % set.length];
    }
  };
  const out = [pick(upper), pick(lower), pick(digits), pick(symbols)];
  while (out.length < Math.max(8, length)) out.push(pick(all));
  /* Deterministic-looking shuffle, cryptographic randomness. */
  for (let i = out.length - 1; i > 0; i -= 1) {
    const limit = 256 - (256 % (i + 1));
    const buf = new Uint8Array(1);
    do { globalThis.crypto.getRandomValues(buf); } while (buf[0] >= limit);
    const j = buf[0] % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out.join('');
}

/** One line about an account, for a terminal or a screen. */
export function describeAccount(user: AccountRow): string {
  const state = user.confirmed ? 'confirmed' : 'EMAIL NOT CONFIRMED';
  const roster = user.admin === undefined ? '' : user.admin ? ' · on the roster' : ' · not on the roster';
  return `${user.email ?? '(no email)'} — ${state}${roster} · id ${user.id}`;
}

/** True when the typed thing could be an address at all (a link needs one). */
export const canSendLink = (input: string): boolean => isEmailLike(input.trim()) || input.includes('@');
