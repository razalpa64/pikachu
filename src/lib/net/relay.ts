/**
 * Thin, resilient client for the authoritative relay.
 * Auto-reconnects with backoff, replays `hello` + room resume, measures RTT,
 * and never applies a state update with a sequence number older than the one it holds.
 */
import type {
  ClientMsg, InviteView, PresenceView, QueueView, RoomView, ServerMsg,
} from '../../../server/protocol';

export type ConnState = 'idle' | 'connecting' | 'online' | 'reconnecting' | 'offline';

export interface RelayEvents {
  conn?: (s: ConnState, rttMs: number | null) => void;
  room?: (room: RoomView, you: { slot: 0 | 1; id: string }) => void;
  state?: (p: { matchId: string; seq: number; state: unknown; yourSlot: 0 | 1; lastAction: string | null; serverTime: number }) => void;
  finished?: (p: { matchId: string; winnerSlot: 0 | 1 | null; reason: string; state: unknown }) => void;
  chat?: (p: { id: string; senderId: string; from: string; slot: 0 | 1; text: string; ts: number }) => void;
  typing?: (p: { from: string; slot: 0 | 1; on: boolean }) => void;
  error?: (p: { code: string; message: string; recovery?: string }) => void;
  nudge?: (p: { from: string; text: string }) => void;
  left?: () => void;
  presence?: (p: PresenceView) => void;
  queue?: (q: QueueView) => void;
  /** The relay's answer to `hello`: was the account verified, and under what id. */
  welcome?: (p: { playerId: string; verified: boolean; handle: string | null }) => void;
  /** A friend asking you to play, right now. */
  invite?: (p: InviteView) => void;
  /** An invitation you sent was declined, expired, or accepted. */
  inviteClosed?: (p: { inviteId: string; reason: 'declined' | 'expired' | 'gone' | 'accepted' }) => void;
}

export class Relay {
  private ws: WebSocket | null = null;
  private attempts = 0;
  private timer: number | null = null;
  private pingTimer: number | null = null;
  private closedByUs = false;
  private lastSeq = -1;
  private lastMatchId: string | null = null;
  /* Messages asked for while the socket is still opening. A button pressed one
     millisecond after the page loads should not be swallowed; the outbox is
     dropped on close, so a reconnect never replays a stale "find me a game". */
  private outbox: ClientMsg[] = [];
  /* Has *this* socket been welcomed? Nothing that needs an identity may be sent
     before the relay has answered our hello — see `send`. */
  private welcomed = false;
  /** how many times we have re-asked after a transient auth failure */
  private helloRetries = 0;
  private helloTimer: number | null = null;

  conn: ConnState = 'idle';
  rtt: number | null = null;
  resumeCode: string | null = null;

  private identity: { playerId: string; name: string; mascot: string };
  private events: RelayEvents;
  /** The access token the relay verifies, if this player is signed in. */
  private token: string | null = null;
  /** Account ids this player will not be matched with. */
  private blocks: string[] = [];

  constructor(identity: { playerId: string; name: string; mascot: string }, events: RelayEvents = {}) {
    this.identity = identity;
    this.events = events;
  }

