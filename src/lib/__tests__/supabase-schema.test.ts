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

const MIGRATIONS = ['0001_init.sql', '0002_accounts_and_chat.sql', '0003_feedback.sql'];

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
          and c.relname in ('profiles','match_results','player_stats','feedback','room_messages')`,
    );
    expect(rows).toHaveLength(5);
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
