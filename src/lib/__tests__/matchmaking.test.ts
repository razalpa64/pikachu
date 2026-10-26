import { describe, expect, it } from 'vitest';

import {
  QUEUE_NOTICE_MS, QUEUE_TTL_MS,
  dequeue, dueForNotice, enqueue, find, onlyBlockedWaiters, partnerFor, sweepQueue, takePair,
  waitingCounts,
  type QueueEntry, type QueueTable,
} from '../../../server/queue';

const entry = (playerId: string, gameId = 'chess', since = 1000): QueueEntry => ({
  playerId, name: playerId, mascot: 'classic', gameId, since, settings: {}, roomName: '',
});

describe('the matchmaking queue', () => {
  it('pairs two strangers in the order they arrived', () => {
    const table: QueueTable = new Map();
    enqueue(table, entry('ash', 'chess', 1000));
    enqueue(table, entry('misty', 'chess', 2000));

    const pair = takePair(table, 'chess', 'misty');
    expect(pair?.first.playerId).toBe('ash');
    expect(pair?.second.playerId).toBe('misty');
    expect(waitingCounts(table)).toEqual({});
  });

  it('gives the longest wait to the next arrival, not the newest', () => {
    const table: QueueTable = new Map();
    enqueue(table, entry('late', 'chess', 5000));
    enqueue(table, entry('early', 'chess', 1000));
    expect(partnerFor(table, 'chess', 'newcomer')?.playerId).toBe('early');
    /* The newcomer has to be in the queue themselves before a pair is taken. */
    enqueue(table, entry('newcomer', 'chess', 6000));
    const pair = takePair(table, 'chess', 'newcomer');
    expect(pair?.first.playerId).toBe('early');
    expect(pair?.second.playerId).toBe('newcomer');
    expect(find(table, 'late')?.entry.playerId, 'the newest waits on').toBe('late');
  });

  it('never pairs a player with themselves', () => {
    const table: QueueTable = new Map();
    enqueue(table, entry('ash'));
    enqueue(table, entry('ash'));            // a double click, say
    expect(takePair(table, 'chess', 'ash')).toBeNull();
    expect(find(table, 'ash')?.entry.playerId).toBe('ash');
  });

  it('leaves you where you were if you queue again', () => {
    const table: QueueTable = new Map();
    enqueue(table, entry('ash', 'chess', 1000));
    enqueue(table, entry('ash', 'chess', 9000));   // clicking twice must not jump the line
    expect(partnerFor(table, 'chess', 'newcomer')?.since).toBe(1000);
    expect(waitingCounts(table)).toEqual({ chess: 1 });
  });

  it('moves you rather than cloning you when you change game', () => {
    const table: QueueTable = new Map();
    enqueue(table, entry('ash', 'chess'));
    enqueue(table, entry('ash', 'checkers'));
    expect(waitingCounts(table)).toEqual({ checkers: 1 });
    expect(find(table, 'ash')?.gameId).toBe('checkers');
  });

  it('only ever pairs inside one game', () => {
    const table: QueueTable = new Map();
    enqueue(table, entry('ash', 'chess'));
    enqueue(table, entry('misty', 'checkers'));
    expect(takePair(table, 'checkers', 'misty')).toBeNull();
    expect(waitingCounts(table)).toEqual({ chess: 1, checkers: 1 });
  });

  it('cancelling removes you and nobody else', () => {
    const table: QueueTable = new Map();
    enqueue(table, entry('ash'));
    enqueue(table, entry('misty'));
    expect(dequeue(table, 'ash')?.playerId).toBe('ash');
    expect(dequeue(table, 'ash')).toBeNull();
    expect(waitingCounts(table)).toEqual({ chess: 1 });
  });

  it('expires a queue that nobody ever fills', () => {
    const table: QueueTable = new Map();
    enqueue(table, entry('ash', 'chess', 0));
    enqueue(table, entry('misty', 'chess', QUEUE_TTL_MS - 1));
    const gone = sweepQueue(table, QUEUE_TTL_MS);
    expect(gone.map((e) => e.playerId)).toEqual(['ash']);
    expect(waitingCounts(table)).toEqual({ chess: 1 });
    expect(sweepQueue(table, QUEUE_TTL_MS * 2).map((e) => e.playerId)).toEqual(['misty']);
    expect(waitingCounts(table)).toEqual({});
  });

  it('says “nobody yet” once per wait, and not a second time', () => {
    const table: QueueTable = new Map();
    enqueue(table, entry('ash', 'chess', 0));
    expect(dueForNotice(table, QUEUE_NOTICE_MS - 1)).toHaveLength(0);
    expect(dueForNotice(table, QUEUE_NOTICE_MS)).toHaveLength(1);
    expect(dueForNotice(table, QUEUE_NOTICE_MS + 1)).toHaveLength(0);
  });

  it('survives the empty case', () => {
    const table: QueueTable = new Map();
    expect(partnerFor(table, 'chess', 'ash')).toBeNull();
    expect(takePair(table, 'chess', 'ash')).toBeNull();
    expect(dequeue(table, 'ash')).toBeNull();
    expect(sweepQueue(table, Date.now())).toEqual([]);
    expect(waitingCounts(table)).toEqual({});
  });
});