  private url() {
    const envUrl = (import.meta.env.VITE_RELAY_URL as string | undefined)?.trim();
    if (envUrl) {
      let u = envUrl;
      if (u.startsWith('http://')) u = u.replace(/^http:\/\//, 'ws://');
      else if (u.startsWith('https://')) u = u.replace(/^https:\/\//, 'wss://');
      else if (!u.startsWith('ws://') && !u.startsWith('wss://')) {
        const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
        u = `${proto}//${u}`;
      }
      try {
        const parsed = new URL(u);
        if (!parsed.pathname || parsed.pathname === '/') {
          parsed.pathname = '/rt';
        }
        return parsed.toString();
      } catch {
        return u.endsWith('/rt') ? u : `${u.replace(/\/+$/, '')}/rt`;
      }
    }
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${location.host}/rt`;
  }

  private setConn(s: ConnState) {
    if (this.conn === s) return;
    this.conn = s;
    this.events.conn?.(s, this.rtt);
  }

  connect() {
    this.closedByUs = false;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;
    this.setConn(this.attempts === 0 ? 'connecting' : 'reconnecting');
    let ws: WebSocket;
    try { ws = new WebSocket(this.url()); } catch { this.scheduleRetry(); return; }
    this.ws = ws;

    ws.onopen = () => {
      this.attempts = 0;
      this.welcomed = false;
      this.setConn('online');
      this.pushHello();
      this.pingTimer = window.setInterval(() => this.send({ t: 'ping', ts: Date.now() }), 8000);
    };
    ws.onmessage = (ev) => {
      let msg: ServerMsg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      switch (msg.t) {
        case 'welcome': {
          this.welcomed = true;
          this.helloRetries = 0;
          if (this.helloTimer) { clearTimeout(this.helloTimer); this.helloTimer = null; }
          this.events.welcome?.({
            playerId: msg.playerId, verified: msg.verified, handle: msg.handle ?? null,
          });
          this.flush();
          break;
        }
        case 'invite': this.events.invite?.(msg); break;
        case 'inviteClosed': this.events.inviteClosed?.(msg); break;
        case 'pong':
          this.rtt = Date.now() - msg.ts;
          this.events.conn?.(this.conn, this.rtt);
          break;
        case 'room':
          this.resumeCode = msg.room.code;
          if (msg.room.matchId !== this.lastMatchId) { this.lastMatchId = msg.room.matchId; this.lastSeq = -1; }
          this.events.room?.(msg.room, msg.you);
          break;
        case 'state':
          // stale-state guard: never let an out-of-order packet overwrite newer truth
          if (msg.matchId === this.lastMatchId && msg.seq < this.lastSeq) break;
          this.lastMatchId = msg.matchId;
          this.lastSeq = msg.seq;
          this.events.state?.(msg);
          break;
        case 'finished': this.events.finished?.(msg); break;
        case 'chat': this.events.chat?.(msg); break;
        case 'typing': this.events.typing?.(msg); break;
        case 'error':
          this.recover(msg);
          this.events.error?.(msg);
          break;
        case 'nudge': this.events.nudge?.(msg); break;
        case 'presence': this.events.presence?.(msg.presence); break;
        case 'queue': this.events.queue?.(msg.queue); break;
        case 'left': this.resumeCode = null; this.lastMatchId = null; this.lastSeq = -1; this.events.left?.(); break;
      }
    };
    ws.onclose = () => {
      if (this.pingTimer) { clearInterval(this.pingTimer); this.pingTimer = null; }
      if (this.helloTimer) { clearTimeout(this.helloTimer); this.helloTimer = null; }
      // the held messages belong to the socket that died: a reconnect must not
      // replay a stale "find me a game" minutes later
      this.outbox = [];
      this.welcomed = false;
      this.ws = null;
      if (this.closedByUs) { this.setConn('idle'); return; }
      this.scheduleRetry();
    };
    ws.onerror = () => { /* onclose handles recovery */ };
  }

  private scheduleRetry() {
    this.setConn(this.attempts > 6 ? 'offline' : 'reconnecting');
    const delay = Math.min(12000, 500 * Math.pow(1.7, this.attempts++));
    if (this.timer) clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.connect(), delay);
  }

  send(msg: ClientMsg) {
    if (msg.t === 'ping') {
      if (this.ws?.readyState === WebSocket.OPEN && this.welcomed) this.ws.send(JSON.stringify(msg));
      return;
    }
    if (this.ws?.readyState === WebSocket.OPEN && this.welcomed) {
      this.ws.send(JSON.stringify(msg));
      return;
    }
    /* Held (a few at most) until the relay has accepted our hello, then sent
       once, in order. Waiting for `open` was not enough: `open` only means the
       TCP handshake finished. A `create` or `join` sent in that window — or after
       a hello the relay refused — is answered "Say hello first." and the button
       looks broken. */
    if (this.outbox.length < 8) this.outbox.push(msg);
  }

  /** Release everything that was waiting for an identity. */
  private flush() {
    if (this.ws?.readyState !== WebSocket.OPEN || !this.welcomed) return;
    for (const msg of this.outbox.splice(0, this.outbox.length)) {
      if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
    }
  }

  /**
   * The relay says our socket has a problem; fix what can be fixed without the
   * player having to reload the page.
   *
   *  • `auth_invalid` — the token we presented is dead. Drop it and say hello
   *    again as a guest: the relay now always answers a hello with an identity,
   *    so this is belt-and-braces against a server that refused outright.
   *  • `auth_unavailable` — the auth server is having a bad minute. Keep the
   *    token (it is probably fine) and ask again shortly; three attempts, then
   *    stop, so a longer outage is reported instead of a reconnect loop.
   *  • `no_identity` — the relay lost our hello (a restart, a race in an older
   *    build). Say it again so the next tap works.
   */
  private recover(msg: { code: string }) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    if (msg.code === 'auth_invalid') {
      if (this.token === null && this.welcomed) return;
      this.token = null;
      this.welcomed = false;
      this.rehello();
      return;
    }
    if (msg.code === 'auth_unavailable') {
      if (this.helloRetries >= 3 || this.helloTimer) return;
      this.helloRetries += 1;
      this.helloTimer = window.setTimeout(() => {
        this.helloTimer = null;
        this.welcomed = false;
        this.rehello();
      }, 2500 * this.helloRetries);
      return;
    }
    /* The relay says it has no identity for this socket. Re-announce: a hello is
       idempotent, and whatever caused the mismatch (a restart, a race, an older
       server) is cheaper to fix than to explain. */
    if (msg.code === 'no_identity') { this.welcomed = false; this.rehello(); }
  }

  /** "Find me an opponent." The server pairs us and opens the room itself. */
  queueJoin(gameId: string, settings: Record<string, unknown>, roomName?: string) {
    this.connect();
    this.send({ t: 'queue', gameId, settings, roomName });
  }

  /** Stop waiting. Harmless if we were never in the queue. */
  queueLeave() {
    this.send({ t: 'unqueue' });
  }

  updateIdentity(id: { playerId: string; name: string; mascot: string }) {
    this.identity = id;
    this.rehello();
  }

  /**
   * A new token (signed in, signed out, refreshed) or a new block list. Sends a
   * fresh `hello` on the open socket — the relay answers with a `welcome` that
   * may carry a different, account-derived playerId.
   */
  updateAuth(token: string | null, blocks: string[]) {
    const sameToken = this.token === token;
    const sameBlocks = this.blocks.join(',') === blocks.join(',');
    this.token = token;
    this.blocks = blocks;
    if (!sameToken || !sameBlocks) this.rehello();
  }

  private rehello() {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    /* A fresh hello is answered with a fresh welcome; until that lands the
       socket has no identity as far as `send` is concerned, so anything tapped
       meanwhile waits rather than being rejected. */
    this.welcomed = false;
    this.pushHello();
  }

  private pushHello() {
    this.ws!.send(JSON.stringify({
      t: 'hello', ...this.identity, resumeCode: this.resumeCode ?? undefined,
      ...(this.token ? { token: this.token } : {}),
      ...(this.blocks.length ? { blocks: this.blocks } : {}),
    }));
  }

  /** Ask a friend to play, over the relay — no code to copy. */
  invite(to: string, gameId: string, settings: Record<string, unknown>) {
    this.connect();
    this.send({ t: 'invite', to, gameId, settings });
  }

  inviteReply(inviteId: string, accept: boolean) {
    this.send({ t: 'inviteReply', inviteId, accept });
  }

  close() {
    this.closedByUs = true;
    if (this.timer) clearTimeout(this.timer);
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.ws?.close();
    this.ws = null;
    this.setConn('idle');
  }
}

let singleton: Relay | null = null;
export function getRelay(identity: { playerId: string; name: string; mascot: string }, events: RelayEvents): Relay {
  if (!singleton) singleton = new Relay(identity, events);
  else { singleton.updateIdentity(identity); (singleton as any).events = events; }
  return singleton;
}
export function peekRelay() { return singleton; }
