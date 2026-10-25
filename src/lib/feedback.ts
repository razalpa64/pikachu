/**
 * Feedback — reviews, game ideas, improvements and bug reports.
 *
 * Two rules shape this module:
 *
 * 1. **It must work before Supabase exists.** The arcade is playable with no
 *    credentials at all, so a note you write is always kept on the device first and
 *    only *also* sent to Postgres when the project is configured. Nothing is lost
 *    because a key was missing, and nothing pretends to have been sent when it has
 *    not.
 * 2. **The browser is not trusted.** Every rule here is re-stated as a CHECK
 *    constraint and a Row Level Security policy in
 *    `supabase/migrations/0003_feedback.sql`, because this module is trivially
 *    bypassable with curl. The client-side validation exists for good error
 *    messages, not for safety.
 */
import { supabase, supabaseEnabled } from './supabase';

export type FeedbackKind = 'review' | 'game' | 'improvement' | 'bug';

export const KINDS: { value: FeedbackKind; label: string; blurb: string; prompt: string }[] = [
  {
    value: 'review',
    label: 'A review',
    blurb: 'How the arcade felt',
    prompt: 'What did you play, and how did it land? A sentence is plenty — the good and the bad.',
  },
  {
    value: 'game',
    label: 'A game idea',
    blurb: 'Something missing',
    prompt: 'What should be added? Name it if you have a name, and say what the two players do on their turn.',
  },
  {
    value: 'improvement',
    label: 'An improvement',
    blurb: 'Make this better',
    prompt: 'What is clunky, slow or confusing? If you can, say what you expected to happen instead.',
  },
  {
    value: 'bug',
    label: "Something's broken",
    blurb: 'It did not work',
    prompt: 'What did you tap, what happened, and what should have happened? A phone or desktop note helps.',
  },
];

export const MIN_MESSAGE = 12;
export const MAX_MESSAGE = 1200;
export const MAX_NAME = 40;
export const MAX_CONTACT = 120;
/** how many notes one device may leave in an hour — mirrored by a trigger in Postgres */
export const MAX_PER_HOUR = 5;

export interface FeedbackDraft {
  kind: FeedbackKind;
  rating: number | null;
  message: string;
  gameId: string | null;
  name: string;
  contact: string;
}

export interface FeedbackErrors {
  message?: string;
  rating?: string;
  name?: string;
  contact?: string;
}

export interface StoredNote {
  id: string;
  at: number;
  draft: FeedbackDraft;
  /** `queued` = not in Postgres yet (no keys, or the insert failed) */
  state: 'queued' | 'sent';
}

const KEY = 'pikachu.feedback.v1';

export const emptyDraft = (name = ''): FeedbackDraft => ({
  kind: 'review', rating: null, message: '', gameId: null, name, contact: '',
});

/** strip anything that is not printable, collapse long runs of blank lines */
export function tidyMessage(text: string): string {
  return text
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .replace(/[ \t]{3,}/g, '  ')
    .trim();
}

/**
 * The single source of truth for what counts as a usable note. Returns the cleaned
 * draft alongside the errors so the caller can submit exactly what was validated.
 */
export function validateFeedback(draft: FeedbackDraft): {
  ok: boolean; errors: FeedbackErrors; clean: FeedbackDraft;
} {
  const errors: FeedbackErrors = {};
  const message = tidyMessage(draft.message);
  const name = draft.name.trim().slice(0, MAX_NAME);
  const contact = draft.contact.trim().slice(0, MAX_CONTACT);
  const kind: FeedbackKind = KINDS.some((k) => k.value === draft.kind) ? draft.kind : 'review';
  const rating = kind === 'review' ? draft.rating : null;
  const gameId = draft.gameId ? draft.gameId.slice(0, 40) : null;

  if (!message) errors.message = 'Write a sentence or two first.';
  else if (message.length < MIN_MESSAGE) errors.message = `A little more detail, please — at least ${MIN_MESSAGE} characters.`;
  else if (message.length > MAX_MESSAGE) errors.message = `That is ${message.length} characters; the box holds ${MAX_MESSAGE}.`;

  if (kind === 'review' && (rating === null || !Number.isInteger(rating) || rating < 1 || rating > 5)) {
    errors.rating = 'Pick a star rating — one to five.';
  }
  if (contact && contact.length < 3) errors.contact = 'If you leave a contact, make it one that works.';

  return {
    ok: Object.keys(errors).length === 0,
    errors,
    clean: { kind, rating, message, gameId, name, contact },
  };
}

/* ------------------------------------------------------------------ local store */

function readAll(): StoredNote[] {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as StoredNote[]) : [];
  } catch {
    return [];
  }
}

function writeAll(notes: StoredNote[]) {
  try { localStorage.setItem(KEY, JSON.stringify(notes.slice(-60))); } catch { /* storage full or blocked */ }
}

export function localNotes(): StoredNote[] {
  return readAll();
}

/** What the browser thinks it has already said, for the one-hour throttle. */
export function recentCount(now = Date.now()): number {
  return readAll().filter((n) => now - n.at < 3_600_000).length;
}

export function rateLimited(now = Date.now()): boolean {
  return recentCount(now) >= MAX_PER_HOUR;
}

