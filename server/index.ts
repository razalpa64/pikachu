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

import type { Slot, TurnGameRules } from '../src/games/types';
import { tictactoeRules } from '../src/games/tictactoe/rules';
import { connect4Rules } from '../src/games/connect4/rules';
import { memoryRules } from '../src/games/memory/rules';
import { chessRules, resign as chessResign, agreeDraw, startClock } from '../src/games/chess/rules';
import { checkersRules, resignCheckers } from '../src/games/checkers/rules';
import { battleshipRules } from '../src/games/battleship/rules';
import { reactionRules } from '../src/games/reaction/rules';
import { eightsRules } from '../src/games/cards/rules';
import { quizOnlineRules } from '../src/games/trivia/online';
import { sketchRules } from '../src/games/sketch/rules';
import {
  ROOM_TTL_MS, RECONNECT_GRACE_MS, START_COUNTDOWN_MS,
  type ClientMsg, type ServerMsg, type RoomStatus, type RoomView, type MemberView,
} from './protocol';

const PORT = Number(process.env.PORT ?? process.env.RELAY_PORT ?? 8787);
const DATA_DIR = path.resolve(process.cwd(), '.pikachu-data');
const HISTORY_FILE = path.join(DATA_DIR, 'matches.json');

/* ------------------------------------------------------------------ registry */
const RULES: Record<string, TurnGameRules<any, any>> = {
  tictactoe: tictactoeRules,
  connect4: connect4Rules,
  memory: memoryRules,
  chess: chessRules,
  checkers: checkersRules,
  battleship: battleshipRules,
  reaction: reactionRules,
  cards: eightsRules,
  trivia: quizOnlineRules,
  sketch: sketchRules,
};
/** games whose state advances on a server timer */
const TICKING = new Set(['reaction', 'chess', 'trivia', 'sketch']);

/* ------------------------------------------------------------------ model */
interface Member {
  id: string; name: string; mascot: string; slot: Slot;
  ready: boolean; connected: boolean; lastSeen: number; rematchVote: boolean;
  sockets: Set<WebSocket>;
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
}

const rooms = new Map<string, Room>();
const socketMeta = new WeakMap<WebSocket, { playerId: string; name: string; mascot: string; code: string | null }>();

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
      connected: m.connected, isHost: m.id === room.hostId, lastSeen: m.lastSeen, rematchVote: m.rematchVote,
    }));
  return {
    code: room.code, roomName: room.roomName, gameId: room.gameId, mode: room.mode,
    settings: room.settings, status: room.status, members, hostId: room.hostId,
    createdAt: room.createdAt, expiresAt: room.expiresAt, startsAt: room.startsAt,
    matchId: room.match?.id ?? null, series: room.series, history: room.history.slice(-12),
  };
}

function broadcastRoom(room: Room) {
  const view = roomView(room);
  for (const m of room.members.values())
    for (const ws of m.sockets) send(ws, { t: 'room', room: view, you: { slot: m.slot, id: m.id } });
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
setInterval(() => {
  const now = Date.now();
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
    res.end(JSON.stringify({ ok: true, rooms: rooms.size, uptime: process.uptime(), games: Object.keys(RULES) }));
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

function detach(ws: WebSocket) {
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
  socketMeta.set(ws, { playerId: '', name: '', mascot: 'classic', code: null });
  const ip = (req.socket.remoteAddress ?? 'anon');

  ws.on('message', (raw) => {
    let msg: ClientMsg;
    try { msg = JSON.parse(String(raw)); } catch { return fail(ws, 'bad_json', 'Message could not be read.'); }
    const meta = socketMeta.get(ws)!;

    try {
      switch (msg.t) {
        /* ---------------------------------------------------------- hello */
        case 'hello': {
          if (!msg.playerId || typeof msg.playerId !== 'string' || msg.playerId.length > 64)
            return fail(ws, 'bad_identity', 'Invalid player identity.');
          meta.playerId = msg.playerId;
          meta.name = String(msg.name ?? 'Trainer').slice(0, 24) || 'Trainer';
          meta.mascot = String(msg.mascot ?? 'classic').slice(0, 24);
          send(ws, { t: 'welcome', playerId: meta.playerId, serverTime: Date.now() });

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
          const code = newCode();
          const room: Room = {
            code, roomName: String(msg.roomName ?? '').slice(0, 40) || 'Private Arena',
            gameId: msg.gameId, mode: msg.mode === 'coop' ? 'coop' : 'online',
            settings: sanitiseSettings(msg.settings), status: 'WAITING',
            hostId: meta.playerId, members: new Map(),
            createdAt: Date.now(), expiresAt: Date.now() + ROOM_TTL_MS, startsAt: null,
            match: null, series: { games: 0, wins: [0, 0], draws: 0 }, history: [], seedCounter: 0,
          };
          room.members.set(meta.playerId, {
            id: meta.playerId, name: meta.name, mascot: meta.mascot, slot: 0,
            ready: false, connected: true, lastSeen: Date.now(), rematchVote: false, sockets: new Set([ws]),
          });
          rooms.set(code, room);
          meta.code = code;
          broadcastRoom(room);
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
          });
          meta.code = code;
          if (room.status === 'WAITING' && room.members.size === 2) room.status = 'READY_CHECK';
          broadcastRoom(room);
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
  });

  ws.on('close', () => detach(ws));
  ws.on('error', () => detach(ws));
});

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
