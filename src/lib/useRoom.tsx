import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode,
} from 'react';
import { Relay, type ConnState } from './net/relay';
import type { RoomView } from '../../server/protocol';
import { useStore } from './store';
import { logRoomMessage } from './supabase';

export interface MatchSnapshot {
  matchId: string; seq: number; state: any; yourSlot: 0 | 1;
  lastAction: string | null; serverTime: number;
}
export interface RoomError { code: string; message: string; recovery?: string; at: number }

export interface ChatMessage {
  id: string;
  senderId: string;
  from: string;
  slot: 0 | 1;
  text: string;
  ts: number;
  isSelf: boolean;
}

interface RoomCtx {
  conn: ConnState;
  rtt: number | null;
  room: RoomView | null;
  you: { slot: 0 | 1; id: string } | null;
  match: MatchSnapshot | null;
  finished: { matchId: string; winnerSlot: 0 | 1 | null; reason: string } | null;
  error: RoomError | null;
  messages: ChatMessage[];
  /** true while the other player is composing — expires on its own if the
      "stopped typing" event never arrives (closed tab, dropped socket) */
  peerTyping: boolean;
  clearError: () => void;
  sendChat: (text: string) => void;
  sendTyping: (on: boolean) => void;
  clearMessages: () => void;
  create: (gameId: string, settings: Record<string, unknown>, roomName: string, mode?: 'online' | 'coop') => void;
  join: (code: string) => void;
  ready: (v: boolean) => void;
  start: () => void;
  act: (move: unknown) => void;
  resign: () => void;
  offerDraw: () => void;
  respondDraw: (accept: boolean) => void;
  rematch: (vote: boolean) => void;
  changeGame: (gameId: string, settings?: Record<string, unknown>) => void;
  returnToLobby: () => void;
  leave: () => void;
  nudge: (text: string) => void;
  connect: () => void;
}

const Ctx = createContext<RoomCtx | null>(null);
const RESUME_KEY = 'pikachu.room.code';

