/**
 * The Supabase schema, executed.
 *
 * `feedback-cloud.test.ts` proves the *client* sends the right things. This file
 * proves the *database* refuses the wrong ones — which is the only half that matters,
 * because the anon key is public and anyone can ignore the client entirely.
 *
 * It runs the real migration files, in order, against a real PostgreSQL (PGlite —
 * Postgres compiled to WASM, in memory) with the pieces Supabase provides stubbed in:
 * the `anon` / `authenticated` roles, `auth.users`, and `auth.uid()`. Then it connects
 * as `anon` and tries to do things it must not be able to do.
 *
 * If a migration is ever edited so that a column grant widens, a policy loosens or the
 * rate-limit trigger disappears, one of these fails.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';

const MIGRATIONS = [
  '0001_init.sql',
  '0002_accounts_and_chat.sql',
  '0003_feedback.sql',
  '0004_admin.sql',
];

/** The parts of a Supabase project that the migrations assume already exist. */
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
  /* Supabase's storage schema: 0004 makes the bucket public for reads and
     admin-only for writes, and that policy has to be creatable here. */
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
  /* Supabase grants these; the bucket policies in 0004 are what narrow them. */
  grant usage on schema storage to anon, authenticated;
  grant select on storage.buckets to anon, authenticated;
  grant all on storage.objects to anon, authenticated;
  grant usage on schema public to anon, authenticated;
  alter default privileges in schema public grant all on tables to anon, authenticated;
  alter default privileges in schema public grant all on sequences to anon, authenticated;
`;

let db: PGlite;
let devices = 0;
const freshDevice = () => `device-${String(++devices).padStart(8, '0')}`;

/** run `fn` with the connection acting as the public `anon` role, then restore */
async function asAnon<T>(fn: () => Promise<T>): Promise<T> {
  await db.exec('set role anon');
  try { return await fn(); } finally { await db.exec('reset role'); }
}

async function insertNote(over: Record<string, unknown> = {}) {
  const row: Record<string, any> = {
    kind: 'review', rating: 5, message: 'A genuinely good arcade, thank you.', game_id: 'chess',
    display_name: 'Ash', contact: null, device_id: freshDevice(), user_id: null, ...over,
  };
  return db.query(
    `insert into public.feedback (kind, rating, message, game_id, display_name, contact, device_id, user_id)
     values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
    [row.kind, row.rating, row.message, row.game_id, row.display_name, row.contact, row.device_id, row.user_id],
  );
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(BOOTSTRAP);
  for (const file of MIGRATIONS) {
    await db.exec(readFileSync(resolve(process.cwd(), 'supabase/migrations', file), 'utf8'));
  }
}, 60_000);

afterAll(async () => { await db?.close(); });

describe('the migrations', () => {
  it('apply in order and leave every table under RLS', async () => {
    const { rows } = await db.query<{ relname: string; relrowsecurity: boolean }>(
      `select c.relname, c.relrowsecurity
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r'
          and c.relname in ('profiles','match_results','player_stats','feedback','room_messages',
                            'admin_users','retro_games','site_content','admin_audit')`,
    );
    expect(rows).toHaveLength(9);
    for (const r of rows) expect(r.relrowsecurity, `${r.relname} has RLS enabled`).toBe(true);
  });

  it('creates a profile when someone signs up', async () => {
    await db.exec(`insert into auth.users (id, email, raw_user_meta_data)
      values ('11111111-1111-1111-1111-111111111111', 'ash@pallet.town', '{"display_name":"Ash"}')`);
    const { rows } = await db.query<{ display_name: string }>(
      `select display_name from public.profiles where id = '11111111-1111-1111-1111-111111111111'`,
    );
    expect(rows[0]?.display_name).toBe('Ash');
  });
});

