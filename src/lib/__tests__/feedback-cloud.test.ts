// @vitest-environment jsdom
/**
 * The cloud half of the feedback box, against a fake Supabase client.
 *
 * Two things are worth pinning down here, because they are the ways a Supabase
 * integration actually breaks:
 *
 * 1. **The contract with Postgres.** The table name, the columns written, the columns
 *    read and the filters used are all restated in `0003_feedback.sql` (CHECK
 *    constraints, column grants, RLS). If the client starts sending `status`, or reads
 *    `contact`, the migration and the client disagree and the feature silently returns
 *    nothing. The tests below compare the two directly by reading the SQL file.
 * 2. **Failure is not loss.** A rejected insert must leave the note on the device,
 *    marked queued, and a later flush must deliver it.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { emptyDraft, flushFeedbackQueue, localNotes, readWall, submitFeedback, type FeedbackDraft } from '../feedback';

const fake = vi.hoisted(() => {
  const state = {
    inserted: [] as { table: string; row: Record<string, any> }[],
    selectArgs: [] as { table: string; columns: string }[],
    /** null = success, otherwise the error PostgREST would return */
    insertError: null as null | { message: string; code?: string },
    rows: [] as Record<string, any>[],
  };
  const client = {
    from(table: string) {
      return {
        insert(row: Record<string, any>) {
          state.inserted.push({ table, row });
          return Promise.resolve({ error: state.insertError });
        },
        select(columns: string) {
          state.selectArgs.push({ table, columns });
          const chain = {
            eq: () => chain,
            order: () => chain,
            limit: () => Promise.resolve({ data: state.rows, error: null }),
          };
          return chain;
        },
      };
    },
  };
  return { state, client };
});

vi.mock('../supabase', () => ({
  supabaseEnabled: () => true,
  supabase: async () => fake.client,
}));

const draft = (over: Partial<FeedbackDraft> = {}): FeedbackDraft => ({
  ...emptyDraft('Volt'), rating: 5, message: 'River Stones is the best thing here and nobody knows it.', ...over,
});

const SQL = readFileSync(resolve(process.cwd(), 'supabase/migrations/0003_feedback.sql'), 'utf8');

beforeEach(() => {
  localStorage.clear();
  fake.state.inserted.length = 0;
  fake.state.selectArgs.length = 0;
  fake.state.insertError = null;
  fake.state.rows = [];
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('what the client sends Postgres', () => {
  it('writes to public.feedback with exactly the granted columns', async () => {
    const out = await submitFeedback(draft(), { playerId: 'device-abcdef' });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.mode).toBe('cloud');

    expect(fake.state.inserted).toHaveLength(1);
    const { table, row } = fake.state.inserted[0];
    expect(table).toBe('feedback');
    expect(Object.keys(row).sort()).toEqual(
      ['contact', 'device_id', 'display_name', 'game_id', 'kind', 'message', 'rating', 'user_id'],
    );
    // `status` is deliberately absent: the column grant does not include it, and the
    // default plus the RLS policy are what force every note to be published.
    expect(row).not.toHaveProperty('status');
    expect(row.kind).toBe('review');
    expect(row.rating).toBe(5);
    expect(row.display_name).toBe('Volt');
  });

  it('never sends a rating for a game idea', async () => {
    await submitFeedback(draft({ kind: 'game', rating: 5 }), { playerId: 'device-abcdef' });
    expect(fake.state.inserted[0].row).toMatchObject({ kind: 'game', rating: null });
  });

  it('marks a delivered note as sent, so it is not flushed twice', async () => {
    await submitFeedback(draft(), { playerId: 'device-abcdef' });
    expect(localNotes()[0].state).toBe('sent');
    await expect(flushFeedbackQueue({ playerId: 'device-abcdef' })).resolves.toBe(0);
    expect(fake.state.inserted).toHaveLength(1);
  });
});

describe('when the insert fails', () => {
  it('keeps a note that hit a transient error, tells the truth, and retries later', async () => {
    fake.state.insertError = { message: 'connection reset by peer', code: '08006' };
    const out = await submitFeedback(draft(), { playerId: 'device-abcdef' });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.mode).toBe('local');
    expect(localNotes()).toHaveLength(1);
    expect(localNotes()[0].state).toBe('queued');

    // the queue drains once the database is happy again
    fake.state.insertError = null;
    fake.state.inserted.length = 0;
    await expect(flushFeedbackQueue({ playerId: 'device-abcdef' })).resolves.toBe(1);
    expect(fake.state.inserted).toHaveLength(1);
    expect(localNotes()[0].state).toBe('sent');
  });
});

