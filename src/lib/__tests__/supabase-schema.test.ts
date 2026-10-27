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
  '0005_friends_and_safety.sql',
  '0006_dos.sql',
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
                            'admin_users','retro_games','site_content','admin_audit',
                            'friendships','blocks','reports')`,
    );
    expect(rows).toHaveLength(12);
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

describe('two platforms on one shelf (0006)', () => {
  /* The admin layer above proves who may write. This proves that *what* they
     write cannot smuggle a DOS bundle into a GBA row or vice versa: the player
     picks an emulator from `platform`, so a mismatch would hand a .jsdos archive
     to an emulator that expects a cartridge header. */
  const insert = (over: Record<string, unknown> = {}) => {
    const row = {
      id: 'doomed', platform: 'dos', title: 'Doomed', author: 'Someone', license: 'MIT',
      license_url: 'https://example.com/L', source_url: 'https://example.com/S',
      bytes: 40 * 1024 * 1024, rom_path: 'doomed/game.jsdos', cover_path: 'doomed/cover.png',
      status: 'draft', accent: '#f2c14e', year: 1993, ...over,
    };
    return asUser(ADMIN_ID, () => db.query(
      `insert into public.retro_games
         (id, platform, title, author, license, license_url, source_url, bytes, rom_path, cover_path, status, accent, year)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [row.id, row.platform, row.title, row.author, row.license, row.license_url, row.source_url,
        row.bytes, row.rom_path, row.cover_path, row.status, row.accent, row.year],
    ));
  };

  it('stores a DOS bundle with the paths DOS actually uses', async () => {
    await expect(insert()).resolves.toBeTruthy();
    const row = await asUser(ADMIN_ID, () => db.query<{ platform: string; rom_path: string }>(
      `select platform, rom_path from public.retro_games where id = 'doomed'`));
    expect(row.rows[0]).toEqual({ platform: 'dos', rom_path: 'doomed/game.jsdos' });
  });

  it('refuses the wrong container for the platform', async () => {
    for (const over of [
      { rom_path: 'doomed/rom.gba' },                          // DOS row, GBA path
      { platform: 'gba' },                                     // GBA row, DOS path
      { platform: 'gba', rom_path: 'doomed/rom.gba', bytes: 40 * 1024 * 1024 }, // GBA over 32 MB
      { platform: 'windows' },                                 // not a platform we host
      { bytes: 49 * 1024 * 1024 },                             // past the DOS ceiling
    ]) {
      await expect(insert({ id: 'doomed-two', ...over }), JSON.stringify(over))
        .rejects.toThrow(/check constraint|violates|invalid input/i);
    }
  });

  it('keeps a draft DOS bundle off the public shelf, like any other draft', async () => {
    const anon = await asUser(null, () => db.query<{ id: string }>('select id from public.retro_games'), 'anon');
    /* The published cartridges from the suites above are still visible; the draft
       DOS bundle is not, which is the only claim this test makes. */
    expect(anon.rows.map((r) => r.id)).not.toContain('doomed');
    await asUser(ADMIN_ID, () => db.query(`delete from public.retro_games where id = 'doomed'`));
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

/* ------------------------------------------------- friends, blocks, reports */

const IDA = 'aaaaaaaa-1111-1111-1111-111111111111';
const IDB = 'bbbbbbbb-2222-2222-2222-222222222222';
const IDC = 'cccccccc-3333-3333-3333-333333333333';

/** A report filed by whoever the session belongs to. */
async function insertReport(over: Record<string, unknown> = {}) {
  const row: Record<string, any> = {
    reported: IDB, reported_handle: 'misty', reported_name: 'Misty',
    room_code: 'ABCDE', game_id: 'chess', category: 'harassment',
    message: 'They kept messaging after the match ended.', ...over,
  };
  return db.query(
    `insert into public.reports (reported, reported_handle, reported_name, room_code, game_id, category, message)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [row.reported, row.reported_handle, row.reported_name, row.room_code, row.game_id, row.category, row.message],
  );
}

const request = (from: string, to: string) => db.query(
  `insert into public.friendships (requester, addressee) values ($1, $2)`, [from, to],
);

describe('a handle is how a friend finds you', () => {
  beforeAll(async () => {
    await db.exec(`insert into auth.users (id, email, raw_user_meta_data) values
      ('${IDA}', 'ash@pallet.town',    '{"username":"Ash"}'),
      ('${IDB}', 'misty@cerulean.gym', '{"username":"misty"}'),
      ('${IDC}', 'brock@pewter.gym',   '{"username":"Ash"}')`);
  });

  it('is filled in from the username when it is free, and left empty when it is not', async () => {
    const { rows } = await db.query<{ id: string; handle: string | null }>(
      `select id, handle from public.profiles where id in ('${IDA}','${IDB}','${IDC}')`,
    );
    const byId = Object.fromEntries(rows.map((r) => [r.id, r.handle]));
    expect(byId[IDA], 'Ash claimed ash').toBe('ash');
    expect(byId[IDB]).toBe('misty');
    /* Brock asked to be "Ash" too. Rather than inventing "ash2", which nobody
       chose, the trigger leaves it empty and he picks one on /together. */
    expect(byId[IDC]).toBeNull();
    expect(rows.filter((r) => r.handle === 'ash')).toHaveLength(1);
  });

  it('can be chosen by its owner, and only in a usable shape', async () => {
    const mine = await asUser(IDC, () => db.query(
      `update public.profiles set handle = 'brock' where id = '${IDC}'`));
    expect(mine.affectedRows).toBe(1);

    for (const bad of ['Brock', 'ASH', 'ab', 'x'.repeat(21), 'brock!', 'with space']) {
      await expect(
        asUser(IDC, () => db.query(`update public.profiles set handle = $1 where id = '${IDC}'`, [bad])),
        `${bad} is not a handle`,
      ).rejects.toThrow(/check constraint|violates/i);
    }

    /* Uniqueness is case-insensitive: "ash" is taken even though it is spelled
       differently from anything else, and upper case never gets that far. */
    await expect(asUser(IDC, () => db.query(
      `update public.profiles set handle = 'ash' where id = '${IDC}'`)))
      .rejects.toThrow(/duplicate key|unique/i);

    const other = await asUser(IDC, () => db.query(
      `update public.profiles set handle = 'hijack' where id = '${IDA}'`));
    expect(other.affectedRows, 'you cannot rename somebody else').toBe(0);
  });

  it('is searched for by exact match only, and never by a stranger', async () => {
    const found = await asUser(IDA, () => db.query<{ handle: string }>(
      `select * from public.find_player('  MISTY ')`));
    expect(found.rows.map((r) => r.handle)).toEqual(['misty']);

    /* A prefix is not a directory listing. */
    for (const probe of ['mis', '', 'a']) {
      const partial = await asUser(IDA, () => db.query(`select * from public.find_player($1)`, [probe]));
      expect(partial.rows, `"${probe}" returns nobody`).toHaveLength(0);
    }

    const self = await asUser(IDA, () => db.query(`select * from public.find_player('ash')`));
    expect(self.rows, 'you cannot find yourself').toHaveLength(0);

    await expect(asUser(null, () => db.query(`select * from public.find_player('misty')`), 'anon'))
      .rejects.toThrow(/permission denied/i);
  });
});

describe('friend requests', () => {
  it('are written by the asker and read by both sides', async () => {
    await expect(asUser(IDA, () => request(IDA, IDB))).resolves.toBeTruthy();
    const mine = await asUser(IDA, () => db.query<{ status: string; direction: string }>(
      'select * from public.my_friends()'));
    expect(mine.rows).toEqual([expect.objectContaining({ status: 'pending', direction: 'outgoing' })]);

    const theirs = await asUser(IDB, () => db.query<{ direction: string; display_name: string }>(
      'select * from public.my_friends()'));
    expect(theirs.rows).toEqual([expect.objectContaining({ direction: 'incoming', display_name: 'Ash' })]);

    const outsider = await asUser(IDC, () => db.query('select * from public.my_friends()'));
    expect(outsider.rows, 'a third player sees nothing at all').toHaveLength(0);
    const rawOutsider = await asUser(IDC, () => db.query('select * from public.friendships'));
    expect(rawOutsider.rows).toHaveLength(0);
  });

  it('cannot be filed in somebody else’s name, or pre-accepted', async () => {
    /* The cache of one pair is taken, so these use a fresh pair of ids. */
    await expect(asUser(IDC, () => request(IDA, IDB)))
      .rejects.toThrow(/row-level security|duplicate key|unique/i);
    await expect(asUser(IDA, () => request(IDB, IDA)))
      .rejects.toThrow(/row-level security|duplicate key|unique/i);

    await db.exec(`insert into auth.users (id, email, raw_user_meta_data)
      values ('dddddddd-4444-4444-4444-444444444444', 'gary@pallet.town', '{"username":"gary"}')`);
    await expect(asUser(IDA, () => db.query(
      `insert into public.friendships (requester, addressee) values ('dddddddd-4444-4444-4444-444444444444', '${IDA}')`)))
      .rejects.toThrow(/row-level security/i);

    /* `status` is not an insertable column: the grant does not include it, and the
       policy demands 'pending' regardless. */
    await expect(asUser(IDA, () => db.query(
      `insert into public.friendships (requester, addressee, status)
       values ('${IDA}', 'dddddddd-4444-4444-4444-444444444444', 'accepted')`)))
      .rejects.toThrow(/permission denied/i);
  });

  it('are accepted by the person asked, and by nobody else', async () => {
    const asAsker = await asUser(IDA, () => db.query(
      `update public.friendships set status = 'accepted' where requester = '${IDA}'`));
    expect(asAsker.affectedRows, 'the asker cannot accept their own request').toBe(0);

    const asOutsider = await asUser(IDC, () => db.query(
      `update public.friendships set status = 'accepted' where requester = '${IDA}'`));
    expect(asOutsider.affectedRows).toBe(0);

    const accepted = await asUser(IDB, () => db.query(
      `update public.friendships set status = 'accepted', responded_at = now()
        where requester = '${IDA}' and status = 'pending'`));
    expect(accepted.affectedRows).toBe(1);

    for (const who of [IDA, IDB]) {
      const list = await asUser(who, () => db.query<{ status: string; direction: string }>(
        'select * from public.my_friends()'));
      expect(list.rows).toEqual([expect.objectContaining({ status: 'accepted', direction: 'mutual' })]);
    }
  });

  it('cannot be re-opened, and can be ended by either side', async () => {
    /* Accepting is the only transition. Flipping back to pending affects no row. */
    const reopened = await asUser(IDB, () => db.query(
      `update public.friendships set status = 'pending' where addressee = '${IDB}'`));
    expect(reopened.affectedRows).toBe(0);

    const wrongWay = await asUser(IDB, () => db.query(
      `update public.friendships set status = 'accepted' where addressee = '${IDA}'`));
    expect(wrongWay.affectedRows).toBe(0);

    const ended = await asUser(IDA, () => db.query(
      `delete from public.friendships where requester = '${IDA}' and addressee = '${IDB}'`));
    expect(ended.affectedRows).toBe(1);
    const gone = await asUser(IDB, () => db.query('select * from public.my_friends()'));
    expect(gone.rows).toHaveLength(0);
  });

  it('a decline simply leaves nothing behind', async () => {
    await asUser(IDB, () => request(IDB, IDC));
    const declined = await asUser(IDC, () => db.query(
      `delete from public.friendships where requester = '${IDB}' and addressee = '${IDC}'`));
    expect(declined.affectedRows).toBe(1);
    const asker = await asUser(IDB, () => db.query('select * from public.my_friends()'));
    expect(asker.rows, 'the asker is not told they were turned down').toHaveLength(0);
  });
});

describe('blocking', () => {
  it('is invisible to the person blocked', async () => {
    await asUser(IDA, () => db.query(
      `insert into public.blocks (blocker, blocked, reason) values ('${IDA}', '${IDB}', 'spam')`));

    const mine = await asUser(IDA, () => db.query<{ blocked: string }>(
      'select blocker, blocked, reason, created_at from public.blocks'));
    expect(mine.rows.map((r) => r.blocked)).toEqual([IDB]);

    const theirs = await asUser(IDB, () => db.query('select * from public.blocks'));
    expect(theirs.rows, 'the blocked player cannot see the row').toHaveLength(0);

    const deleted = await asUser(IDB, () => db.query(
      `delete from public.blocks where blocked = '${IDB}'`));
    expect(deleted.affectedRows, 'and cannot delete it').toBe(0);
  });

  it('ends any friendship or request between the two, in either direction', async () => {
    await asUser(IDB, () => request(IDB, IDC));
    await asUser(IDC, () => db.query(
      `update public.friendships set status = 'accepted' where requester = '${IDB}'`));
    const before = await asUser(IDC, () => db.query('select * from public.my_friends()'));
    expect(before.rows).toHaveLength(1);

    await asUser(IDC, () => db.query(
      `insert into public.blocks (blocker, blocked) values ('${IDC}', '${IDB}')`));
    const after = await asUser(IDC, () => db.query('select * from public.my_friends()'));
    expect(after.rows).toHaveLength(0);
    const still = await db.query<{ n: number }>('select count(*)::int as n from public.friendships');
    expect(still.rows[0].n, 'the row is gone, not just hidden').toBe(0);
  });

  it('stops new requests and hides the pair from search', async () => {
    await expect(asUser(IDB, () => request(IDB, IDA)))
      .rejects.toThrow(/row-level security/i);
    await expect(asUser(IDB, () => request(IDB, IDC)))
      .rejects.toThrow(/row-level security/i);

    const found = await asUser(IDB, () => db.query(`select * from public.find_player('ash')`));
    expect(found.rows, 'a blocked handle cannot be searched for').toHaveLength(0);
    const reverse = await asUser(IDA, () => db.query(`select * from public.find_player('misty')`));
    expect(reverse.rows).toHaveLength(0);

    /* The relay asks the same question, but from a machine it can trust. */
    const answer = await db.query<{ pair: boolean }>(
      `select public.blocked_pair('${IDA}', '${IDB}') as pair`);
    expect(answer.rows[0].pair).toBe(true);
    const strangers = await db.query<{ pair: boolean }>(
      `select public.blocked_pair('${IDA}', 'dddddddd-4444-4444-4444-444444444444') as pair`);
    expect(strangers.rows[0].pair).toBe(false);
  });

  it('cannot be aimed at yourself, and nobody can block on your behalf', async () => {
    await expect(asUser(IDA, () => db.query(
      `insert into public.blocks (blocker, blocked) values ('${IDA}', '${IDA}')`)))
      .rejects.toThrow(/row-level security|blocks_not_self|check constraint/i);
    await expect(asUser(IDB, () => db.query(
      `insert into public.blocks (blocker, blocked) values ('${IDA}', 'dddddddd-4444-4444-4444-444444444444')`)))
      .rejects.toThrow(/row-level security/i);
  });

  it('is removable by the blocker, after which they can be friends again', async () => {
    await asUser(IDA, () => db.query(
      `delete from public.blocks where blocker = '${IDA}' and blocked = '${IDB}'`));
    await expect(asUser(IDA, () => request(IDA, IDB))).resolves.toBeTruthy();
    await asUser(IDA, () => db.query(
      `delete from public.friendships where requester = '${IDA}' and addressee = '${IDB}'`));
  });
});

describe('reporting a player', () => {
  it('is written as yourself and read by admins alone', async () => {
    await expect(asUser(IDA, () => insertReport())).resolves.toBeTruthy();

    const mine = await asUser(IDA, () => db.query('select * from public.reports'));
    expect(mine.rows, 'the reporter cannot read the reports either').toHaveLength(0);
    /* The public has no grant at all here, so this is a refusal rather than an
       empty list — reports are not a wall anybody browses. */
    await expect(asUser(null, () => db.query('select * from public.reports'), 'anon'))
      .rejects.toThrow(/permission denied/i);

    const admin = await asUser(ADMIN_ID, () => db.query<{ reporter: string; category: string; status: string }>(
      'select reporter, category, status from public.reports'));
    expect(admin.rows).toEqual([expect.objectContaining({ reporter: IDA, category: 'harassment', status: 'open' })]);

    const triaged = await asUser(ADMIN_ID, () => db.query(
      `update public.reports set status = 'reviewed'`));
    expect(triaged.affectedRows).toBe(1);
  });

  it('cannot be filed in somebody else’s name, or with no text, or about nobody', async () => {
    await expect(asUser(IDB, () => db.query(
      `insert into public.reports (reporter, category, message)
       values ('${IDA}', 'spam', 'somebody else said this')`)))
      .rejects.toThrow(/permission denied/i);

    await expect(asUser(IDB, () => insertReport({ message: '   ' })))
      .rejects.toThrow(/check constraint/i);
    await expect(asUser(IDB, () => insertReport({ category: 'dislike' })))
      .rejects.toThrow(/check constraint/i);
    /* A report about a guest has no account to point at — that is allowed on
       purpose, because a stranger you played before signing in is exactly the
       person you might need to report. A report with nothing at all is not. */
    await expect(asUser(IDB, () => db.query(
      `insert into public.reports (category, message, reported_name) values ('spam', 'no subject', '')`)))
      .rejects.toThrow(/reports_have_a_subject|check constraint/i);

    await expect(asUser(null, () => insertReport(), 'anon'))
      .rejects.toThrow(/permission denied|row-level security/i);
  });

  it('refuses the sixth report in an hour from one account', async () => {
    for (let i = 0; i < 5; i++) {
      await expect(asUser(IDC, () => insertReport({ message: `that is not acceptable, report ${i + 1}` })))
        .resolves.toBeTruthy();
    }
    await expect(asUser(IDC, () => insertReport({ message: 'the sixth report in one hour' })))
      .rejects.toThrow(/several reports in the last hour/i);
  });
});
