/**
 * `supabase/all.sql` is what people actually paste, so it has to be proven.
 *
 * The migrations are the source of truth and the bundle is generated from them —
 * but "generated" is not "identical in effect". A truncated concat, a file
 * dropped by the sort, a missing `commit` all produce a file that looks fine and
 * builds half a database, and the failure surfaces later as a 404 on
 * `is_admin()` in a project that appeared to set up cleanly.
 *
 * So this file executes both against real Postgres (PGlite) and compares the
 * result: same tables, same columns, same policies, same functions, same bucket.
 * It also runs the bundle in one transaction and proves a failure rolls the whole
 * thing back, which is the property the single-paste format is chosen for.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';

const BUNDLE = resolve(process.cwd(), 'supabase/all.sql');

/** The same stub environment `supabase-schema.test.ts` needs, for the same reasons. */
const BOOTSTRAP = `
  create role anon nologin;
  create role authenticated nologin;
  create schema if not exists auth;
  create table if not exists auth.users (
    id uuid primary key,
    email text,
    raw_user_meta_data jsonb default '{}'::jsonb
  );
  create or replace function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  create schema if not exists storage;
  create table if not exists storage.buckets (
    id text primary key,
    name text not null,
    public boolean default false,
    file_size_limit bigint,
    allowed_mime_types text[]
  );
  create table if not exists storage.objects (
    id uuid primary key default gen_random_uuid(),
    bucket_id text not null references storage.buckets (id),
    name text not null
  );
  alter table storage.objects enable row level security;
  grant usage on schema storage to anon, authenticated;
  grant select on storage.buckets to anon, authenticated;
  grant all on storage.objects to anon, authenticated;
  grant usage on schema public to anon, authenticated;
  alter default privileges in schema public grant all on tables to anon, authenticated;
  alter default privileges in schema public grant all on sequences to anon, authenticated;
`;

/** Everything a schema is judged by, in a stable order. Not called `describe`:
 *  that name belongs to vitest, and a local one shadows it inside a test body. */
async function snapshot(db: PGlite) {
  const tables = await db.query<{ table_name: string }>(
    `select table_name from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE' order by 1`);
  const columns = await db.query<{ table_name: string; column_name: string; data_type: string; is_nullable: string }>(
    `select table_name, column_name, data_type, is_nullable
       from information_schema.columns where table_schema = 'public'
      order by 1, 2`);
  const policies = await db.query<{ tablename: string; policyname: string; cmd: string }>(
    `select tablename, policyname, cmd from pg_policies
      where schemaname = 'public' order by 1, 2`);
  const functions = await db.query<{ proname: string }>(
    `select p.proname from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' order by 1`);
  const triggers = await db.query<{ tgname: string; tbl: string }>(
    `select t.tgname, c.relname as tbl from pg_trigger t
       join pg_class c on c.oid = t.tgrelid
      where not t.tgisinternal order by 1`);
  const rls = await db.query<{ relname: string; relrowsecurity: boolean }>(
    `select c.relname, c.relrowsecurity from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' order by 1`);
  const bucket = await db.query<{ id: string; public: boolean; file_size_limit: string }>(
    `select id, public, file_size_limit::text from storage.buckets order by 1`);
  return {
    tables: tables.rows.map((r) => r.table_name),
    columns: columns.rows,
    policies: policies.rows,
    functions: functions.rows.map((r) => r.proname),
    triggers: triggers.rows,
    rls: rls.rows,
    bucket: bucket.rows,
  };
}

let bundleDb: PGlite;

beforeAll(async () => {
  bundleDb = new PGlite();
  await bundleDb.exec(BOOTSTRAP);
  /* Executed exactly as it will be pasted: whole file, one call. */
  await bundleDb.exec(readFileSync(BUNDLE, 'utf8'));
}, 60_000);

afterAll(async () => { await bundleDb?.close(); });