describe('the queue around somebody you have blocked', () => {
  it('passes over them without losing your place in line', () => {
    const table: QueueTable = new Map();
    enqueue(table, entry('harasser', 'chess', 1000));
    enqueue(table, entry('me', 'chess', 2000));
    enqueue(table, entry('friend', 'chess', 3000));

    const skip = (a: string, b: string) =>
      (a === 'me' && b === 'harasser') || (a === 'harasser' && b === 'me');

    /* The blocked player is the *oldest* entry, which is precisely the case a
       naive "take the front of the queue" would get wrong. */
    expect(partnerFor(table, 'chess', 'me', skip)?.playerId).toBe('friend');
    /* 'friend' has blocked nobody, so they may still be paired with the harasser;
       what must not happen is *me* being handed to them. */
    expect(partnerFor(table, 'chess', 'friend', skip)?.playerId).toBe('harasser');
    const pair = takePair(table, 'chess', 'me', skip);
    expect(pair?.first.playerId, 'the longer wait still wins between the two who may play')
      .toBe('me');
    expect(pair?.second.playerId).toBe('friend');
    expect(find(table, 'harasser')?.entry.playerId, 'and the blocked player keeps waiting')
      .toBe('harasser');
  });

  it('says so when everyone else waiting is somebody you blocked', () => {
    const table: QueueTable = new Map();
    enqueue(table, entry('them', 'chess', 1000));
    enqueue(table, entry('me', 'chess', 2000));
    const skip = () => true;
    expect(onlyBlockedWaiters(table, 'chess', 'me', skip)).toBe(true);
    /* One person you *can* play with, and it is business as usual. */
    enqueue(table, entry('friend', 'chess', 3000));
    expect(onlyBlockedWaiters(table, 'chess', 'me', (a, b) => b === 'them' && a === 'me')).toBe(false);
  });

  it('does not claim a block when there is simply nobody there', () => {
    const table: QueueTable = new Map();
    enqueue(table, entry('me', 'chess', 1000));
    /* Alone in the queue: nobody to be blocked from. */
    expect(onlyBlockedWaiters(table, 'chess', 'me', () => true)).toBe(false);
    /* Wrong game, and an empty table, are both "nobody". */
    expect(onlyBlockedWaiters(table, 'checkers', 'me', () => true)).toBe(false);
    expect(onlyBlockedWaiters(new Map(), 'chess', 'me', () => true)).toBe(false);
    /* A guest with no block data at all never sees the message. */
    expect(onlyBlockedWaiters(table, 'chess', 'me', undefined)).toBe(false);
  });

  it('behaves exactly as before when no predicate is given', () => {
    const table: QueueTable = new Map();
    enqueue(table, entry('a', 'chess', 1000));
    enqueue(table, entry('b', 'chess', 2000));
    expect(takePair(table, 'chess', 'b')?.first.playerId).toBe('a');
  });
});