describe('posting a review as the public', () => {
  it('is allowed', async () => {
    const out = await asAnon(() => insertNote({ message: 'River Stones is the best thing here.' }));
    expect(out.rows).toHaveLength(1);
  });

  it('shows up on the wall — and only its public columns', async () => {
    await asAnon(() => insertNote({ message: 'The lantern board is gorgeous on a phone.' }));
    const { rows } = await asAnon(() => db.query<{ message: string }>(
      `select id, created_at, kind, rating, message, game_id, display_name from public.feedback`,
    ));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((r) => /lantern board/.test(r.message))).toBe(true);
  });

  it('cannot read the contact field, the device id, the user id or the status', async () => {
    for (const col of ['contact', 'device_id', 'user_id', 'status']) {
      await expect(
        asAnon(() => db.query(`select ${col} from public.feedback`)),
        `${col} is not readable by anon`,
      ).rejects.toThrow(/permission denied/i);
    }
  });

  it('hides a note the owner marked hidden', async () => {
    const { rows } = await insertNote({ message: 'this one is going to be hidden' }) as { rows: { id: number }[] };
    await db.exec(`update public.feedback set status = 'hidden' where id = ${rows[0].id}`);
    const visible = await asAnon(() => db.query<{ id: number }>(`select id from public.feedback`));
    expect(visible.rows.some((r) => r.id === rows[0].id)).toBe(false);
    const still = await db.query<{ n: number }>(`select count(*)::int as n from public.feedback where id = ${rows[0].id}`);
    expect(still.rows[0].n, 'hidden means hidden, not deleted').toBe(1);
  });
});

describe('what the database refuses', () => {
  it('a review with no rating', async () => {
    await expect(asAnon(() => insertNote({ rating: null }))).rejects.toThrow(/feedback_review_needs_rating/);
  });

  it('a rating on something that is not a review', async () => {
    await expect(asAnon(() => insertNote({ kind: 'game', rating: 4 }))).rejects.toThrow(/feedback_only_reviews_rated/);
  });

  it('an out-of-range rating', async () => {
    await expect(asAnon(() => insertNote({ rating: 9 }))).rejects.toThrow(/check constraint/i);
  });

  it('an empty or over-long message', async () => {
    await expect(asAnon(() => insertNote({ message: '   ' }))).rejects.toThrow(/check constraint/i);
    await expect(asAnon(() => insertNote({ message: 'x'.repeat(1300) }))).rejects.toThrow(/check constraint/i);
  });

  it('a kind that is not one of the four', async () => {
    await expect(asAnon(() => insertNote({ kind: 'spam' }))).rejects.toThrow(/check constraint/i);
  });

  it('a note that claims somebody else’s account', async () => {
    await expect(asAnon(() => insertNote({ user_id: '22222222-2222-2222-2222-222222222222' })))
      .rejects.toThrow(/row-level security/i);
  });

  it('an edit or a delete from the browser', async () => {
    await expect(asAnon(() => db.query(`update public.feedback set message = 'edited' where id = 1`)))
      .rejects.toThrow(/permission denied/i);
    await expect(asAnon(() => db.query('delete from public.feedback')))
      .rejects.toThrow(/permission denied/i);
  });
});

describe('the rate limit', () => {
  it('refuses the sixth note from one device inside an hour', async () => {
    const device = freshDevice();
    for (let i = 0; i < 5; i++) {
      const out = await asAnon(() => insertNote({ device_id: device, message: `legitimate note number ${i + 1}` }));
      expect(out.rows).toHaveLength(1);
    }
    await expect(asAnon(() => insertNote({ device_id: device, message: 'the sixth note in one hour' })))
      .rejects.toThrow(/too many notes from this device/i);
  });
});

describe('the chat mirror', () => {
  it('accepts an append and refuses to be read back', async () => {
    /* No RETURNING on purpose: returning a row needs SELECT on it, and the whole point
       is that the browser has no SELECT grant here. `logRoomMessage()` inserts blind. */
    await expect(asAnon(() => db.query(
      `insert into public.room_messages (room_code, sender_id, sender_name, message)
       values ('ABCDE', 'member-1', 'Ash', 'good game')`,
    ))).resolves.toBeTruthy();
    await expect(asAnon(() => db.query('select * from public.room_messages')))
      .rejects.toThrow(/permission denied/i);
  });

  it('refuses an over-long message rather than storing it', async () => {
    await expect(asAnon(() => db.query(
      `insert into public.room_messages (room_code, sender_id, sender_name, message)
       values ('ABCDE', 'member-1', 'Ash', $1)`, ['x'.repeat(400)],
    ))).rejects.toThrow(/row-level security|check constraint/i);
  });
});

