/**
 * PIKACHU — authoritative relay server.
 *
 * Responsibilities:
 *   • owns the room + match state machines
 *   • validates EVERY action with the same rules module the browser uses
 *   • redacts hidden information per player (battleship fleets, memory deck)
 *   • stamps reaction-duel timings itself
 *   • survives refresh/disconnect via a reconnection grace window
 *
 * The browser is never trusted for legality, scores, or outcomes.
 */
import http from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import type { Slot } from '../src/games/types';
import { REFEREES } from '../src/games/referees';
import { chessRules, resign as chessResign, agreeDraw, startClock } from '../src/games/chess/rules';
import { checkersRules, resignCheckers } from '../src/games/checkers/rules';
import {
  ROOM_TTL_MS, RECONNECT_GRACE_MS, START_COUNTDOWN_MS, MATCH_START_DELAY_MS,
  type ClientMsg, type ServerMsg, type RoomStatus, type RoomView, type MemberView,
  type PresenceView, type QueueView,
} from './protocol';
import {
  QUEUE_NOTICE_MS, dueForNotice, dequeue, enqueue, find as findInQueue, onlyBlockedWaiters,
  sweepQueue, takePair, waitingCounts, type QueueEntry, type QueueTable,
} from './queue';
import { authConfigured, verifyAccessToken } from './auth';
import {
  INVITE_TTL_MS, blockedBetween, blocker, chatAllowed, forgetAccount, rememberBlocks,
  sanitizeBlocks, sweepInvites, takeInvite,
  type AccountIndex, type BlockIndex, type Invite,
} from './safety';

const PORT = Number(process.env.PORT ?? process.env.RELAY_PORT ?? 8787);
const DATA_DIR = path.resolve(process.cwd(), '.pikachu-data');
const HISTORY_FILE = path.join(DATA_DIR, 'matches.json');

/* ------------------------------------------------------------------ registry */
/* The referee list lives in src/games/referees.ts so the browser, the server and
   the catalogue test all read the same map. */
const RULES = REFEREES;
/**
 * Games whose state advances on a server timer.
 *
 * `wyr` and `wordbomb` belong here for a reason worth spelling out: both have a
 * deadline that *ends a turn even if nobody touches anything*. Would You
 * Rather reveals and moves on when its window closes; Word Bomb strikes the
 * player who lets the fuse reach zero. If the relay does not tick them, a
 * silent opponent stalls the match forever and the clock is decoration.
 *
 * `bluff` is on the list for the same reason: writing and voting each have a
 * deadline, and a table where one player walks away has to reach its reveal
 * without anybody nudging the server.
 */
const TICKING = new Set(['reaction', 'chess', 'trivia', 'sketch', 'wyr', 'wordbomb', 'bluff']);

/* ------------------------------------------------------------------ model */
interface Member {
  id: string; name: string; mascot: string; slot: Slot;
  ready: boolean; connected: boolean; lastSeen: number; rematchVote: boolean;
  sockets: Set<WebSocket>;
  /** The verified account behind this seat, if the player signed in. */
  accountId: string | null;
  /** Their public handle, if the account has one. */
  handle: string | null;
}
interface Match {
  id: string; gameId: string; seq: number; state: any;
  startedAt: number; finishedAt: number | null;
  winnerSlot: Slot | null; reason: string;
  lastAction: string | null;
  seenActions: Set<string>;     // idempotency: playerId:clientSeq
}
interface Room {
  code: string; roomName: string; gameId: string;
  mode: 'online' | 'coop';
  settings: Record<string, unknown>;
  status: RoomStatus;
  hostId: string;
  members: Map<string, Member>;
  createdAt: number; expiresAt: number; startsAt: number | null;
  match: Match | null;
  series: { games: number; wins: [number, number]; draws: number };
  history: { matchId: string; winnerSlot: Slot | null; reason: string; finishedAt: number }[];
  seedCounter: number;
  /** Opened by matchmaking rather than by a host — the pair starts on its own. */
  matchmade: boolean;
  /** Still true until the first countdown completes: if somebody drops during
      that countdown the pair must be able to start again without either of them
      knowing to press "ready" at a stranger. Cleared by the first beginMatch. */
  autoStart: boolean;
}

const rooms = new Map<string, Room>();
interface SocketMeta {
  playerId: string; name: string; mascot: string; code: string | null;
  /** Set only after a token was verified by the auth server. */
  accountId: string | null;
  handle: string | null;
  /** Account ids this player asked not to meet. */
  blocks: string[];
}
const socketMeta = new WeakMap<WebSocket, SocketMeta>();
/** playerId → verified account id, so the queue can ask "are these two blocked?" */
const accounts: AccountIndex = new Map();
/** account id → the accounts it will not play with */
const blocksByAccount: BlockIndex = new Map();
/** Friend invitations waiting for an answer. */
const invites = new Map<string, Invite>();
/** gameId → players waiting for a stranger. See ./queue.ts for the rules. */
const queue: QueueTable = new Map();
/** Last presence payload sent, so an unchanged lobby does not re-broadcast. */
let lastPresence = '';