describe('supabase/all.sql', () => {
  it('builds the same database as the seven migrations', async () => {
    const files = execFileSync('ls', [resolve(process.cwd(), 'supabase/migrations')], { encoding: 'utf8' })
      .split('\n').filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();

    const stepwise = new PGlite();
    try {
      await stepwise.exec(BOOTSTRAP);
      for (const file of files) {
        await stepwise.exec(readFileSync(resolve(process.cwd(), 'supabase/migrations', file), 'utf8'));
      }
      const fromFiles = await snapshot(stepwise);
      const fromBundle = await snapshot(bundleDb);

      expect(fromBundle.tables).toEqual(fromFiles.tables);
      expect(fromBundle.columns).toEqual(fromFiles.columns);
      expect(fromBundle.policies).toEqual(fromFiles.policies);
      expect(fromBundle.functions).toEqual(fromFiles.functions);
      expect(fromBundle.triggers).toEqual(fromFiles.triggers);
      expect(fromBundle.rls).toEqual(fromFiles.rls);
      expect(fromBundle.bucket).toEqual(fromFiles.bucket);
    } finally {
      await stepwise.close();
    }
  }, 60_000);

  it('is up to date with the migrations it is generated from', () => {
    /* Regenerating must be a no-op. If somebody edits a migration and forgets to
       rebuild, this fails here rather than in somebody's project. */
    const before = readFileSync(BUNDLE, 'utf8');
    execFileSync('npx', ['tsx', 'scripts/supabase-bundle.ts'], {
      cwd: process.cwd(),
      encoding: 'utf8',
    });
    expect(readFileSync(BUNDLE, 'utf8')).toBe(before);
  }, 60_000);

  it('is all-or-nothing: a failure halfway leaves nothing behind', async () => {
    const db = new PGlite();
    try {
      await db.exec(BOOTSTRAP);
      /* A deliberately broken statement in the middle of a transaction. */
      await expect(db.exec(`
        begin;
        create table public.should_not_survive (id int);
        select * from public.this_function_does_not_exist();
        commit;
      `)).rejects.toThrow();

      /* The failed block leaves the session *inside* an aborted transaction —
         Postgres refuses everything after it until the client rolls back. That is
         worth knowing when reading a real SQL-editor error: the first message is
         the real one, and everything after it is this. */
      await db.exec('rollback');

      const left = await db.query<{ n: number }>(
        `select count(*)::int as n from information_schema.tables
          where table_schema = 'public' and table_name = 'should_not_survive'`);
      expect(left.rows[0].n, 'the rolled-back table must not exist').toBe(0);
    } finally {
      await db.close();
    }
  }, 60_000);

  it('carries the guards the whole account layer depends on', async () => {
    const fn = await bundleDb.query<{ proname: string }>(
      `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname in
          ('is_admin','handle_new_user','feedback_rate_limit','reports_rate_limit',
           'blocked_pair','my_friends','find_player','note_admin_change','list_admins')
        order by 1`);
    expect(fn.rows.map((r) => r.proname)).toEqual([
      'blocked_pair', 'feedback_rate_limit', 'find_player', 'handle_new_user',
      'is_admin', 'list_admins', 'my_friends', 'note_admin_change', 'reports_rate_limit',
    ]);

    const audit = await bundleDb.query<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_schema = 'public' and table_name = 'admin_audit' order by 1`);
    /* 0007's jsonb column — proves the bundle includes the newest migration. */
    expect(audit.rows.map((r) => r.column_name)).toContain('changes');

    const path = await bundleDb.query<{ pg_get_constraintdef: string }>(
      `select pg_get_constraintdef(oid) as pg_get_constraintdef from pg_constraint
        where conname = 'retro_games_rom_path'`);
    /* 0006's platform-aware paths — proves ordering, since 0006 alters 0004. */
    /* Postgres normalises the literal to `'/game.jsdos'::text`, so match the path
       rather than the quoting. Ordering is what this proves: 0006 *alters* a
       constraint 0004 created, so the dos branch only exists if it ran second. */
    expect(path.rows[0].pg_get_constraintdef).toContain('/game.jsdos');
    expect(path.rows[0].pg_get_constraintdef).toContain("platform = 'dos'");
  });

  it('keeps the setup guide honest about the repo', () => {
    /* docs/supabase-setup.md tells somebody to paste a file and run a script.
       If either moves or is renamed, the guide is worse than useless — it fails
       at the moment the reader has committed to following it. */
    const doc = readFileSync(resolve(process.cwd(), 'docs/supabase-setup.md'), 'utf8');

    expect(readFileSync(BUNDLE, 'utf8')).toContain('0007_admin_activity.sql');
    expect(doc).toContain('supabase/all.sql');
    expect(doc).toContain('npm run supabase:bundle');
    expect(doc).toContain('npm run admin:doctor -- --setup');
    expect(doc).toContain('npm run admin:doctor -- --project');
    /* A guide is a file people copy from. No credential may ever land in it —
       and `eyJhbGciOi` is the *header* of every Supabase JWT (it decodes to
       {"alg":"HS256","typ":"JWT"}), so it is prose, not a secret. What must never
       appear is a whole token: header, payload, signature. */
    expect(doc).not.toMatch(/sb_secret_[A-Za-z0-9]/);
    expect(doc).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/);
  });

  it('warns nobody by forgetting the transaction wrapper', () => {
    const text = readFileSync(BUNDLE, 'utf8');
    expect(text.trimEnd().endsWith('commit;'), 'the bundle must end with commit').toBe(true);
    expect(text).toMatch(/\nbegin;\n/);
  });
});