function remember(draft: FeedbackDraft, state: StoredNote['state']): StoredNote {
  const note: StoredNote = {
    id: (globalThis.crypto?.randomUUID?.() ?? `n-${Date.now()}-${Math.random().toString(36).slice(2)}`),
    at: Date.now(), draft, state,
  };
  writeAll([...readAll(), note]);
  return note;
}

/* ------------------------------------------------------------------ submit */

export interface SubmitOk { ok: true; mode: 'cloud' | 'local'; note: StoredNote }
export interface SubmitFail { ok: false; errors: FeedbackErrors; rateLimited?: boolean }
export type SubmitResult = SubmitOk | SubmitFail;

export interface SubmitContext {
  /** stable per-browser id; the rate limit in Postgres keys on it */
  playerId: string;
  /** optional signed-in user, so a review can be tied to an account */
  userId?: string | null;
}

/** The signed-in user's id, if there is one. Never required — a review needs no account. */
async function userIdFrom(sb: any): Promise<string | null> {
  try {
    const out = await sb?.auth?.getUser?.();
    return out?.data?.user?.id ?? null;
  } catch { return null; }
}

/**
 * The database refuses a flood with a `check_violation` carrying a human sentence
 * ("Too many notes from this device…"). That is a *real* answer from the server, not a
 * network blip, so it must reach the player instead of being retried forever as a
 * queued note.
 */
function isRefusal(error: unknown): string | null {
  const e = error as { message?: string; code?: string } | null;
  const message = e?.message ?? '';
  if (/too many notes|feedback box is busy/i.test(message)) return message;
  if (e?.code === '42501' || /row-level security|permission denied/i.test(message)) {
    return 'The feedback box is not accepting notes right now. Nothing was lost — please try again later.';
  }
  return null;
}

function rowFor(d: FeedbackDraft, ctx: SubmitContext) {
  return {
    kind: d.kind,
    rating: d.rating,
    message: d.message,
    game_id: d.gameId,
    display_name: d.name || 'A player',
    contact: d.contact || null,
    device_id: (ctx.playerId || 'unknown-device').slice(0, 64),
    user_id: ctx.userId ?? null,
  };
}

/**
 * Validate → throttle → keep locally → (optionally) insert into Postgres.
 *
 * The local copy is written *before* the network call on purpose: if the insert
 * fails or the tab closes mid-flight, the note is still on the device and appears
 * in the queue line on the page.
 */
export async function submitFeedback(raw: FeedbackDraft, ctx: SubmitContext): Promise<SubmitResult> {
  const { ok, errors, clean } = validateFeedback(raw);
  if (!ok) return { ok: false, errors };
  if (rateLimited()) {
    return {
      ok: false,
      rateLimited: true,
      errors: { message: `That is ${MAX_PER_HOUR} notes in an hour — give it a while, then send another.` },
    };
  }

  const sb = supabaseEnabled() ? await supabase() : null;
  if (!sb) return { ok: true, mode: 'local', note: remember(clean, 'queued') };

  const full: SubmitContext = { ...ctx, userId: ctx.userId ?? await userIdFrom(sb) };
  try {
    const { error } = await sb.from('feedback').insert(rowFor(clean, full));
    if (error) throw error;
    return { ok: true, mode: 'cloud', note: remember(clean, 'sent') };
  } catch (e) {
    const refusal = isRefusal(e);
    if (refusal) {
      // a refusal will not improve by being queued, so nothing is stored and the
      // player is told exactly what the database said
      return { ok: false, rateLimited: true, errors: { message: refusal } };
    }
    console.warn('[feedback] insert failed, kept on this device', e);
    return { ok: true, mode: 'local', note: remember(clean, 'queued') };
  }
}

/** Retry anything the device is holding that was never delivered. Safe to call on boot. */
export async function flushFeedbackQueue(ctx: SubmitContext): Promise<number> {
  const sb = supabaseEnabled() ? await supabase() : null;
  if (!sb) return 0;
  const notes = readAll();
  const full: SubmitContext = { ...ctx, userId: ctx.userId ?? await userIdFrom(sb) };
  let sent = 0;
  for (const note of notes.filter((n) => n.state === 'queued')) {
    try {
      const { error } = await sb.from('feedback').insert(rowFor(note.draft, full));
      if (error) break;                     // a rate-limit rejection will not improve by retrying
      note.state = 'sent';
      sent++;
    } catch { break; }
  }
  if (sent) writeAll(notes);
  return sent;
}

/* ------------------------------------------------------------------ the wall */

export interface WallItem {
  id: number;
  created_at: string;
  kind: FeedbackKind;
  rating: number | null;
  message: string;
  game_id: string | null;
  display_name: string;
}

/**
 * Published reviews, newest first. Row Level Security decides what is visible; the
 * client never asks for hidden rows and could not read them if it did. The columns
 * requested here are exactly the ones `anon` has a column-level grant for.
 */
export async function readWall(limit = 9): Promise<WallItem[]> {
  const sb = supabaseEnabled() ? await supabase() : null;
  if (!sb) return [];
  try {
    const { data, error } = await sb
      .from('feedback')
      .select('id, created_at, kind, rating, message, game_id, display_name')
      .eq('kind', 'review')
      .order('created_at', { ascending: false })
      .limit(Math.max(1, Math.min(30, limit)));
    if (error) throw error;
    return (data ?? []) as WallItem[];
  } catch (e) {
    console.warn('[feedback] wall unavailable', e);
    return [];
  }
}