/* ------------------------------------------------------------------ helpers */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function newCode(): string {
  let code = '';
  do {
    code = Array.from({ length: 5 }, () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function send(ws: WebSocket, msg: ServerMsg) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}
function fail(ws: WebSocket, code: string, message: string, recovery?: string) {
  send(ws, { t: 'error', code, message, recovery });
}

function roomView(room: Room): RoomView {
  const members: MemberView[] = [...room.members.values()]
    .sort((a, b) => a.slot - b.slot)
    .map((m) => ({
      id: m.id, name: m.name, mascot: m.mascot, slot: m.slot, ready: m.ready,
      connected: m.connected, isHost: m.id === room.hostId, lastSeen: m.lastSeen,
      rematchVote: m.rematchVote, accountId: m.accountId, handle: m.handle,
    }));
  return {
    code: room.code, roomName: room.roomName, gameId: room.gameId, mode: room.mode,
    settings: room.settings, status: room.status, members, hostId: room.hostId,
    createdAt: room.createdAt, expiresAt: room.expiresAt, startsAt: room.startsAt,
    matchId: room.match?.id ?? null, series: room.series, history: room.history.slice(-12),
    chatOpen: chatAllowed({
      matchmade: room.matchmade, historyLength: room.history.length, status: room.status,
    }),
  };
}

function broadcastRoom(room: Room) {
  const view = roomView(room);
  for (const m of room.members.values())
    for (const ws of m.sockets) send(ws, { t: 'room', room: view, you: { slot: m.slot, id: m.id } });
}

/* ---------------------------------------------------------------- presence */

/**
 * What the lobby is allowed to know: how many people are playing each game and
 * how many are waiting for one. No names, no ids — a count is all a "quick
 * match" button needs, and a count is all this ever returns.
 */
function presenceNow(): PresenceView {
  const games: PresenceView['games'] = {};
  const bump = (gameId: string, key: 'playing' | 'waiting', n = 1) => {
    games[gameId] ??= { playing: 0, waiting: 0 };
    games[gameId][key] += n;
  };
  for (const room of rooms.values()) {
    if (room.status === 'EXPIRED' || room.status === 'CANCELLED') continue;
    const seen = new Set<string>();
    for (const m of room.members.values()) if (m.connected && !seen.has(m.id)) { seen.add(m.id); }
    if (seen.size) bump(room.gameId, 'playing', seen.size);
  }
  for (const [gameId, n] of Object.entries(waitingCounts(queue))) bump(gameId, 'waiting', n);
  const people = new Set<string>();
  for (const ws of wss.clients) {
    const meta = socketMeta.get(ws);
    if (meta?.playerId) people.add(meta.playerId);
  }
  return { games, players: people.size, at: Date.now() };
}

function broadcastPresence() {
  const presence = presenceNow();
  const key = JSON.stringify([presence.games, presence.players]);
  if (key === lastPresence) return;
  lastPresence = key;
  for (const ws of wss.clients) send(ws, { t: 'presence', presence });
}

function queueView(status: QueueView['status'], entry: QueueEntry | null, gameId: string | null): QueueView {
  const waiting = gameId ? (queue.get(gameId)?.length ?? 0) : 0;
  const view: QueueView = { status, gameId, waiting, since: entry?.since ?? null };
  /* Honest, and carefully one-sided: the note appears only when everybody else
     waiting is somebody *this* player blocked. Being told "everyone waiting has
     blocked you" would be a way to detect a block, which is exactly what a block
     must never reveal. So only their own list is consulted here. */
  if (status === 'waiting' && entry && onlyBlockedWaiters(
    queue, entry.gameId, entry.playerId, (mine, other) => blockedByMe(mine).has(other),
  )) {
    view.note = 'blocked';
  }
  return view;
}

/** "May these two be matched?" — a block in either direction says no. */
function pairBlocked(a: string, b: string) {
  return blockedBetween(accounts, blocksByAccount, a, b);
}

/** The player ids this player has blocked themselves — nobody else's list. */
function blockedByMe(playerId: string): Set<string> {
  const account = accounts.get(playerId);
  if (!account) return new Set();
  const mine = blocksByAccount.get(account);
  if (!mine) return new Set();
  /* Player ids are 'u:<account>' for anybody signed in, so the sets line up
     without another lookup. */
  return new Set([...mine].map((id) => `u:${id}`));
}

/* ------------------------------------------------------------ room building */

function seat(
  room: Room,
  meta: { playerId: string; name: string; mascot: string; accountId?: string | null; handle?: string | null },
  ws: WebSocket,
): Member {
  const taken = new Set([...room.members.values()].map((m) => m.slot));
  const slot: Slot = taken.has(0) ? 1 : 0;      // never two players in one slot
  const member: Member = {
    id: meta.playerId, name: meta.name, mascot: meta.mascot, slot,
    ready: false, connected: true, lastSeen: Date.now(), rematchVote: false, sockets: new Set([ws]),
    accountId: meta.accountId ?? null,
    handle: meta.handle ?? null,
  };
  room.members.set(meta.playerId, member);
  socketMeta.get(ws)!.code = room.code;
  return member;
}

function openRoom(
  meta: { playerId: string; name: string; mascot: string; accountId?: string | null; handle?: string | null },
  ws: WebSocket,
  spec: { gameId: string; settings: Record<string, unknown>; roomName: string; mode: 'online' | 'coop'; matchmade?: boolean },
): Room {
  const code = newCode();
  const room: Room = {
    code, roomName: spec.roomName.slice(0, 40) || 'Private Arena',
    gameId: spec.gameId, mode: spec.mode,
    settings: sanitiseSettings(spec.settings), status: 'WAITING',
    hostId: meta.playerId, members: new Map(),
    createdAt: Date.now(), expiresAt: Date.now() + ROOM_TTL_MS, startsAt: null,
    match: null, series: { games: 0, wins: [0, 0], draws: 0 }, history: [], seedCounter: 0,
    matchmade: !!spec.matchmade, autoStart: !!spec.matchmade,
  };
  seat(room, meta, ws);
  rooms.set(code, room);
  return room;
}

/**
 * Pair two queued players and open a room for them.
 *
 * The one who waited longer hosts and their settings are used, because they are
 * the one who has been sitting there looking at the board they chose. Both are
 * marked ready and the countdown starts immediately: a stranger does not need to
 * press "ready" at a person they have never met, and a countdown is a fairer
 * start signal than whoever's screen loaded first.
 */
function matchPair(gameId: string, first: QueueEntry, second: QueueEntry) {
  const socketsFor = (playerId: string): WebSocket[] => {
    const out: WebSocket[] = [];
    for (const ws of wss.clients) {
      const meta = socketMeta.get(ws);
      if (meta?.playerId === playerId && ws.readyState === WebSocket.OPEN) out.push(ws);
    }
    return out;
  };

  const firstSockets = socketsFor(first.playerId);
  const secondSockets = socketsFor(second.playerId);
  if (!firstSockets.length || !secondSockets.length) {
    /* One of them closed the tab between queueing and being picked. Put the
       survivor back in the queue rather than pairing into a room nobody is
       sitting in — and give them a fresh wait, not their old expired one. */
    if (firstSockets.length) enqueue(queue, { ...first, since: Date.now(), noticed: true });
    if (secondSockets.length) enqueue(queue, { ...second, since: Date.now(), noticed: true });
    broadcastPresence();
    return;
  }

  const room = openRoom(
    {
      playerId: first.playerId, name: first.name, mascot: first.mascot,
      accountId: accounts.get(first.playerId) ?? null,
      handle: handleOf(first.playerId),
    },
    firstSockets[0],
    {
      gameId,
      settings: first.settings,
      roomName: first.roomName || 'Quick match',
      mode: 'online',
      matchmade: true,
    },
  );
  const host = room.members.get(first.playerId)!;
  for (const ws of firstSockets.slice(1)) {
    host.sockets.add(ws);
    socketMeta.get(ws)!.code = room.code;
  }

  const guest = seat(room, {
    playerId: second.playerId, name: second.name, mascot: second.mascot,
    accountId: accounts.get(second.playerId) ?? null,
    handle: handleOf(second.playerId),
  }, secondSockets[0]);
  for (const ws of secondSockets.slice(1)) {
    guest.sockets.add(ws);
    socketMeta.get(ws)!.code = room.code;
  }

  /* Both ready, countdown running: a stranger should not have to press "ready"
     at someone they have never met, and a shared countdown is a fairer start
     than whoever's screen happened to load first. */
  room.status = 'STARTING';
  room.startsAt = Date.now() + MATCH_START_DELAY_MS;
  room.autoStart = true;
  for (const m of room.members.values()) { m.ready = true; m.rematchVote = false; }
  touch(room);

  for (const player of [first, second])
    for (const ws of [...firstSockets, ...secondSockets])
      if (socketMeta.get(ws)?.playerId === player.playerId)
        send(ws, { t: 'queue', queue: queueView('matched', null, gameId) });

  broadcastRoom(room);
  broadcastPresence();
  console.log(`[relay] matched ${first.playerId.slice(0, 8)} + ${second.playerId.slice(0, 8)} → ${room.code} (${gameId})`);
}

function stateFor(room: Room, slot: Slot) {
  const match = room.match!;
  const rules = RULES[match.gameId];
  return rules.redact ? rules.redact(match.state, slot) : match.state;
}

function broadcastState(room: Room) {
  if (!room.match) return;
  const match = room.match;
  for (const m of room.members.values())
    for (const ws of m.sockets)
      send(ws, {
        t: 'state', matchId: match.id, seq: match.seq, state: stateFor(room, m.slot),
        yourSlot: m.slot, lastAction: match.lastAction, serverTime: Date.now(),
      });
}

function touch(room: Room) { room.expiresAt = Date.now() + ROOM_TTL_MS; }

/* ------------------------------------------------------------------ persistence (dev history) */
function persistMatch(room: Room, match: Match) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const rows = fs.existsSync(HISTORY_FILE) ? JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8')) : [];
    const members = [...room.members.values()].sort((a, b) => a.slot - b.slot);
    rows.push({
      matchId: match.id, roomCode: room.code, gameId: match.gameId,
      players: members.map((m) => ({ id: m.id, name: m.name, slot: m.slot })),
      winnerSlot: match.winnerSlot, reason: match.reason,
      startedAt: match.startedAt, finishedAt: match.finishedAt,
    });
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(rows.slice(-800), null, 2));
  } catch { /* history is best-effort; never breaks a match */ }
}