describe('when the database refuses the note', () => {
  it('says so instead of queueing it forever', async () => {
    fake.state.insertError = { message: 'new row violates row-level security policy', code: '42501' };
    const out = await submitFeedback(draft(), { playerId: 'device-abcdef' });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.rateLimited).toBe(true);
    expect(out.errors.message).toMatch(/not accepting notes right now/i);
    expect(localNotes(), 'a refusal is not a queue').toHaveLength(0);
  });

  it('passes a rate-limit sentence from the trigger straight to the player', async () => {
    fake.state.insertError = {
      message: 'Too many notes from this device in the last hour. Please try again later.',
      code: '23514',
    };
    const out = await submitFeedback(draft(), { playerId: 'device-abcdef' });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.errors.message).toMatch(/Too many notes from this device/);
    expect(localNotes()).toHaveLength(0);
  });
});

describe('the wall', () => {
  it('asks for the published, review-only columns and nothing private', async () => {
    fake.state.rows = [{
      id: 1, created_at: '2026-02-01T10:00:00Z', kind: 'review', rating: 4,
      message: 'Lovely.', game_id: 'chess', display_name: 'Ash',
    }];
    const rows = await readWall(6);
    expect(rows).toHaveLength(1);
    const call = fake.state.selectArgs[0];
    expect(call.table).toBe('feedback');
    const cols = call.columns.split(',').map((c) => c.trim());
    expect(cols.sort()).toEqual(['created_at', 'display_name', 'game_id', 'id', 'kind', 'message', 'rating']);
    // the two columns that must never reach a reader
    expect(call.columns).not.toMatch(/contact|device_id/);
  });
});

/**
 * The client and the migration have to agree. These assertions read the actual SQL,
 * so a future edit to one without the other is caught by `npm test` rather than by an
 * empty wall in production.
 */
describe('client and migration agree', () => {
  it('every column the client writes is granted for insert', () => {
    const grant = SQL.match(/grant insert \(([^)]+)\)\s+on public\.feedback/i)?.[1] ?? '';
    const granted = grant.split(',').map((c) => c.trim());
    for (const col of ['kind', 'rating', 'message', 'game_id', 'display_name', 'contact', 'device_id', 'user_id']) {
      expect(granted, `insert grant is missing ${col}`).toContain(col);
    }
    expect(granted, 'status must not be insertable').not.toContain('status');
  });

  it('every column the wall reads is granted for select, and privacy columns are not', () => {
    const grant = SQL.match(/grant select \(([^)]+)\)\s+on public\.feedback/i)?.[1] ?? '';
    const granted = grant.split(',').map((c) => c.trim());
    for (const col of ['id', 'created_at', 'kind', 'rating', 'message', 'game_id', 'display_name']) {
      expect(granted, `select grant is missing ${col}`).toContain(col);
    }
    for (const col of ['contact', 'device_id', 'user_id', 'status']) {
      expect(granted, `${col} must not be readable`).not.toContain(col);
    }
  });

  it('the table exists, is protected by RLS, and is rate limited', () => {
    expect(SQL).toMatch(/create table if not exists public\.feedback/i);
    expect(SQL).toMatch(/alter table public\.feedback enable row level security/i);
    expect(SQL).toMatch(/feedback_rate_limit/);
    expect(SQL, 'there must be no way to edit or delete a note from the browser').not.toMatch(
      /on public\.feedback for (update|delete)/i,
    );
  });

  it('the old wide-open chat policies are removed', () => {
    expect(SQL).toMatch(/drop policy if exists "room messages are readable"/i);
    expect(SQL).toMatch(/revoke select on public\.room_messages from anon, authenticated/i);
    expect(SQL).toMatch(/chat logs are append-only/i);
  });
});