describe('private career data', () => {
  it('is invisible to the public, even for a real account', async () => {
    const { rows } = await asAnon(() => db.query<{ n: number }>('select count(*)::int as n from public.profiles'));
    expect(rows[0].n, 'anon sees no profiles at all').toBe(0);
    const stats = await asAnon(() => db.query<{ n: number }>('select count(*)::int as n from public.player_stats'));
    expect(stats.rows[0].n).toBe(0);
  });
});

/* ------------------------------------------------------------------ admin */

/** A stranger with a perfectly valid session, and the one allowlisted account. */
const ADMIN_ID = '33333333-3333-3333-3333-333333333333';
const MEMBER_ID = '44444444-4444-4444-4444-444444444444';

async function asUser<T>(id: string | null, fn: () => Promise<T>, role = 'authenticated'): Promise<T> {
  await db.exec(`set role ${role}`);
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [id ?? '']);
  try { return await fn(); } finally { await db.exec('reset role'); }
}

const cartridge = (over: Record<string, unknown> = {}) => ({
  id: 'night-shift', title: 'Night Shift', author: 'Someone', license: 'MIT',
  license_url: 'https://example.com/LICENSE', source_url: 'https://example.com/repo',
  bytes: 1024, rom_path: 'night-shift/rom.gba', cover_path: 'night-shift/cover.png',
  status: 'published', ...over,
});

describe('the admin roster', () => {
  it('is not readable by the browser, not even a row count', async () => {
    await db.exec(`insert into auth.users (id, email) values
      ('${ADMIN_ID}', 'razalpa64@gmail.com'), ('${MEMBER_ID}', 'someone@pallet.town')`);
    await db.exec(`insert into public.admin_users (user_id) values ('${ADMIN_ID}')`);

    for (const role of ['anon', 'authenticated']) {
      await expect(
        asUser(role === 'anon' ? null : MEMBER_ID, () => db.query('select * from public.admin_users'), role),
        `${role} cannot read the roster`,
      ).rejects.toThrow(/permission denied/i);
    }
  });

  it('answers is_admin() honestly, and nobody can talk it into yes', async () => {
    const anon = await asUser(null, () => db.query<{ admin: boolean }>(
      'select public.is_admin() as admin'), 'anon');
    expect(anon.rows[0].admin).toBe(false);

    const member = await asUser(MEMBER_ID, () => db.query<{ admin: boolean }>(
      'select public.is_admin() as admin'));
    expect(member.rows[0].admin, 'a normal account is not an admin').toBe(false);

    const admin = await asUser(ADMIN_ID, () => db.query<{ admin: boolean }>(
      'select public.is_admin() as admin'));
    expect(admin.rows[0].admin).toBe(true);

    /* The roster is the only way in: the claim cannot be forged because there is
       nothing to forge — authority is a row, not a token field. */
    await expect(asUser(MEMBER_ID, () => db.query(
      `insert into public.admin_users (user_id) values ('${MEMBER_ID}')`)))
      .rejects.toThrow(/permission denied/i);
  });
});

