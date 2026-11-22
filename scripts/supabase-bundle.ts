/**
 * supabase/all.sql — every migration, in order, in one paste.
 *
 * The SQL editor is one page and one Run button. Asking somebody with a dozen
 * Supabase projects to paste seven files in the right order, into the right
 * project, is asking for the three failure modes this repo has already produced:
 * half the schema applied, two files swapped, or the whole set run against the
 * wrong project.
 *
 * So the combined file is **generated**, never hand-written. `supabase/migrations`
 * stays the source of truth; this script concatenates it in filename order inside
 * a single transaction, and the test suite executes the result against real
 * Postgres and asserts it produces the same database as the seven files do. If
 * they ever drift, the build fails rather than somebody's project silently
 * getting a partial schema.
 *
 *   npm run supabase:bundle           # regenerate supabase/all.sql
 *   npm run supabase:bundle -- --check  # fail if it is out of date (CI)
 *
 * Why one transaction: a paste that fails halfway otherwise leaves a project with
 * some tables and not others, which is worse than an empty one — the empty
 * project fails loudly, a half-applied one 404s on the one function you need and
 * looks like a code bug. Every migration in this set is idempotent on its own,
 * so all-or-nothing costs nothing.
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const DIR = resolve(process.cwd(), 'supabase/migrations');
const OUT = resolve(process.cwd(), 'supabase/all.sql');

/** The migration files, in the order their numeric prefix puts them. */
export function migrationFiles(): string[] {
  return readdirSync(DIR)
    .filter((f) => /^\d{4}_.*\.sql$/.test(f))
    .sort();
}

// Build the bundle. Each migration is verbatim, wrapped in a `-- ===` banner so a
// reader can still tell which file a statement came from.
//
// Banners are line comments, never block comments: the migrations carry block
// comments of their own, and nesting those is not valid SQL. (The same rule bit
// this file: a doc comment describing block comments contains one, which closes
// the doc comment early — hence plain `//` here.)
export function buildBundle(): string {
  const files = migrationFiles();
  if (!files.length) throw new Error('no migrations found — refusing to write an empty bundle');

  const parts = [
    `-- PIKACHU — full schema, one paste`,
    `--`,
    `-- Generated from supabase/migrations by \`npm run supabase:bundle\`. Do not edit by hand.`,
    `--`,
    `-- Run the whole thing once in the Supabase SQL editor (project -> SQL Editor ->`,
    `-- New query -> paste -> Run). It is wrapped in a single transaction, so it either`,
    `-- applies completely or not at all. It is also idempotent: running it again on a`,
    `-- project that already has the schema changes nothing.`,
    `--`,
    `-- Files included, in order:`,
    ...files.map((f) => `--   ${f}`),
    `--`,
    `-- What this does NOT do: create an admin, or create a user. Authority is a row in`,
    `-- public.admin_users, provisioned after sign-up with`,
    `--   npm run admin:doctor -- --setup --password`,
    `-- so no credential ever lives in this file or the git history.`,
    ``,
    `begin;`,
    ``,
  ];

  for (const file of files) {
    const sql = readFileSync(resolve(DIR, file), 'utf8').replace(/\s+$/, '');
    parts.push(
      `-- ============================================================ ${file}`,
      sql,
      ``,
    );
  }

  parts.push(
    `-- ============================================================ done`,
    `--`,
    `-- Sanity check, after ` + "`commit`" + ` lands — this must return 12 rows:`,
    `--   select table_name from information_schema.tables`,
    `--    where table_schema = 'public' order by table_name;`,
    `commit;`,
    ``,
  );

  return parts.join('\n');
}

/* ---------------------------------------------------------------- CLI */

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^.*?(?=scripts|src)/, ''));

if (isMain) {
  const check = process.argv.includes('--check');
  const bundle = buildBundle();

  if (check) {
    let existing = '';
    try { existing = readFileSync(OUT, 'utf8'); } catch { /* missing counts as stale */ }
    if (existing !== bundle) {
      console.error('[supabase:bundle] supabase/all.sql is out of date — run `npm run supabase:bundle`');
      process.exitCode = 1;
    } else {
      console.log('[supabase:bundle] up to date');
    }
  } else {
    writeFileSync(OUT, bundle);
    const files = migrationFiles();
    console.log(`[supabase:bundle] supabase/all.sql · ${files.length} migrations · ${(bundle.length / 1024).toFixed(1)} KB`);
  }
}
