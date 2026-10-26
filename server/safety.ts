/**
 * The facts about a *player* that the queue and the chat need, kept apart from
 * the sockets that deliver them.
 *
 * Two ideas live here:
 *
 *   * **blocks** — who may not be matched with whom. The relay cannot read the
 *     database (it deliberately has no service key), so each signed-in client
 *     sends its own block list on `hello`; the relay applies it in both
 *     directions. A modified client can only weaken *its own* protections: the
 *     list it sends is the list of people it does not want to meet, and the
 *     other side's list is applied independently.
 *   * **the chat gate** — strangers get no chat until they have played a round.
 *     A private room you were invited into keeps its lobby chat, because the
 *     code was the invitation.
 *
 * No sockets and no timers, so this is unit-tested directly.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Accept whatever a client sends, keep only the shapes that could be real. */
export function sanitizeBlocks(input: unknown, max = 300): string[] {
  if (!Array.isArray(input)) return [];
  const out: string[] = [];
  for (const raw of input.slice(0, max)) {
    if (typeof raw !== 'string') continue;
    const id = raw.trim().toLowerCase();
    if (UUID.test(id) && !out.includes(id)) out.push(id);
  }
  return out;
}

/** playerId → the account it belongs to (only verified players have one). */
export type AccountIndex = Map<string, string>;
/** accountId → the accounts that account will not play with. */
export type BlockIndex = Map<string, Set<string>>;

export function rememberBlocks(index: BlockIndex, accountId: string, blocked: string[]) {
  if (!blocked.length) index.delete(accountId);
  else index.set(accountId, new Set(blocked));
}

export function forgetAccount(accounts: AccountIndex, blocks: BlockIndex, playerId: string) {
  const account = accounts.get(playerId);
  accounts.delete(playerId);
  if (account) blocks.delete(account);
}

/**
 * May these two player ids be paired? Only accounts can be blocked, so a pair of
 * guests — or a guest and an account — is never *known* to be blocked, and is
 * allowed. That asymmetry is the honest limit of a system without accounts for
 * everybody, and the lobby says as much.
 */
export function blockedBetween(
  accounts: AccountIndex,
  blocks: BlockIndex,
  a: string,
  b: string,
): boolean {
  const left = accounts.get(a);
  const right = accounts.get(b);
  if (!left || !right || left === right) return false;
  return Boolean(blocks.get(left)?.has(right) || blocks.get(right)?.has(left));
}

/** A curried form, because the queue takes a `(a, b) => boolean` predicate. */
export function blocker(accounts: AccountIndex, blocks: BlockIndex) {
  return (a: string, b: string) => blockedBetween(accounts, blocks, a, b);
}

/**
 * Strangers cannot talk before the first round. A matchmade room has no host, two
 * people who have never met and — until a board appears — nothing to talk *about*;
 * the first thing that arrives over that channel is too often the reason report
 * buttons exist. Once the first match starts the room behaves normally.
 */
export function chatAllowed(room: {
  matchmade: boolean;
  historyLength: number;
  status: string;
}): boolean {
  if (!room.matchmade) return true;
  if (room.status === 'IN_GAME') return true;
  return room.historyLength > 0;
}

export interface Invite {
  id: string;
  fromPlayer: string;
  fromAccount: string;
  toAccount: string;
  gameId: string;
  settings: Record<string, unknown>;
  at: number;
}

/** An invitation nobody answered stops being live; a stale one cannot seat anybody. */
export const INVITE_TTL_MS = 1000 * 60;

export function sweepInvites(invites: Map<string, Invite>, now: number, ttl = INVITE_TTL_MS): Invite[] {
  const expired: Invite[] = [];
  for (const [id, invite] of invites) {
    if (now - invite.at >= ttl) {
      invites.delete(id);
      expired.push(invite);
    }
  }
  return expired;
}

/** Only the person invited can answer, and only once. */
export function takeInvite(
  invites: Map<string, Invite>,
  id: string,
  accountId: string,
  now: number,
): { invite: Invite } | { error: 'unknown' | 'not_yours' | 'expired' } {
  const invite = invites.get(String(id));
  if (!invite) return { error: 'unknown' };
  if (invite.toAccount !== accountId) return { error: 'not_yours' };
  invites.delete(invite.id);
  if (now - invite.at >= INVITE_TTL_MS) return { error: 'expired' };
  return { invite };
}
