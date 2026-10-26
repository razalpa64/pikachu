/**
 * The rules about *people*, tested without a socket.
 *
 * `server/safety.ts` holds the two decisions the relay makes about players
 * rather than about boards: who may be matched with whom, and when a stranger is
 * allowed to talk. Both are the sort of thing that is invisible when it works and
 * a complaint when it does not, so they are separated from `index.ts` and tested
 * here.
 */
import { describe, it, expect } from 'vitest';
import {
  INVITE_TTL_MS, blockedBetween, blocker, chatAllowed, forgetAccount, rememberBlocks,
  sanitizeBlocks, sweepInvites, takeInvite, type AccountIndex, type BlockIndex, type Invite,
} from '../../../server/safety';

const ASH = '11111111-1111-1111-1111-111111111111';
const MISTY = '22222222-2222-2222-2222-222222222222';
const BROCK = '33333333-3333-3333-3333-333333333333';

/** Two signed-in players and one guest, as the relay would have them. */
function world() {
  const accounts: AccountIndex = new Map([
    [`u:${ASH}`, ASH],
    [`u:${MISTY}`, MISTY],
    [`u:${BROCK}`, BROCK],
  ]);   // 'guest-1' is deliberately absent: a guest has no account to block
  const blocks: BlockIndex = new Map();
  return { accounts, blocks };
}

describe('the block list a client sends', () => {
  it('keeps uuids and drops everything else', () => {
    expect(sanitizeBlocks([ASH.toUpperCase(), '  ' + MISTY + '  ', 'not-a-uuid', 42, null, '', ASH]))
      .toEqual([ASH, MISTY]);
  });

  it('is capped, so one socket cannot send a directory', () => {
    const many = Array.from({ length: 500 }, (_, i) =>
      `0000000${i % 10}-0000-0000-0000-00000000000${i % 10}`);
    expect(sanitizeBlocks(many, 50)).toHaveLength(10);
    expect(sanitizeBlocks(Array(1000).fill(ASH), 300)).toEqual([ASH]);
  });

  it('refuses anything that is not a list', () => {
    expect(sanitizeBlocks(undefined)).toEqual([]);
    expect(sanitizeBlocks('abc')).toEqual([]);
    expect(sanitizeBlocks({ 0: ASH })).toEqual([]);
  });
});

describe('who may be matched with whom', () => {
  it('allows anybody when nobody has blocked anybody', () => {
    const { accounts, blocks } = world();
    rememberBlocks(blocks, ASH, []);
    expect(blockedBetween(accounts, blocks, `u:${ASH}`, `u:${MISTY}`)).toBe(false);
  });

  it('refuses in the direction the blocker cares about', () => {
    const { accounts, blocks } = world();
    rememberBlocks(blocks, ASH, [MISTY]);
    expect(blockedBetween(accounts, blocks, `u:${ASH}`, `u:${MISTY}`), 'Ash queued into Misty').toBe(true);
    expect(blockedBetween(accounts, blocks, `u:${MISTY}`, `u:${ASH}`), 'Misty queued into Ash').toBe(true);
  });

  it('refuses on the blocked player’s own list too, because they both matter', () => {
    const { accounts, blocks } = world();
    rememberBlocks(blocks, MISTY, [ASH]);
    expect(blockedBetween(accounts, blocks, `u:${ASH}`, `u:${MISTY}`)).toBe(true);
  });

  it('never blocks a guest, and never blocks you from yourself', () => {
    const { accounts, blocks } = world();
    rememberBlocks(blocks, ASH, [MISTY]);
    /* A guest has no account, so there is nothing to have blocked. This is the
       honest limit of a system where not everybody signs in, and the lobby copy
       says so rather than pretending otherwise. */
    expect(accounts.has('guest-1')).toBe(false);
    expect(blockedBetween(accounts, blocks, `u:${ASH}`, 'guest-1')).toBe(false);
    expect(blockedBetween(accounts, blocks, `u:${ASH}`, `u:${ASH}`)).toBe(false);
  });

  it('forgets a player who has gone, so the index does not grow forever', () => {
    const { accounts, blocks } = world();
    rememberBlocks(blocks, ASH, [MISTY]);
    forgetAccount(accounts, blocks, `u:${ASH}`);
    expect(accounts.has(`u:${ASH}`)).toBe(false);
    expect(blocks.has(ASH)).toBe(false);
    expect(blockedBetween(accounts, blocks, `u:${ASH}`, `u:${MISTY}`)).toBe(false);
  });

  it('is shaped the way the queue wants it', () => {
    const { accounts, blocks } = world();
    rememberBlocks(blocks, ASH, [BROCK]);
    const skip = blocker(accounts, blocks);
    expect(skip(`u:${ASH}`, `u:${BROCK}`)).toBe(true);
    expect(skip(`u:${ASH}`, `u:${MISTY}`)).toBe(false);
  });
});

describe('when a stranger may talk', () => {
  it('never in a matchmade room before the first round', () => {
    const before = { matchmade: true, historyLength: 0, status: 'WAITING' };
    expect(chatAllowed(before)).toBe(false);
    expect(chatAllowed({ ...before, status: 'READY_CHECK' })).toBe(false);
    expect(chatAllowed({ ...before, status: 'STARTING' })).toBe(false);
  });

  it('from the first serve onwards', () => {
    expect(chatAllowed({ matchmade: true, historyLength: 0, status: 'IN_GAME' })).toBe(true);
  });

  it('after a round has been played, even between games', () => {
    expect(chatAllowed({ matchmade: true, historyLength: 1, status: 'COMPLETED' })).toBe(true);
    expect(chatAllowed({ matchmade: true, historyLength: 1, status: 'WAITING' })).toBe(true);
  });

  it('always in a private room, because the code was the introduction', () => {
    expect(chatAllowed({ matchmade: false, historyLength: 0, status: 'WAITING' })).toBe(true);
  });
});

describe('friend invitations', () => {
  const invite = (over: Partial<Invite> = {}): Invite => ({
    id: 'inv-1', fromPlayer: `u:${ASH}`, fromAccount: ASH, toAccount: MISTY,
    gameId: 'chess', settings: {}, at: 1000, ...over,
  });

  it('can be answered only by the person invited', () => {
    const invites = new Map([[ 'inv-1', invite() ]]);
    expect(takeInvite(invites, 'inv-1', BROCK, 2000)).toEqual({ error: 'not_yours' });
    expect(invites.has('inv-1'), 'a stranger’s attempt does not consume it').toBe(true);
    expect(takeInvite(invites, 'inv-1', MISTY, 2000)).toEqual({ invite: invite() });
  });

  it('can be answered only once', () => {
    const invites = new Map([[ 'inv-1', invite() ]]);
    takeInvite(invites, 'inv-1', MISTY, 2000);
    expect(takeInvite(invites, 'inv-1', MISTY, 2000)).toEqual({ error: 'unknown' });
  });

  it('expires, and says so rather than seating anybody', () => {
    const invites = new Map([[ 'inv-1', invite() ]]);
    const late = 1000 + INVITE_TTL_MS;
    expect(takeInvite(invites, 'inv-1', MISTY, late)).toEqual({ error: 'expired' });
    expect(invites.size).toBe(0);
  });

  it('is swept out of memory when nobody answers', () => {
    const invites = new Map<string, Invite>([['inv-1', invite()], ['inv-2', invite({ id: 'inv-2', at: 5_000 })]]);
    const expired = sweepInvites(invites, 1000 + INVITE_TTL_MS);
    expect(expired.map((i) => i.id)).toEqual(['inv-1']);
    expect([...invites.keys()]).toEqual(['inv-2']);
  });
});
