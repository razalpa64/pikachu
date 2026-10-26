/**
 * The friend list, the block list and the report button, as seen from the
 * browser.
 *
 * Thin on purpose: every rule that matters is a policy in Postgres
 * (`supabase/migrations/0005_friends_and_safety.sql`), and this file only names
 * the calls. That is not laziness — the anon key is public, so anything enforced
 * here could simply be skipped by somebody with `curl`. The functions below
 * exist to give the UI sensible errors, not to be the referee.
 *
 * Nothing here works without a Supabase project *and* a signed-in account, and
 * every caller handles that: friends are an addition, not a gate.
 */
import { refreshBlocks } from './session';
import { supabase, supabaseEnabled } from './supabase';

export type FriendStatus = 'pending' | 'accepted';
export type FriendDirection = 'incoming' | 'outgoing' | 'mutual';

export interface Friend {
  friendshipId: number;
  playerId: string;
  handle: string | null;
  name: string;
  mascot: string;
  status: FriendStatus;
  direction: FriendDirection;
  since: string;
}

export interface FoundPlayer {
  playerId: string;
  handle: string;
  name: string;
  mascot: string;
}

export const ACCOUNT_GAMES_ENABLED = () => supabaseEnabled();

function unavailable(): never {
  throw new Error('Friends need cloud sync. Add your Supabase keys to .env to turn it on.');
}

function signedOut(): never {
  throw new Error('Sign in first — friends are tied to an account, not to this browser.');
}

/** Postgres error text is not something to show a player. */
function readable(error: { message?: string; code?: string }): Error {
  const message = error.message ?? '';
  if (error.code === '23505' || /duplicate key/i.test(message)) {
    return new Error('There is already a request between you two.');
  }
  if (error.code === '42501' || /row-level security|permission denied/i.test(message)) {
    return new Error('That is not something you can do.');
  }
  if (/rate|too many/i.test(message)) return new Error(message);
  if (/duplicate key/i.test(message)) return new Error('That name is taken.');
  return new Error(message || 'Something went wrong.');
}

async function client() {
  if (!supabaseEnabled()) unavailable();
  const sb = await supabase();
  if (!sb) unavailable();
  return sb;
}

/* ------------------------------------------------------------------ friends */

export async function listFriends(): Promise<Friend[]> {
  const sb = await client();
  const { data, error } = await sb.rpc('my_friends');
  if (error) throw readable(error);
  return (data ?? []).map((row: any) => ({
    friendshipId: Number(row.friendship_id),
    playerId: String(row.player_id),
    handle: row.handle ?? null,
    name: String(row.display_name ?? 'Trainer'),
    mascot: String(row.mascot ?? 'classic'),
    status: row.status === 'accepted' ? 'accepted' : 'pending',
    direction: row.direction === 'incoming' ? 'incoming' : row.direction === 'outgoing' ? 'outgoing' : 'mutual',
    since: String(row.since ?? ''),
  }));
}

export async function findPlayerByHandle(handle: string): Promise<FoundPlayer | null> {
  const clean = handle.trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
  if (clean.length < 3) return null;
  const sb = await client();
  const { data, error } = await sb.rpc('find_player', { wanted: clean });
  if (error) throw readable(error);
  const row = (data ?? [])[0];
  if (!row) return null;
  return {
    playerId: String(row.player_id),
    handle: String(row.handle ?? clean),
    name: String(row.display_name ?? 'Trainer'),
    mascot: String(row.mascot ?? 'classic'),
  };
}

export async function requestFriend(playerId: string): Promise<void> {
  const sb = await client();
  const { data: auth } = await sb.auth.getUser();
  const me = auth.user?.id;
  if (!me) signedOut();
  if (playerId === me) throw new Error('You are already friends with yourself.');
  /* `status` is not an insertable column, so the row can only ever be born
     pending; the addressee is the only one who can accept it. */
  const { error } = await sb.from('friendships').insert({ requester: me, addressee: playerId });
  if (error) throw readable(error);
}

export async function acceptFriend(friendshipId: number): Promise<void> {
  const sb = await client();
  const { error } = await sb.from('friendships')
    .update({ status: 'accepted', responded_at: new Date().toISOString() })
    .eq('id', friendshipId);
  if (error) throw readable(error);
}

