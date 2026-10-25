// @vitest-environment jsdom
/**
 * The feedback box, tested the way it can actually fail.
 *
 * The interesting cases are not "does a string get stored" — they are the ones that
 * decide whether a player trusts the box: a review with no rating must be refused
 * *before* it is sent, a message full of control characters must not reach the
 * database, the sixth note in an hour must be stopped on the device (because the
 * database will stop it too), and a note written with no Supabase project must still
 * exist after the tab is closed.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  MAX_MESSAGE, MAX_PER_HOUR, emptyDraft, flushFeedbackQueue, localNotes, rateLimited,
  readWall, recentCount, submitFeedback, tidyMessage, validateFeedback,
  type FeedbackDraft,
} from '../feedback';

const good = (over: Partial<FeedbackDraft> = {}): FeedbackDraft => ({
  ...emptyDraft('Volt'), rating: 4, message: 'The chess engine is genuinely good, and the art is lovely.', ...over,
});

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('validation', () => {
  it('refuses an empty note', () => {
    const v = validateFeedback(emptyDraft());
    expect(v.ok).toBe(false);
    expect(v.errors.message).toMatch(/sentence/i);
  });

  it('refuses a note too short to be actionable', () => {
    const v = validateFeedback(good({ message: 'nice' }));
    expect(v.ok).toBe(false);
    expect(v.errors.message).toMatch(/at least/i);
  });

  it('refuses a review with no rating, and accepts one with it', () => {
    expect(validateFeedback(good({ rating: null })).errors.rating).toMatch(/star/i);
    const ok = validateFeedback(good({ rating: 5 }));
    expect(ok.ok).toBe(true);
    expect(ok.clean.rating).toBe(5);
  });

  it('strips a rating from a note that is not a review', () => {
    const v = validateFeedback(good({ kind: 'game', rating: 5 }));
    expect(v.ok).toBe(true);
    expect(v.clean.rating).toBeNull();
  });

  it('rejects out-of-range star values', () => {
    expect(validateFeedback(good({ rating: 0 })).ok).toBe(false);
    expect(validateFeedback(good({ rating: 6 })).ok).toBe(false);
    expect(validateFeedback(good({ rating: 3.5 })).ok).toBe(false);
  });

  it('caps the message at the length the database will accept', () => {
    const v = validateFeedback(good({ message: 'x'.repeat(MAX_MESSAGE + 1) }));
    expect(v.ok).toBe(false);
    expect(v.errors.message).toMatch(new RegExp(String(MAX_MESSAGE)));
  });

  it('cleans control characters and collapses runaway blank lines', () => {
    expect(tidyMessage('hello\u0000 there')).toBe('hello there');
    expect(tidyMessage('a\n\n\n\n\n\nb')).toBe('a\n\n\nb');
    expect(tidyMessage('   padded   ')).toBe('padded');
  });

  it('gives an unnamed note a name, in the row rather than in the field', async () => {
    const out = await submitFeedback(good({ name: '   ' }), { playerId: 'device-abcdef' });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.note.draft.name).toBe('');
  });
});

describe('nothing is lost without Supabase', () => {
  it('keeps the note on the device and says it is local', async () => {
    const out = await submitFeedback(good(), { playerId: 'device-abcdef' });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.mode).toBe('local');
    const stored = localNotes();
    expect(stored).toHaveLength(1);
    expect(stored[0].state).toBe('queued');
    expect(stored[0].draft.message).toMatch(/chess engine/);
  });

  it('does not store a note that failed validation', async () => {
    const out = await submitFeedback(good({ message: 'no' }), { playerId: 'device-abcdef' });
    expect(out.ok).toBe(false);
    expect(localNotes()).toHaveLength(0);
  });

  it('flushing with no project is a no-op, not an error', async () => {
    await submitFeedback(good(), { playerId: 'device-abcdef' });
    await expect(flushFeedbackQueue({ playerId: 'device-abcdef' })).resolves.toBe(0);
    expect(localNotes()).toHaveLength(1);
  });

  it('the wall is empty rather than throwing when there is no project', async () => {
    await expect(readWall()).resolves.toEqual([]);
  });
});

describe('the hourly throttle', () => {
  it('counts only the last hour', () => {
    const old = Date.now() - 3_600_000 - 1000;
    localStorage.setItem('pikachu.feedback.v1', JSON.stringify([
      { id: 'old', at: old, state: 'queued', draft: good() },
    ]));
    expect(recentCount()).toBe(0);
    expect(rateLimited()).toBe(false);
  });

  it(`stops the ${MAX_PER_HOUR + 1}th note in an hour, on the device, before any network call`, async () => {
    for (let i = 0; i < MAX_PER_HOUR; i++) {
      const out = await submitFeedback(good(), { playerId: 'device-abcdef' });
      expect(out.ok).toBe(true);
    }
    expect(rateLimited()).toBe(true);
    const blocked = await submitFeedback(good(), { playerId: 'device-abcdef' });
    expect(blocked.ok).toBe(false);
    if (blocked.ok) return;
    expect(blocked.rateLimited).toBe(true);
    expect(blocked.errors.message).toMatch(new RegExp(String(MAX_PER_HOUR)));
    expect(localNotes(), 'the blocked note was not stored either').toHaveLength(MAX_PER_HOUR);
  });
});