/* ------------------------------------------------------------------ match lifecycle */
function beginMatch(room: Room) {
  const rules = RULES[room.gameId];
  room.seedCounter += 1;
  const seed = (Date.now() ^ (room.seedCounter * 2654435761)) >>> 0;
  let state = rules.createInitialState(room.settings, seed);
  if (room.gameId === 'chess') state = startClock(state);
  room.match = {
    id: randomUUID(), gameId: room.gameId, seq: 0, state,
    startedAt: Date.now(), finishedAt: null, winnerSlot: null, reason: '',
    lastAction: null, seenActions: new Set(),
  };
  room.status = 'IN_GAME';
  room.startsAt = null;
  room.autoStart = false;
  for (const m of room.members.values()) m.rematchVote = false;
  broadcastRoom(room);
  broadcastState(room);
}

/** Re-deliver the verdict of an already-finished match to one socket (reconnect / late join). */
function sendFinishedTo(ws: WebSocket, room: Room, slot: 0 | 1) {
  const match = room.match;
  if (!match?.finishedAt) return;
  send(ws, {
    t: 'finished', matchId: match.id, winnerSlot: match.winnerSlot ?? null,
    reason: match.reason ?? 'complete', state: stateFor(room, slot),
  });
}

function completeMatch(room: Room) {
  const match = room.match;
  if (!match || match.finishedAt) return;
  const rules = RULES[match.gameId];
  const res = rules.result(match.state);
  if (!res.over) return;
  match.finishedAt = Date.now();
  match.winnerSlot = res.winner;
  match.reason = res.reason;
  room.status = 'COMPLETED';
  room.series.games += 1;
  if (res.winner === null) room.series.draws += 1;
  else room.series.wins[res.winner] += 1;
  room.history.push({ matchId: match.id, winnerSlot: res.winner, reason: res.reason, finishedAt: match.finishedAt });
  persistMatch(room, match);
  for (const m of room.members.values())
    for (const ws of m.sockets)
      send(ws, { t: 'finished', matchId: match.id, winnerSlot: res.winner, reason: res.reason, state: stateFor(room, m.slot) });
  broadcastRoom(room);
}

/* ------------------------------------------------------------------ ticking */
let lastQueueSweep = 0;
setInterval(() => {
  const now = Date.now();

  /* Queue housekeeping, once a second rather than every tick: tell anyone who
     has waited 30s that the room is still empty (once), and drop waits older
     than five minutes. Presence follows every change, throttled by the diff. */
  if (now - lastQueueSweep > 1000) {
    lastQueueSweep = now;
    for (const entry of dueForNotice(queue, now, QUEUE_NOTICE_MS)) {
      for (const ws of wss.clients) {
        if (socketMeta.get(ws)?.playerId !== entry.playerId) continue;
        send(ws, { t: 'queue', queue: { status: 'timeout', gameId: entry.gameId, waiting: queue.get(entry.gameId)?.length ?? 0, since: entry.since } });
      }
    }
    for (const entry of sweepQueue(queue, now)) {
      for (const ws of wss.clients) {
        if (socketMeta.get(ws)?.playerId !== entry.playerId) continue;
        send(ws, { t: 'queue', queue: { status: 'expired', gameId: entry.gameId, waiting: 0, since: null } });
      }
    }
    /* An invitation nobody answered cannot seat anybody afterwards. */
    for (const invite of sweepInvites(invites, now, INVITE_TTL_MS)) {
      for (const ws of wss.clients) {
        if (socketMeta.get(ws)?.playerId !== invite.fromPlayer) continue;
        send(ws, { t: 'inviteClosed', inviteId: invite.id, reason: 'expired' });
      }
    }
    broadcastPresence();
  }

  for (const [code, room] of rooms) {
    // expiry
    if (now > room.expiresAt) {
      room.status = 'EXPIRED';
      broadcastRoom(room);
      for (const m of room.members.values()) for (const ws of m.sockets) ws.close(4001, 'room expired');
      rooms.delete(code);
      continue;
    }
    // reconnection grace → mark disconnected members
    for (const m of room.members.values()) {
      if (!m.connected && room.status === 'WAITING' && now - m.lastSeen > RECONNECT_GRACE_MS * 4) {
        room.members.delete(m.id);
        if (room.hostId === m.id) {
          const next = [...room.members.values()][0];
          if (next) room.hostId = next.id; else { rooms.delete(code); continue; }
        }
        broadcastRoom(room);
      }
    }
    // a matchmade pair whose countdown was broken by a drop starts again
    if (
      room.autoStart &&
      (room.status === 'WAITING' || room.status === 'READY_CHECK') &&
      room.members.size === 2 &&
      [...room.members.values()].every((m) => m.connected)
    ) {
      for (const m of room.members.values()) { m.ready = true; m.rematchVote = false; }
      room.status = 'STARTING';
      room.startsAt = now + MATCH_START_DELAY_MS;
      broadcastRoom(room);
      continue;
    }
    // countdown → start
    if (room.status === 'STARTING' && room.startsAt !== null && now >= room.startsAt) {
      beginMatch(room);
      continue;
    }
    // per-game server tick
    const match = room.match;
    if (match && !match.finishedAt && TICKING.has(match.gameId)) {
      const rules = RULES[match.gameId];
      if (rules.tick) {
        const before = match.state;
        const after = rules.tick(before, now);
        if (after !== before) {
          match.state = after;
          match.seq += 1;
          broadcastState(room);
          if (rules.result(after).over) completeMatch(room);
        }
      }
    }
  }
}, 120);

