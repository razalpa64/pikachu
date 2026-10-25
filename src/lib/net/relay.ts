/**
 * Thin, resilient client for the authoritative relay.
 * Auto-reconnects with backoff, replays `hello` + room resume, measures RTT,
 * and never applies a state update with a sequence number older than the one it holds.
 */
import type { ClientMsg, ServerMsg, RoomView } from '../../../server/protocol';

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
}

export class Relay {
  private ws: WebSocket | null = null;
  private attempts = 0;
  private timer: number | null = null;
  private pingTimer: number | null = null;
  private closedByUs = false;
  private lastSeq = -1;
  private lastMatchId: string | null = null;

  conn: ConnState = 'idle';
  rtt: number | null = null;
  resumeCode: string | null = null;

  private identity: { playerId: string; name: string; mascot: string };
  private events: RelayEvents;

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
      this.setConn('online');
      this.send({ t: 'hello', ...this.identity, resumeCode: this.resumeCode ?? undefined });
      this.pingTimer = window.setInterval(() => this.send({ t: 'ping', ts: Date.now() }), 8000);
    };
    ws.onmessage = (ev) => {
      let msg: ServerMsg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      switch (msg.t) {
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
        case 'error': this.events.error?.(msg); break;
        case 'nudge': this.events.nudge?.(msg); break;
        case 'left': this.resumeCode = null; this.lastMatchId = null; this.lastSeq = -1; this.events.left?.(); break;
      }
    };
    ws.onclose = () => {
      if (this.pingTimer) { clearInterval(this.pingTimer); this.pingTimer = null; }
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
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  updateIdentity(id: { playerId: string; name: string; mascot: string }) {
    this.identity = id;
    if (this.ws?.readyState === WebSocket.OPEN) this.send({ t: 'hello', ...id, resumeCode: this.resumeCode ?? undefined });
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