/**
 * Declining deletes the request rather than marking it refused: the person who
 * asked is told nothing either way, which is the kinder of the two options.
 */
export async function declineFriend(friendshipId: number): Promise<void> {
  const sb = await client();
  const { error } = await sb.from('friendships').delete().eq('id', friendshipId);
  if (error) throw readable(error);
}

export const removeFriend = declineFriend;

/* ------------------------------------------------------------------- blocks */

export interface BlockedPlayer { accountId: string; since: string }

export async function listBlocked(): Promise<BlockedPlayer[]> {
  const sb = await client();
  const { data, error } = await sb.from('blocks').select('blocked, created_at');
  if (error) throw readable(error);
  return (data ?? []).map((row: any) => ({ accountId: String(row.blocked), since: String(row.created_at ?? '') }));
}

/**
 * Blocking ends the friendship and any pending request in the same statement
 * group — `blocks_prune_relationships` is a trigger, not a client promise — and
 * the relay is told on the next `hello`, which happens immediately because the
 * cached list changed.
 */
export async function blockPlayer(playerId: string, reason = ''): Promise<void> {
  const sb = await client();
  const { data: auth } = await sb.auth.getUser();
  const me = auth.user?.id;
  if (!me) signedOut();
  if (playerId === me) throw new Error('You cannot block yourself.');
  const { error } = await sb.from('blocks').insert({
    blocker: me, blocked: playerId, reason: reason.slice(0, 200),
  });
  if (error) throw readable(error);
  await refreshBlocks();
}

export async function unblockPlayer(playerId: string): Promise<void> {
  const sb = await client();
  const { error } = await sb.from('blocks').delete().eq('blocked', playerId);
  if (error) throw readable(error);
  await refreshBlocks();
}

/* ------------------------------------------------------------------ handles */

export async function myHandle(): Promise<string | null> {
  const sb = await client();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) return null;
  const { data } = await sb.from('profiles').select('handle').eq('id', auth.user.id).maybeSingle();
  return data?.handle ?? null;
}

export async function setHandle(handle: string): Promise<string> {
  const clean = handle.trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
  if (!/^[a-z0-9_]{3,20}$/.test(clean)) {
    throw new Error('A handle is 3–20 characters: lowercase letters, numbers and underscores.');
  }
  const sb = await client();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) signedOut();
  const { error } = await sb.from('profiles').update({ handle: clean }).eq('id', auth.user.id);
  if (error) {
    if (error.code === '23505' || /duplicate key/i.test(error.message)) throw new Error('That handle is taken.');
    throw readable(error);
  }
  return clean;
}

/* ------------------------------------------------------------------ reports */

export type ReportCategory = 'harassment' | 'cheating' | 'spam' | 'other';

export interface ReportInput {
  /** The account being reported, when they have one. */
  reported?: string | null;
  reportedName: string;
  reportedHandle?: string | null;
  roomCode?: string | null;
  gameId?: string | null;
  category: ReportCategory;
  message: string;
  context?: Record<string, unknown>;
}

/**
 * Reports go to `public.reports`, not to the public feedback wall: a report names
 * another player, and the feedback wall is readable by anybody. The reporter is
 * filled in by the database (`default auth.uid()`), so this cannot be filed in
 * somebody else's name.
 */
export async function reportPlayer(input: ReportInput): Promise<void> {
  const clean = input.message.trim();
  if (clean.length < 8) throw new Error('Please describe what happened in at least a few words.');
  const sb = await client();
  const { error } = await sb.from('reports').insert({
    reported: input.reported ?? null,
    reported_name: (input.reportedName || 'A player').slice(0, 40),
    reported_handle: input.reportedHandle ? input.reportedHandle.slice(0, 20) : null,
    room_code: input.roomCode ? input.roomCode.slice(0, 10) : null,
    game_id: input.gameId ? input.gameId.slice(0, 40) : null,
    category: input.category,
    message: clean.slice(0, 600),
    context: input.context ?? {},
  });
  if (error) throw readable(error);
}