/* ------------------------------------------------------------------ rate limiting */
const buckets = new Map<string, { tokens: number; ts: number }>();
function allow(key: string, perMinute: number): boolean {
  const now = Date.now();
  const b = buckets.get(key) ?? { tokens: perMinute, ts: now };
  const refill = ((now - b.ts) / 60000) * perMinute;
  b.tokens = Math.min(perMinute, b.tokens + refill);
  b.ts = now;
  if (b.tokens < 1) { buckets.set(key, b); return false; }
  b.tokens -= 1;
  buckets.set(key, b);
  return true;
}

/* ------------------------------------------------------------------ http */
const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (url.pathname === '/api/health') {
    res.end(JSON.stringify({
      ok: true, rooms: rooms.size, uptime: process.uptime(), games: Object.keys(RULES),
      waiting: waitingCounts(queue),
    }));
    return;
  }
  /* The same counts the socket pushes, for a lobby that wants to ask before it
     connects — and for the e2e script, which should not have to speak WebSocket
     to check that a queue is empty again. */
  if (url.pathname === '/api/presence') {
    res.end(JSON.stringify(presenceNow()));
    return;
  }
  if (url.pathname.startsWith('/api/room/')) {
    const code = url.pathname.split('/').pop()!.toUpperCase();
    const room = rooms.get(code);
    if (!room) { res.statusCode = 404; res.end(JSON.stringify({ error: 'not_found' })); return; }
    // public peek: enough to render the join screen, nothing private
    res.end(JSON.stringify({
      code: room.code, gameId: room.gameId, roomName: room.roomName, status: room.status,
      players: room.members.size, capacity: 2, mode: room.mode,
      host: [...room.members.values()].find((m) => m.id === room.hostId)?.name ?? 'Trainer',
    }));
    return;
  }
  if (url.pathname === '/api/history') {
    try {
      const rows = fs.existsSync(HISTORY_FILE) ? JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8')) : [];
      res.end(JSON.stringify(rows.slice(-60).reverse()));
    } catch { res.end('[]'); }
    return;
  }
  res.statusCode = 404;
  res.end(JSON.stringify({ error: 'not_found' }));
});

/* ------------------------------------------------------------------ websocket */
const wss = new WebSocketServer({ server, path: '/rt' });

function roomOf(ws: WebSocket): Room | null {
  const meta = socketMeta.get(ws);
  if (!meta?.code) return null;
  return rooms.get(meta.code) ?? null;
}
function memberOf(ws: WebSocket): { room: Room; me: Member } | null {
  const room = roomOf(ws);
  const meta = socketMeta.get(ws);
  if (!room || !meta) return null;
  const me = room.members.get(meta.playerId);
  return me ? { room, me } : null;
}

/** Every other live socket belonging to one player (two tabs, same trainer). */
function otherSocketsFor(playerId: string, except: WebSocket): WebSocket[] {
  const out: WebSocket[] = [];
  for (const ws of wss.clients) {
    if (ws === except) continue;
    const meta = socketMeta.get(ws);
    if (meta?.playerId === playerId && ws.readyState === WebSocket.OPEN) out.push(ws);
  }
  return out;
}

/** The public handle of a signed-in player, if their socket says one. */
function handleOf(playerId: string): string | null {
  for (const ws of wss.clients) {
    const meta = socketMeta.get(ws);
    if (meta?.playerId === playerId) return meta.handle;
  }
  return null;
}

/** Every live socket of a signed-in account, whichever tab it is. */
function socketsForAccount(accountId: string): WebSocket[] {
  const out: WebSocket[] = [];
  for (const ws of wss.clients) {
    const meta = socketMeta.get(ws);
    if (meta?.accountId === accountId && ws.readyState === WebSocket.OPEN) out.push(ws);
  }
  return out;
}

function detach(ws: WebSocket) {
  const meta = socketMeta.get(ws);
  /* A closed tab cannot keep waiting — but a player with another tab open must
     keep their place. Only the last socket of a player leaves the queue. */
  if (meta?.playerId && !otherSocketsFor(meta.playerId, ws).length) {
    if (dequeue(queue, meta.playerId)) broadcastPresence();
    /* The block index is rebuilt on the next hello, so a player who has gone is
       not kept in memory for the rest of the process's life. */
    if (meta.accountId) forgetAccount(accounts, blocksByAccount, meta.playerId);
    for (const [id, invite] of invites) {
      if (invite.fromPlayer === meta.playerId || invite.toAccount === meta.accountId) invites.delete(id);
    }
  }
  const ctx = memberOf(ws);
  if (!ctx) return;
  const { room, me } = ctx;
  me.sockets.delete(ws);
  if (me.sockets.size === 0) {
    me.connected = false;
    me.lastSeen = Date.now();
    me.ready = false;
    if (room.status === 'READY_CHECK' || room.status === 'STARTING') {
      room.status = 'WAITING';
      room.startsAt = null;
      for (const m of room.members.values()) m.ready = false;
    }
    broadcastRoom(room);
  }
}