export function RoomProvider({ children }: { children: ReactNode }) {
  const { identity, toast, sfx } = useStore();
  const [conn, setConn] = useState<ConnState>('idle');
  const [rtt, setRtt] = useState<number | null>(null);
  const [room, setRoom] = useState<RoomView | null>(null);
  const [you, setYou] = useState<{ slot: 0 | 1; id: string } | null>(null);
  const [match, setMatch] = useState<MatchSnapshot | null>(null);
  const [finished, setFinished] = useState<RoomCtx['finished']>(null);
  const [error, setError] = useState<RoomError | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [peerTyping, setPeerTyping] = useState(false);
  const typingTimer = useRef<number | null>(null);
  const typingLastSent = useRef(0);
  const relayRef = useRef<Relay | null>(null);
  const seqRef = useRef(0);

  const ident = useMemo(
    () => ({ playerId: identity.playerId, name: identity.name || 'Trainer', mascot: identity.mascot }),
    [identity.playerId, identity.name, identity.mascot],
  );

  useEffect(() => {
    const relay = new Relay(ident, {
      conn: (s, r) => { setConn(s); setRtt(r); },
      room: (r, y) => {
        setRoom(r); setYou(y);
        try { localStorage.setItem(RESUME_KEY, r.code); } catch { /* ignore */ }
        // If the room has no active match or returned to lobby/ready check, clear stale game match state
        if (!r.matchId || r.status === 'WAITING' || r.status === 'READY_CHECK') {
          setMatch(null);
          setFinished(null);
        } else if (r.status !== 'IN_GAME' && r.status !== 'STARTING') {
          setFinished((f) => (r.status === 'COMPLETED' ? f : null));
        }
      },
      state: (p) => { setMatch(p); if (p.seq === 0) setFinished(null); },
      finished: (p) => { setFinished(p); setMatch((m) => (m ? { ...m, state: p.state } : m)); },
      chat: (p) => {
        setMessages((prev) => [...prev.slice(-99), { ...p, isSelf: p.senderId === ident.playerId }]);
        if (p.senderId !== ident.playerId) {
          setPeerTyping(false);
          sfx('spark');
        }
      },
      // the relay only forwards typing to the *other* player, so anything that
      // arrives here is genuinely theirs
      typing: (p) => setPeerTyping(p.on),
      error: (p) => {
        setError({ ...p, at: Date.now() });
        sfx('error');
        toast({ kind: 'error', title: p.message, body: p.recovery });
      },
      nudge: (p) => { sfx('spark'); toast({ kind: 'info', title: `${p.from} says`, body: p.text }); },
      left: () => {
        setRoom(null); setYou(null); setMatch(null); setFinished(null); setMessages([]); setPeerTyping(false);
        try { localStorage.removeItem(RESUME_KEY); } catch { /* ignore */ }
      },
    });
    try { relay.resumeCode = localStorage.getItem(RESUME_KEY); } catch { /* ignore */ }
    relayRef.current = relay;
    return () => { relay.close(); relayRef.current = null; };
    // identity is applied via updateIdentity below; we intentionally build the relay once
  }, []);

  useEffect(() => { relayRef.current?.updateIdentity(ident); }, [ident]);

  const connect = useCallback(() => relayRef.current?.connect(), []);
  const api = useMemo<RoomCtx>(() => ({
    conn, rtt, room, you, match, finished, error, messages, peerTyping,
    clearError: () => setError(null),
    clearMessages: () => setMessages([]),
    sendChat: (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      relayRef.current?.send({ t: 'chat', text: trimmed });
      // we just sent: stop claiming to be typing, and drop the throttle so the
      // next keystroke is announced immediately
      typingLastSent.current = 0;
      if (typingTimer.current) { clearTimeout(typingTimer.current); typingTimer.current = null; }
      relayRef.current?.send({ t: 'typing', on: false });
      if (room && you) {
        void logRoomMessage(room.code, you.id, ident.name, trimmed);
      }
    },
    sendTyping: (on: boolean) => {
      const now = Date.now();
      if (typingTimer.current) { clearTimeout(typingTimer.current); typingTimer.current = null; }
      if (on) {
        if (now - typingLastSent.current > 1500) {
          typingLastSent.current = now;
          relayRef.current?.send({ t: 'typing', on: true });
        }
        // self-heal: if no further keystroke arrives, tell the other side we stopped
        typingTimer.current = window.setTimeout(() => {
          typingLastSent.current = 0;
          relayRef.current?.send({ t: 'typing', on: false });
        }, 2600);
      } else {
        typingLastSent.current = 0;
        relayRef.current?.send({ t: 'typing', on: false });
      }
    },
    connect,
    create: (gameId, settings, roomName, mode = 'online') => {
      relayRef.current?.connect();
      relayRef.current?.send({ t: 'create', gameId, settings, roomName, mode });
    },
    join: (code) => {
      relayRef.current?.connect();
      relayRef.current?.send({ t: 'join', code: code.toUpperCase() });
    },
    ready: (v) => relayRef.current?.send({ t: 'ready', ready: v }),
    start: () => relayRef.current?.send({ t: 'start' }),
    act: (move) => {
      const m = match;
      if (!m) return;
      seqRef.current += 1;
      relayRef.current?.send({ t: 'action', matchId: m.matchId, clientSeq: seqRef.current, move });
    },
    resign: () => relayRef.current?.send({ t: 'resign' }),
    offerDraw: () => relayRef.current?.send({ t: 'offerDraw' }),
    respondDraw: (accept) => relayRef.current?.send({ t: 'respondDraw', accept }),
    rematch: (vote) => relayRef.current?.send({ t: 'rematch', vote }),
    changeGame: (gameId, settings) => {
      setMatch(null);
      setFinished(null);
      relayRef.current?.send({ t: 'changeGame', gameId, settings });
    },
    returnToLobby: () => {
      setMatch(null);
      setFinished(null);
      relayRef.current?.send({ t: 'returnToLobby' });
    },
    leave: () => {
      relayRef.current?.send({ t: 'leave' });
      setMatch(null);
      setFinished(null);
      setMessages([]);
      try { localStorage.removeItem(RESUME_KEY); } catch { /* ignore */ }
    },
    nudge: (text) => relayRef.current?.send({ t: 'nudge', text }),
  }), [conn, rtt, room, you, match, finished, error, messages, peerTyping, connect, ident.name]);

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useRoom() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useRoom must be used inside <RoomProvider>');
  return ctx;
}
