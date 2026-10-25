export type RoomStatus =
  | 'WAITING' | 'READY_CHECK' | 'STARTING' | 'IN_GAME' | 'COMPLETED'
  | 'CANCELLED' | 'EXPIRED';

export interface MemberView {
  id: string;
  name: string;
  mascot: string;
  slot: 0 | 1;
  ready: boolean;
  connected: boolean;
  isHost: boolean;
  lastSeen: number;
  rematchVote: boolean;
}

export interface RoomView {
  code: string;
  roomName: string;
  gameId: string;
  mode: 'online' | 'coop';
  settings: Record<string, unknown>;
  status: RoomStatus;
  members: MemberView[];
  hostId: string;
  createdAt: number;
  expiresAt: number;
  startsAt: number | null;
  matchId: string | null;
  series: { games: number; wins: [number, number]; draws: number };
  history: { matchId: string; winnerSlot: 0 | 1 | null; reason: string; finishedAt: number }[];
}

/**
 * How many people are in each game right now. `playing` counts distinct players
 * sitting in a live room; `waiting` is the matchmaking queue. Pushed to every
 * connected client (throttled) so a lobby can say "4 playing, 2 looking" without
 * anybody polling.
 */
export interface PresenceView {
  games: Record<string, { playing: number; waiting: number }>;
  players: number;
  at: number;
}

/** What the server tells one player about their own place in the queue. */
export interface QueueView {
  status: 'waiting' | 'matched' | 'cancelled' | 'timeout' | 'expired';
  gameId: string | null;
  waiting: number;
  since: number | null;
}

export type ClientMsg =
  | { t: 'hello'; playerId: string; name: string; mascot: string; resumeCode?: string }
  | { t: 'create'; gameId: string; settings: Record<string, unknown>; roomName: string; mode?: 'online' | 'coop' }
  | { t: 'join'; code: string }
  | { t: 'ready'; ready: boolean }
  | { t: 'start' }
  | { t: 'action'; matchId: string; clientSeq: number; move: unknown }
  | { t: 'resign' }
  | { t: 'offerDraw' }
  | { t: 'respondDraw'; accept: boolean }
  | { t: 'rematch'; vote: boolean }
  | { t: 'changeGame'; gameId: string; settings?: Record<string, unknown> }
  | { t: 'returnToLobby' }
  | { t: 'leave' }
  | { t: 'chat'; text: string }
  | { t: 'typing'; on: boolean }
  | { t: 'nudge'; text: string }
  | { t: 'ping'; ts: number }
  /* "put me in the queue for this game" — the server picks the opponent and
     creates the room itself, so a matched player never has to type a code. */
  | { t: 'queue'; gameId: string; settings: Record<string, unknown>; roomName?: string }
  | { t: 'unqueue' };

export type ServerMsg =
  | { t: 'welcome'; playerId: string; serverTime: number }
  | { t: 'room'; room: RoomView; you: { slot: 0 | 1; id: string } }
  | { t: 'state'; matchId: string; seq: number; state: unknown; yourSlot: 0 | 1; lastAction: string | null; serverTime: number }
  | { t: 'finished'; matchId: string; winnerSlot: 0 | 1 | null; reason: string; state: unknown }
  | { t: 'chat'; id: string; senderId: string; from: string; slot: 0 | 1; text: string; ts: number }
  | { t: 'typing'; from: string; slot: 0 | 1; on: boolean }
  | { t: 'error'; code: string; message: string; recovery?: string }
  | { t: 'nudge'; from: string; text: string }
  | { t: 'left' }
  | { t: 'pong'; ts: number; serverTime: number }
  | { t: 'presence'; presence: PresenceView }
  | { t: 'queue'; queue: QueueView };

export const ROOM_TTL_MS = 1000 * 60 * 90;          // rooms expire after 90 min idle
export const RECONNECT_GRACE_MS = 1000 * 45;        // disconnected player keeps their slot
export const START_COUNTDOWN_MS = 3200;
/* How long a matched pair gets before the first move — the same countdown a
   private room shows, because a matchmade game is a normal game. */
export const MATCH_START_DELAY_MS = 2600;