wss.on('connection', (ws, req) => {
  socketMeta.set(ws, {
    playerId: '', name: '', mascot: 'classic', code: null,
    accountId: null, handle: null, blocks: [],
  });
  const ip = (req.socket.remoteAddress ?? 'anon');

  /* One message at a time, in order.
     `hello` may wait on the auth server, and a `queue` sent one millisecond later
     must not overtake it — the old synchronous handler could get away without
     this because nothing ever awaited. A rejected promise here must never take
     the process with it, so every link in the chain swallows and reports. */
  let chain: Promise<void> = Promise.resolve();
  ws.on('message', (raw) => {
    chain = chain
      .then(() => handleMessage(ws, raw, ip))
      .catch((err) => { console.error('[relay] message handler failed', err); });
  });

  ws.on('close', () => detach(ws));
  ws.on('error', () => detach(ws));
});

async function handleMessage(ws: WebSocket, raw: unknown, ip: string) {
    let msg: ClientMsg;
    try { msg = JSON.parse(String(raw)); } catch { return fail(ws, 'bad_json', 'Message could not be read.'); }
    const meta = socketMeta.get(ws);
    if (!meta) return;

    try {
      switch (msg.t) {
        /* ---------------------------------------------------------- hello */
        case 'hello': {
          if (!msg.playerId || typeof msg.playerId !== 'string' || msg.playerId.length > 64)
            return fail(ws, 'bad_identity', 'Invalid player identity.');

          /* A token means "I am this account". It is checked against the auth
             server, never decoded and believed: the payload of a JWT is just
             base64 until somebody with the key says otherwise. A verified player
             gets an account-derived id, so the id cannot be typed by somebody
             else — which is the whole point of a friend list. */
          if (msg.token) {
            const result = await verifyAccessToken(String(msg.token));
            if (!result.ok) {
              if (result.reason === 'unavailable') {
                /* Not the player's fault, and not evidence they are lying.
                   Refusing beats silently downgrading them to a guest, because a
                   guest is outside every block list. The client retries. */
                return fail(ws, 'auth_unavailable', 'Could not confirm your account just now.',
                  'The sign-in service did not answer. Try again in a moment.');
              }
              return fail(ws, 'auth_invalid', 'Your session has expired.',
                'Sign in again to play with friends.');
            }
            const account = result.user;
            meta.accountId = account.id;
            accounts.set(account.id, account.id);
            /* One player per account: the id is the account, so two tabs of the
               same person are two sockets of one player, as they should be. */
            meta.playerId = `u:${account.id}`;
            meta.handle = account.handle;
            rememberBlocks(blocksByAccount, account.id, sanitizeBlocks(msg.blocks));
            meta.blocks = sanitizeBlocks(msg.blocks);
            accounts.set(meta.playerId, account.id);
          } else {
            meta.playerId = msg.playerId;
            meta.accountId = null;
            meta.blocks = sanitizeBlocks(msg.blocks);
          }
          meta.name = String(msg.name ?? 'Trainer').slice(0, 24) || 'Trainer';
          meta.mascot = String(msg.mascot ?? 'classic').slice(0, 24);

          /* A socket that changes identity (signing in on an open tab) must not
             leave the old player id behind in the block index. */
          for (const ws2 of wss.clients) {
            const other = socketMeta.get(ws2);
            if (other && ws2 !== ws && meta.accountId && other.playerId === meta.playerId && !other.accountId) {
              other.playerId = '';
            }
          }

          send(ws, {
            t: 'welcome', playerId: meta.playerId, serverTime: Date.now(),
            verified: Boolean(meta.accountId), handle: meta.handle,
          });
          send(ws, { t: 'presence', presence: presenceNow() });

          // auto-resume: reattach to a room we are still a member of
          const resume = msg.resumeCode?.toUpperCase();
          if (resume && rooms.has(resume)) {
            const room = rooms.get(resume)!;
            const me = room.members.get(meta.playerId);
            if (me) {
              me.sockets.add(ws); me.connected = true; me.lastSeen = Date.now();
              me.name = meta.name; me.mascot = meta.mascot;
              meta.code = room.code; touch(room);
              broadcastRoom(room);
              if (room.match) broadcastState(room);
              // a refresh right after the final move must still show the result screen
              sendFinishedTo(ws, room, me.slot);
            }
          }
          return;
        }

        /* ---------------------------------------------------------- create */
        case 'create': {
          if (!meta.playerId) return fail(ws, 'no_identity', 'Say hello first.');
          if (!allow(`create:${meta.playerId}:${ip}`, 20))
            return fail(ws, 'rate_limited', 'Too many rooms created. Wait a moment.', 'Try again in about a minute.');
          const rules = RULES[msg.gameId];
          if (!rules) return fail(ws, 'unknown_game', 'That game has no online referee yet.', 'Pick another game from the library.');
          dequeue(queue, meta.playerId);            // opening a room leaves the queue
          const room = openRoom(
            {
              playerId: meta.playerId, name: meta.name, mascot: meta.mascot,
              accountId: meta.accountId, handle: meta.handle,
            },
            ws,
            {
            gameId: msg.gameId,
            settings: msg.settings,
            roomName: String(msg.roomName ?? '') || 'Private Arena',
            mode: msg.mode === 'coop' ? 'coop' : 'online',
          });
          broadcastRoom(room);
          broadcastPresence();
          return;
        }

        /* ----------------------------------------------------------- queue
           "Find me an opponent." The server owns the pairing and creates the
           room itself, so the two players never exchange a code: they are told
           'matched', then handed the same room. */
        case 'queue': {
          if (!meta.playerId) return fail(ws, 'no_identity', 'Say hello first.');
          const rules = RULES[msg.gameId];
          if (!rules) return fail(ws, 'unknown_game', 'That game has no online referee yet.', 'Pick another game from the library.');
          if (memberOf(ws)) return fail(ws, 'in_room', 'You are already in an arena.', 'Leave it first, then look for a random opponent.');
          if (!allow(`queue:${meta.playerId}`, 20))
            return fail(ws, 'rate_limited', 'Too many matchmaking attempts.', 'Wait a minute, then try again.');

          enqueue(queue, {
            playerId: meta.playerId, name: meta.name, mascot: meta.mascot,
            gameId: msg.gameId,
            since: Date.now(),
            settings: msg.settings ?? {},
            roomName: String(msg.roomName ?? '').slice(0, 40),
          });
          const mine = findInQueue(queue, meta.playerId)?.entry ?? null;
          broadcastPresence();
          const partner = takePair(queue, msg.gameId, meta.playerId, pairBlocked);
          if (partner) { matchPair(msg.gameId, partner.first, partner.second); return; }
          send(ws, { t: 'queue', queue: queueView('waiting', mine, msg.gameId) });
          return;
        }

        case 'unqueue': {
          if (!meta.playerId) return;
          const dropped = dequeue(queue, meta.playerId);
          send(ws, { t: 'queue', queue: queueView('cancelled', null, dropped?.gameId ?? null) });
          broadcastPresence();
          return;
        }

        /* ---------------------------------------------------------- join */
        case 'join': {
          if (!meta.playerId) return fail(ws, 'no_identity', 'Say hello first.');
          if (!allow(`join:${ip}`, 60)) return fail(ws, 'rate_limited', 'Too many join attempts.', 'Wait a few seconds, then retry.');
          const code = String(msg.code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
          const room = rooms.get(code);
          if (!room) return fail(ws, 'room_not_found', `No arena with code ${code}.`, 'Check the code, or ask for a fresh invite link.');
          if (room.status === 'EXPIRED' || room.status === 'CANCELLED')
            return fail(ws, 'room_closed', 'That arena has closed.', 'Ask your opponent to open a new room.');
          touch(room);

          /* A block survives a shared code: if either side has blocked the
             other, this room is not available to them, and the message does not
             say which of the two did the blocking. */
          for (const m of room.members.values()) {
            if (m.id !== meta.playerId && blockedBetween(accounts, blocksByAccount, meta.playerId, m.id)) {
              return fail(ws, 'blocked', 'You cannot join that arena.',
                'Pick another room, or look for a random opponent instead.');
            }
          }

          const existing = room.members.get(meta.playerId);
          if (existing) {                                   // reconnect, keeps the slot
            existing.sockets.add(ws); existing.connected = true; existing.lastSeen = Date.now();
            existing.name = meta.name; existing.mascot = meta.mascot;
            meta.code = code;
            broadcastRoom(room);
            if (room.match) broadcastState(room);
            sendFinishedTo(ws, room, existing.slot);
            return;
          }
          if (room.members.size >= 2)
            return fail(ws, 'room_full', 'This arena already has two trainers.', 'Create your own room and send a fresh code.');

          const takenSlots = new Set([...room.members.values()].map((m) => m.slot));
          const slot: Slot = takenSlots.has(0) ? 1 : 0;      // never two players in one slot
          room.members.set(meta.playerId, {
            id: meta.playerId, name: meta.name, mascot: meta.mascot, slot,
            ready: false, connected: true, lastSeen: Date.now(), rematchVote: false, sockets: new Set([ws]),
            accountId: meta.accountId, handle: meta.handle,
          });
          meta.code = code;
          dequeue(queue, meta.playerId);            // joined by code: out of the queue
          if (room.status === 'WAITING' && room.members.size === 2) room.status = 'READY_CHECK';
          broadcastRoom(room);
          broadcastPresence();
          if (room.match) broadcastState(room);
          return;
        }

        /* ---------------------------------------------------------- ready */
        case 'ready': {
          const ctx = memberOf(ws);
          if (!ctx) return fail(ws, 'not_in_room', 'You are not in an arena.');
          const { room, me } = ctx;
          if (room.status !== 'WAITING' && room.status !== 'READY_CHECK' && room.status !== 'COMPLETED')
            return;
          me.ready = !!msg.ready;
          touch(room);
          if (room.members.size === 2 && room.status === 'WAITING') room.status = 'READY_CHECK';
          broadcastRoom(room);
          return;
        }

        /* ---------------------------------------------------------- start */
        case 'start': {
          const ctx = memberOf(ws);
          if (!ctx) return fail(ws, 'not_in_room', 'You are not in an arena.');
          const { room, me } = ctx;
          if (me.id !== room.hostId) return fail(ws, 'not_host', 'Only the host can start the match.');
          if (room.status === 'STARTING' || room.status === 'IN_GAME') return;   // idempotent: no duplicate starts
          if (room.members.size < 2) return fail(ws, 'need_two', 'Waiting for a second trainer.', 'Share your room code.');
          const all = [...room.members.values()];
          if (!all.every((m) => m.connected)) return fail(ws, 'opponent_offline', 'Your opponent is reconnecting.', 'Give them a few seconds.');
          if (!all.every((m) => m.ready)) return fail(ws, 'not_ready', 'Both trainers must ready up.');
          room.status = 'STARTING';
          room.startsAt = Date.now() + START_COUNTDOWN_MS;
          touch(room);
          broadcastRoom(room);
          return;
        }

        /* ---------------------------------------------------------- action */
        case 'action': {
          const ctx = memberOf(ws);
          if (!ctx) return fail(ws, 'not_in_room', 'You are not in an arena.');
          const { room, me } = ctx;
          const match = room.match;
          if (!match) return fail(ws, 'no_match', 'No match is running.');
          if (match.finishedAt) return fail(ws, 'match_over', 'That match has already finished.', 'Vote for a rematch.');
          if (msg.matchId !== match.id)
            return fail(ws, 'stale_match', 'Your client was out of date.', 'The board has been resynchronised.');

          // idempotency — a retried action never applies twice
          const stamp = `${me.id}:${msg.clientSeq}`;
          if (match.seenActions.has(stamp)) { broadcastState(room); return; }

          const rules = RULES[match.gameId];
          if (!rules.isLegal(match.state, me.slot, msg.move))
            return fail(ws, 'illegal_move', 'That move is not legal right now.', 'The authoritative board has been resent.');

          match.seenActions.add(stamp);
          match.state = rules.applyMove(match.state, me.slot, msg.move as any);
          match.seq += 1;
          match.lastAction = rules.describeMove?.(match.state, me.slot, msg.move as any) ?? null;
          touch(room);
          broadcastState(room);
          if (rules.result(match.state).over) completeMatch(room);
          return;
        }

        /* ---------------------------------------------------------- resign / draw */
        case 'resign': {
          const ctx = memberOf(ws);
          if (!ctx?.room.match || ctx.room.match.finishedAt) return;
          const { room, me } = ctx;
          const g = room.match!.gameId;
          if (g === 'chess') room.match!.state = chessResign(room.match!.state, me.slot);
          else if (g === 'checkers') room.match!.state = resignCheckers(room.match!.state, me.slot);
          else room.match!.state = { ...room.match!.state, over: true, winner: me.slot === 0 ? 1 : 0, reason: 'resignation' };
          room.match!.seq += 1;
          broadcastState(room);
          completeMatch(room);
          return;
        }
        case 'offerDraw': {
          const ctx = memberOf(ws);
          if (!ctx?.room.match || ctx.room.match.finishedAt) return;
          const { room, me } = ctx;
          room.match!.state = { ...room.match!.state, drawOfferBy: me.slot };
          room.match!.seq += 1;
          broadcastState(room);
          return;
        }
        case 'respondDraw': {
          const ctx = memberOf(ws);
          if (!ctx?.room.match || ctx.room.match.finishedAt) return;
          const { room, me } = ctx;
          const st = room.match!.state;
          if (st.drawOfferBy === null || st.drawOfferBy === undefined || st.drawOfferBy === me.slot) return;
          room.match!.state = msg.accept
            ? (room.match!.gameId === 'chess' ? agreeDraw(st) : { ...st, over: true, winner: null, reason: 'draw agreed' })
            : { ...st, drawOfferBy: null };
          room.match!.seq += 1;
          broadcastState(room);
          if (msg.accept) completeMatch(room);
          return;
        }

        /* ---------------------------------------------------------- rematch */
        case 'rematch': {
          const ctx = memberOf(ws);
          if (!ctx) return;
          const { room, me } = ctx;
          me.rematchVote = !!msg.vote;
          touch(room);
          const all = [...room.members.values()];
          if (all.length === 2 && all.every((m) => m.rematchVote && m.connected)) {
            for (const m of all) { m.rematchVote = false; m.ready = true; }
            // swap slots so colours/first move alternate
            for (const m of all) m.slot = (m.slot === 0 ? 1 : 0) as Slot;
            room.status = 'STARTING';
            room.startsAt = Date.now() + 1800;
            broadcastRoom(room);
          } else {
            broadcastRoom(room);
          }
          return;
        }

        /* ---------------------------------------------------------- changeGame */
        case 'changeGame': {
          const ctx = memberOf(ws);
          if (!ctx) return fail(ws, 'not_in_room', 'You are not in an arena.');
          const { room } = ctx;
          if (room.status === 'STARTING') return fail(ws, 'in_progress', 'Match is starting.');
          const newGameId = msg.gameId;
          const rules = RULES[newGameId];
          if (!rules) return fail(ws, 'unknown_game', 'Unknown game.');

          room.gameId = newGameId;
          room.settings = sanitiseSettings(msg.settings ?? {});
          room.match = null;
          room.status = room.members.size === 2 ? 'READY_CHECK' : 'WAITING';
          room.startsAt = null;
          for (const m of room.members.values()) {
            m.ready = false;
            m.rematchVote = false;
          }
          touch(room);
          broadcastRoom(room);
          return;
        }

        /* ---------------------------------------------------------- returnToLobby */
        case 'returnToLobby': {
          const ctx = memberOf(ws);
          if (!ctx) return fail(ws, 'not_in_room', 'You are not in an arena.');
          const { room } = ctx;
          if (room.status === 'STARTING') return;
          room.match = null;
          room.status = room.members.size === 2 ? 'READY_CHECK' : 'WAITING';
          room.startsAt = null;
          for (const m of room.members.values()) {
            m.ready = false;
            m.rematchVote = false;
          }
          touch(room);
          broadcastRoom(room);
          return;
        }

        /* ---------------------------------------------------------- chat */
        case 'chat': {
          const ctx = memberOf(ws);
          if (!ctx) return;
          /* Two strangers with no host get no chat until a board exists. The
             first message to a person you have never met is too often the
             reason this game has a report button at all. Private rooms, whose
             code was the introduction, keep their lobby chat. */
          if (!chatAllowed({
            matchmade: ctx.room.matchmade,
            historyLength: ctx.room.history.length,
            status: ctx.room.status,
          })) {
            return fail(ws, 'chat_locked', 'Chat opens when the first match starts.',
              'You were matched with a stranger — play a round first.');
          }
          if (!allow(`chat:${ctx.me.id}`, 60)) return fail(ws, 'rate_limited', 'Chatting too fast.', 'Wait a few seconds.');
          const raw = String(msg.text ?? '').trim();
          if (!raw) return;
          const text = raw.slice(0, 240);
          const out = {
            t: 'chat' as const,
            id: randomUUID(),
            senderId: ctx.me.id,
            from: ctx.me.name,
            slot: ctx.me.slot,
            text,
            ts: Date.now(),
          };
          for (const m of ctx.room.members.values()) {
            for (const sock of m.sockets) {
              send(sock, out);
            }
          }
          return;
        }

        /* ---------------------------------------------------------- typing
           Presence, not content: relayed to the other side only, coalesced by
           the client to at most one event every ~1.5s, and cheap enough that a
           whole match never fills the rate-limit bucket. */
        case 'typing': {
          const ctx = memberOf(ws);
          if (!ctx) return;
          if (!allow(`typing:${ctx.me.id}`, 200)) return;
          const out = { t: 'typing' as const, from: ctx.me.name, slot: ctx.me.slot, on: !!msg.on };
          for (const m of ctx.room.members.values()) {
            if (m.id === ctx.me.id) continue;
            for (const sock of m.sockets) send(sock, out);
          }
          return;
        }

        /* ---------------------------------------------------------- misc */
        case 'nudge': {
          const ctx = memberOf(ws);
          if (!ctx) return;
          if (!allow(`nudge:${ctx.me.id}`, 30)) return;
          const text = String(msg.text ?? '').slice(0, 120);
          for (const m of ctx.room.members.values())
            for (const sock of m.sockets)
              if (sock !== ws) send(sock, { t: 'nudge', from: ctx.me.name, text });
          return;
        }
        case 'leave': {
          const ctx = memberOf(ws);
          if (!ctx) { send(ws, { t: 'left' }); return; }
          const { room, me } = ctx;
          room.members.delete(me.id);
          meta.code = null;
          send(ws, { t: 'left' });
          if (room.members.size === 0) { rooms.delete(room.code); return; }
          if (room.hostId === me.id) room.hostId = [...room.members.values()][0].id;
          // a live match cannot continue one-sided: award it to whoever stayed, then reopen the room
          if (room.match && !room.match.finishedAt) {
            const stayer = [...room.members.values()][0];
            room.match.state = {
              ...room.match.state, over: true,
              winner: stayer ? stayer.slot : null,
              reason: 'opponent left the room',
            };
            room.match.seq += 1;
            broadcastState(room);
            completeMatch(room);
          }
          for (const m of room.members.values()) m.ready = false;
          room.status = 'WAITING';
          broadcastRoom(room);
          broadcastPresence();
          return;
        }

        /* ---------------------------------------------------------- invite
           "Play with me" between two people who are already friends. The friend
           list lives in Postgres and is read by the browser; the relay's job is
           only to carry the invitation to a live socket, and to refuse to open a
           room unless the person invited answers it. */
        case 'invite': {
          if (!meta.playerId) return fail(ws, 'no_identity', 'Say hello first.');
          if (!meta.accountId) {
            return fail(ws, 'not_signed_in', 'Sign in to invite a friend.',
              'Friends are tied to an account, so that they survive a cleared browser.');
          }
          if (memberOf(ws)) return fail(ws, 'in_room', 'You are already in an arena.',
            'Leave it before inviting somebody.');
          const to = String(msg.to ?? '').trim().toLowerCase();
          if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(to) || to === meta.accountId) {
            return fail(ws, 'bad_target', 'That is not somebody you can invite.');
          }
          const rules = RULES[msg.gameId];
          if (!rules) return fail(ws, 'unknown_game', 'That game has no online referee yet.',
            'Pick another game from the library.');
          if (!allow(`invite:${meta.accountId}`, 6)) {
            return fail(ws, 'rate_limited', 'Too many invitations at once.',
              'Give your friends a moment to answer.');
          }
          if (blockedBetween(accounts, blocksByAccount, meta.playerId, `u:${to}`)) {
            return fail(ws, 'blocked', 'You cannot invite that player.');
          }
          const target = socketsForAccount(to);
          if (!target.length) {
            return fail(ws, 'not_online', 'They are not online right now.',
              'Open a private room and send them the code instead.');
          }
          const invite: Invite = {
            id: randomUUID(),
            fromPlayer: meta.playerId,
            fromAccount: meta.accountId,
            toAccount: to,
            gameId: msg.gameId,
            settings: sanitiseSettings(msg.settings),
            at: Date.now(),
          };
          invites.set(invite.id, invite);
          for (const sock of target) {
            send(sock, {
              t: 'invite', inviteId: invite.id, fromAccountId: meta.accountId,
              fromName: meta.name, gameId: invite.gameId, settings: invite.settings, at: invite.at,
            });
          }
          return;
        }

        case 'inviteReply': {
          if (!meta.accountId) return fail(ws, 'not_signed_in', 'Sign in first.');
          const taken = takeInvite(invites, String(msg.inviteId ?? ''), meta.accountId, Date.now());
          if ('error' in taken) {
            const gone = taken.error === 'not_yours' ? 'unknown' : taken.error;
            return fail(ws, 'invite_gone', gone === 'expired'
              ? 'That invitation has expired.'
              : 'That invitation is no longer available.');
          }
          const invite = taken.invite;

          if (!msg.accept) {
            for (const sock of socketsForAccount(invite.fromAccount)) {
              send(sock, { t: 'inviteClosed', inviteId: invite.id, reason: 'declined' });
            }
            return;
          }

          if (memberOf(ws)) {
            for (const sock of socketsForAccount(invite.fromAccount)) {
              send(sock, { t: 'inviteClosed', inviteId: invite.id, reason: 'gone' });
            }
            return fail(ws, 'in_room', 'You are already in an arena.', 'Leave it first, then answer.');
          }
          if (blockedBetween(accounts, blocksByAccount, invite.fromPlayer, meta.playerId)) {
            return fail(ws, 'blocked', 'You cannot play with that player.', 'You have blocked them.');
          }

          const hostSockets = socketsForAccount(invite.fromAccount);
          const hostMeta = hostSockets.map((sock) => socketMeta.get(sock)).find((m) => m?.playerId);
          if (!hostSockets.length || !hostMeta) {
            return fail(ws, 'invite_gone', 'They have gone offline.',
              'Ask them to invite you again when they are back.');
          }
          /* The host may have opened something else while the invitation sat
             there. In that case the invitation is stale, not a second room. */
          const hostCtx = hostSockets.map((sock) => memberOf(sock)).find(Boolean);
          if (hostCtx) {
            return fail(ws, 'invite_gone', 'They are already in another arena.',
              'Ask them to invite you again when they are free.');
          }

          const room = openRoom(
            {
              playerId: hostMeta.playerId, name: hostMeta.name, mascot: hostMeta.mascot,
              accountId: hostMeta.accountId, handle: hostMeta.handle,
            },
            hostSockets[0],
            {
              gameId: invite.gameId,
              settings: invite.settings,
              roomName: `${hostMeta.name}’s arena`,
              mode: 'online',
            },
          );
          const host = room.members.get(hostMeta.playerId)!;
          for (const sock of hostSockets.slice(1)) {
            host.sockets.add(sock);
            socketMeta.get(sock)!.code = room.code;
          }
          seat(room, {
            playerId: meta.playerId, name: meta.name, mascot: meta.mascot,
            accountId: meta.accountId, handle: meta.handle,
          }, ws);
          room.status = 'READY_CHECK';
          dequeue(queue, meta.playerId);
          dequeue(queue, hostMeta.playerId);
          touch(room);
          broadcastRoom(room);
          broadcastPresence();
          for (const sock of hostSockets) {
            send(sock, { t: 'inviteClosed', inviteId: invite.id, reason: 'accepted' });
          }
          console.log(`[relay] ${invite.fromAccount.slice(0, 8)} invited ${meta.accountId.slice(0, 8)} → ${room.code}`);
          return;
        }

        case 'ping': {
          const ctx = memberOf(ws);
          if (ctx) ctx.me.lastSeen = Date.now();
          send(ws, { t: 'pong', ts: msg.ts, serverTime: Date.now() });
          return;
        }
      }
    } catch (err) {
      console.error('[relay] handler error', err);
      fail(ws, 'server_error', 'Something went wrong refereeing that action.', 'Your board has been resynchronised.');
      const room = roomOf(ws);
      if (room?.match) broadcastState(room);
    }
}

/* ------------------------------------------------------------------ settings hygiene */
function sanitiseSettings(input: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!input || typeof input !== 'object') return out;
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (k.length > 32) continue;
    if (typeof v === 'string') out[k] = v.slice(0, 32);
    else if (typeof v === 'number' && Number.isFinite(v)) out[k] = Math.max(-1000, Math.min(1000, v));
    else if (typeof v === 'boolean') out[k] = v;
  }
  return out;
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[relay] PIKACHU authoritative relay listening on :${PORT}`);
  console.log(`[relay] refereeing: ${Object.keys(RULES).join(', ')}`);
});