describe('uploaded cartridges', () => {
  it('can be written by the admin and read by everyone once published', async () => {
    await asUser(ADMIN_ID, () => db.query(
      `insert into public.retro_games (id, title, author, license, license_url, source_url, bytes, rom_path, cover_path, status)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'published')`,
      ['night-shift', 'Night Shift', 'Someone', 'MIT', 'https://example.com/L', 'https://example.com/S',
        1024, 'night-shift/rom.gba', 'night-shift/cover.png'],
    ));
    const seen = await asUser(null, () => db.query<{ n: number }>(
      'select count(*)::int as n from public.retro_games'), 'anon');
    expect(seen.rows[0].n).toBe(1);
  });

  it('hides a draft from the public but not from the admin', async () => {
    await asUser(ADMIN_ID, () => db.query(
      `insert into public.retro_games (id, title, author, license, license_url, source_url, bytes, rom_path, cover_path, status)
       values ('unfinished', 'Unfinished', 'Someone', 'MIT', 'https://example.com/L', 'https://example.com/S',
               1024, 'unfinished/rom.gba', 'unfinished/cover.png', 'draft')`,
    ));
    const anon = await asUser(null, () => db.query<{ id: string }>(
      'select id from public.retro_games'), 'anon');
    expect(anon.rows.map((r) => r.id)).toEqual(['night-shift']);

    const admin = await asUser(ADMIN_ID, () => db.query<{ id: string }>('select id from public.retro_games'));
    expect(admin.rows).toHaveLength(2);
  });

  it('refuses every write from a normal account and from a stranger', async () => {
    for (const [who, id] of [['a member', MEMBER_ID], ['the public', null]] as const) {
      const role = id ? 'authenticated' : 'anon';
      await expect(
        asUser(id, () => db.query(
          `insert into public.retro_games (id, title, author, license, license_url, source_url, bytes, rom_path, cover_path)
           values ('smuggled', 'Smuggled', 'Someone', 'MIT', 'https://example.com/L', 'https://example.com/S',
                   1024, 'smuggled/rom.gba', 'smuggled/cover.png')`), role),
        `${who} cannot upload`,
      ).rejects.toThrow(/row-level security|permission denied/i);

      /* An UPDATE from a non-admin is not an error — RLS simply matches no rows,
         which is why the assertion is about the row, not about a rejection. */
      const touched = await asUser(id, () => db.query(
        `update public.retro_games set status = 'published' where id = 'unfinished'`), role);
      expect(touched.affectedRows, `${who} cannot publish a draft`).toBe(0);

      const deleted = await asUser(id, () => db.query(
        `delete from public.retro_games where id = 'night-shift'`), role);
      expect(deleted.affectedRows, `${who} cannot delete a cartridge`).toBe(0);

      await expect(
        asUser(id, () => db.query(
          `insert into public.admin_audit (action) values ('pretend')`), role),
        `${who} cannot write to the audit log`,
      ).rejects.toThrow(/row-level security|permission denied/i);
    }

    const still = await asUser(null, () => db.query<{ n: number }>(
      'select count(*)::int as n from public.retro_games'), 'anon');
    expect(still.rows[0].n).toBe(1);
    const draft = await asUser(ADMIN_ID, () => db.query<{ status: string }>(
      `select status from public.retro_games where id = 'unfinished'`));
    expect(draft.rows[0].status, 'the draft is still a draft').toBe('draft');
  });

  it('keeps a row from describing itself as something it is not', async () => {
    const base = {
      id: 'canary',
      title: 'Canary',
      author: 'Someone',
      license: 'MIT',
      license_url: 'https://example.com/L',
      source_url: 'https://example.com/S',
      bytes: 1024,
      rom_path: 'canary/rom.gba',
      cover_path: 'canary/cover.png',
      status: 'draft',
      accent: '#ffd24d',
      year: null as number | null,
    };
    const insert = (row: typeof base) => asUser(ADMIN_ID, () => db.query(
      `insert into public.retro_games
         (id, title, author, license, license_url, source_url, bytes, rom_path, cover_path, status, accent, year)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [row.id, row.title, row.author, row.license, row.license_url, row.source_url, row.bytes,
        row.rom_path, row.cover_path, row.status, row.accent, row.year],
    ));

    const bad: Partial<typeof base>[] = [
      { id: 'Bad Id' },
      { id: 'x'.repeat(49) },
      { rom_path: '' },
      { rom_path: 'other-game/rom.gba' },
      { cover_path: 'canary/rom.gba' },
      { license_url: 'http://example.com/L' },
      { source_url: 'javascript:alert(1)' },
      { accent: 'red' },
      { bytes: 0 },
      { bytes: 33_554_433 },
      { status: 'live' },
      { title: '' },
      { title: 'x'.repeat(61) },
      { license: '' },
      { year: 1800 },
    ];
    for (const over of bad) {
      await expect(insert({ ...base, ...over }), JSON.stringify(over))
        .rejects.toThrow(/check constraint|violates|invalid input/i);
    }

    /* Nothing above was stored, and the honest row is accepted. */
    const rejected = await asUser(ADMIN_ID, () => db.query<{ n: number }>(
      `select count(*)::int as n from public.retro_games where id <> 'night-shift' and id <> 'unfinished'`));
    expect(rejected.rows[0].n).toBe(0);
    await expect(insert(base)).resolves.toBeTruthy();
    await asUser(ADMIN_ID, () => db.query(`delete from public.retro_games where id = 'canary'`));
  });

  it('lets the admin delete, and takes the audit trail with it', async () => {
    await asUser(ADMIN_ID, () => db.query(
      `insert into public.admin_audit (action, target) values ('retro.delete', 'unfinished')`));
    const log = await asUser(ADMIN_ID, () => db.query<{ action: string; actor: string | null }>(
      'select action, actor from public.admin_audit'));
    expect(log.rows[0].action).toBe('retro.delete');
    expect(log.rows[0].actor, 'the log records who did it, from the session').toBe(ADMIN_ID);

    await asUser(ADMIN_ID, () => db.query(`delete from public.retro_games where id = 'unfinished'`));
    const left = await asUser(ADMIN_ID, () => db.query<{ n: number }>(
      'select count(*)::int as n from public.retro_games'));
    expect(left.rows[0].n).toBe(1);
  });
});

describe('site copy', () => {
  it('is world-readable and admin-only to change', async () => {
    await asUser(ADMIN_ID, () => db.query(
      `insert into public.site_content (key, value) values ('retro.title', 'Cartridge Corner')`));
    const pub = await asUser(null, () => db.query<{ value: string }>(
      'select value from public.site_content'), 'anon');
    expect(pub.rows[0].value).toBe('Cartridge Corner');

    await expect(asUser(MEMBER_ID, () => db.query(
      `insert into public.site_content (key, value) values ('library.title', 'hijacked')`)))
      .rejects.toThrow(/row-level security|permission denied/i);

    const touched = await asUser(MEMBER_ID, () => db.query(
      `update public.site_content set value = 'hijacked' where key = 'retro.title'`));
    expect(touched.affectedRows, 'a member cannot rewrite the heading').toBe(0);
    const after = await asUser(null, () => db.query<{ value: string }>(
      `select value from public.site_content where key = 'retro.title'`), 'anon');
    expect(after.rows[0].value).toBe('Cartridge Corner');
  });
});

describe('the storage bucket', () => {
  it('is public to read and admin-only to write', async () => {
    const bucket = await db.query<{ public: boolean; file_size_limit: number }>(
      `select public, file_size_limit from storage.buckets where id = 'retro'`);
    expect(bucket.rows[0].public).toBe(true);
    expect(bucket.rows[0].file_size_limit).toBe(33554432);

    await expect(asUser(MEMBER_ID, () => db.query(
      `insert into storage.objects (bucket_id, name) values ('retro', 'night-shift/rom.gba')`)))
      .rejects.toThrow(/row-level security|permission denied|violates/i);

    const asAdmin = await asUser(ADMIN_ID, () => db.query(
      `insert into storage.objects (bucket_id, name) values ('retro', 'night-shift/rom.gba') returning id`));
    expect(asAdmin.rows).toHaveLength(1);

    /* The shelf is public: anyone can fetch a cartridge once it is stored. */
    const pub = await asUser(null, () => db.query<{ name: string }>(
      `select name from storage.objects where bucket_id = 'retro'`), 'anon');
    expect(pub.rows.map((r) => r.name)).toEqual(['night-shift/rom.gba']);
  });
});
