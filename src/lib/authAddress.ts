/**
 * Addresses, without a Supabase client attached.
 *
 * `usernameToEmail` lived in `supabase.ts`, which reads `import.meta.env` at
 * module scope — so anything that only wanted the address rule (a Node script,
 * a pure test) had to pull in the browser client to get it. It lives here now,
 * and `supabase.ts` re-exports it so the public API has not moved.
 */

/** Something with an `@` and a dot after it. Deliberately loose: Supabase decides. */
export function isEmailLike(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

/**
 * The address a username lives at.
 *
 * This app mints `<name>@pikachu.arcade` for anyone who signs up with a
 * username rather than an address, which is why a bare word in the admin form
 * cannot possibly match an account that was created in the dashboard with a
 * real Gmail address — the most common way to land on "no user with this
 * address and password combination".
 */
export function usernameToEmail(username: string): string {
  const clean = username.trim().toLowerCase().replace(/[^a-z0-9_.-]/g, '');
  return `${clean || 'trainer'}@pikachu.arcade`;
}

/** What the app would try for what was typed: an address as typed, a word as a username. */
export function addressFor(input: string): string | null {
  const typed = input.trim();
  if (!typed) return null;
  if (typed.includes('@')) return typed;
  return usernameToEmail(typed);
}
