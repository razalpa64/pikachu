/**
 * The matchmaking queue, as a data structure and nothing else.
 *
 * Kept out of `index.ts` on purpose: the relay's socket handling is impossible to
 * unit-test, but "who gets paired with whom" is the part where a bug is a ruined
 * evening for two strangers. This file has no sockets, no timers and no state of
 * its own — pass the table in, get an answer out — so `matchmaking.test.ts` can
 * hammer it directly.
 */
export interface QueueEntry {
  playerId: string;
  /** Carried with the entry so a matched pair is seated with the names they
      queued under, rather than whatever their socket says later. */
  name: string;
  mascot: string;
  gameId: string;
  /** When they started waiting. Older wins, so the queue is served, not shuffled. */
  since: number;
  /** The room settings they asked for; the longest-waiting player's choice wins. */
  settings: Record<string, unknown>;
  roomName: string;
  /** Set once the "nobody yet" notice has been sent, so it is sent once. */
  noticed?: boolean;
}

/** gameId → entries, oldest first. */
export type QueueTable = Map<string, QueueEntry[]>;

/** Stop waiting quietly. Five minutes is long enough to feel abandoned. */
export const QUEUE_TTL_MS = 1000 * 60 * 5;
/** After this long, tell the player nobody has turned up yet — but keep waiting. */
export const QUEUE_NOTICE_MS = 1000 * 30;

function bucket(table: QueueTable, gameId: string): QueueEntry[] {
  let list = table.get(gameId);
  if (!list) {
    list = [];
    table.set(gameId, list);
  }
  return list;
}

/**
 * Join the queue for one game.
 *
 * One entry per player, ever: queueing for a second game moves you rather than
 * cloning you, and queueing twice does not jump anybody ahead. A player who is
 * already waiting keeps their original place in line.
 */
export function enqueue(table: QueueTable, entry: QueueEntry): void {
  const existing = find(table, entry.playerId);
  if (existing) {
    if (existing.entry.gameId === entry.gameId) return;
    dequeue(table, entry.playerId);
  }
  bucket(table, entry.gameId).push(entry);
}

/** Leave the queue. Returns the entry that was dropped, if any. */
export function dequeue(table: QueueTable, playerId: string): QueueEntry | null {
  for (const [gameId, list] of table) {
    const at = list.findIndex((e) => e.playerId === playerId);
    if (at >= 0) {
      const [gone] = list.splice(at, 1);
      if (list.length === 0) table.delete(gameId);
      return gone;
    }
  }
  return null;
}

export function find(table: QueueTable, playerId: string): { entry: QueueEntry; gameId: string } | null {
  for (const [gameId, list] of table) {
    const entry = list.find((e) => e.playerId === playerId);
    if (entry) return { entry, gameId };
  }
  return null;
}

/**
 * The longest-waiting *other* player in the same game — never yourself, even if
 * a stale entry of yours is somehow still in the list.
 */
export function partnerFor(table: QueueTable, gameId: string, playerId: string): QueueEntry | null {
  const list = table.get(gameId);
  if (!list) return null;
  let best: QueueEntry | null = null;
  for (const entry of list) {
    if (entry.playerId === playerId) continue;
    if (!best || entry.since < best.since) best = entry;
  }
  return best;
}

/**
 * Take both players out of the queue and hand them over, in waiting order.
 * Returns null when there is nobody to pair with — the caller keeps waiting.
 */
export function takePair(
  table: QueueTable,
  gameId: string,
  playerId: string,
): { first: QueueEntry; second: QueueEntry } | null {
  const partner = partnerFor(table, gameId, playerId);
  if (!partner) return null;
  const mine = dequeue(table, playerId);
  if (!mine) return null;
  const theirs = dequeue(table, partner.playerId);
  if (!theirs) {
    /* Defensive: put ourselves back rather than silently dropping out. Cannot
       happen without a concurrent mutation, and this file has none. */
    enqueue(table, mine);
    return null;
  }
  return mine.since <= theirs.since
    ? { first: mine, second: theirs }
    : { first: theirs, second: mine };
}

/** Drop entries that have waited too long. Returns them so the caller can say so. */
export function sweepQueue(table: QueueTable, now: number, ttlMs: number = QUEUE_TTL_MS): QueueEntry[] {
  const expired: QueueEntry[] = [];
  for (const [gameId, list] of table) {
    const keep = list.filter((e) => {
      if (now - e.since >= ttlMs) { expired.push(e); return false; }
      return true;
    });
    if (keep.length) table.set(gameId, keep);
    else table.delete(gameId);
  }
  return expired;
}

/** Entries that have just crossed the "nobody yet" mark, each exactly once. */
export function dueForNotice(table: QueueTable, now: number, noticeMs: number = QUEUE_NOTICE_MS): QueueEntry[] {
  const due: QueueEntry[] = [];
  for (const list of table.values()) {
    for (const entry of list) {
      if (!entry.noticed && now - entry.since >= noticeMs) {
        entry.noticed = true;
        due.push(entry);
      }
    }
  }
  return due;
}

/** How many are waiting, per game. Used for the lobby counts. */
export function waitingCounts(table: QueueTable): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [gameId, list] of table) if (list.length) out[gameId] = list.length;
  return out;
}
