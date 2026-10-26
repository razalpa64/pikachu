import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode,
} from 'react';
import { Relay, type ConnState } from './net/relay';
import type { InviteView, PresenceView, QueueView, RoomView } from '../../server/protocol';
import { useStore } from './store';
import { logRoomMessage } from './supabase';
import { blockedIds, currentToken, onSessionChange, startSession } from './session';
import { useNavigate } from 'react-router-dom';

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

export interface QueueState {
  /** `waiting` = in the queue; `timeout` = 30s gone by, still waiting. */
  status: QueueView['status'];
  gameId: string | null;
  waiting: number;
  since: number | null;
  /** ms epoch when this client started looking — for the elapsed counter. */
  at: number;
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
  /** Live counts of who is playing and who is waiting, pushed by the relay. */
  presence: PresenceView | null;
  /** Our own place in the matchmaking queue, if we are looking for a game. */
  queue: QueueState | null;
  /** The id the relay knows us by — the account id once a token was verified. */
  playerId: string;
  /** Invitations from friends, waiting for an answer. */
  invites: InviteView[];
  inviteFriend: (playerId: string, gameId: string, settings: Record<string, unknown>) => void;
  respondInvite: (inviteId: string, accept: boolean) => void;
  dismissInvite: (inviteId: string) => void;
  findMatch: (gameId: string, settings: Record<string, unknown>, roomName?: string) => void;
  cancelMatch: () => void;
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
  const nav = useNavigate();
  const [conn, setConn] = useState<ConnState>('idle');
  const [rtt, setRtt] = useState<number | null>(null);
  const [room, setRoom] = useState<RoomView | null>(null);
  const [you, setYou] = useState<{ slot: 0 | 1; id: string } | null>(null);
  const [match, setMatch] = useState<MatchSnapshot | null>(null);
  const [finished, setFinished] = useState<RoomCtx['finished']>(null);
  const [error, setError] = useState<RoomError | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [peerTyping, setPeerTyping] = useState(false);
  const [presence, setPresence] = useState<PresenceView | null>(null);
  const [queue, setQueue] = useState<QueueState | null>(null);
  const [playerId, setPlayerId] = useState(identity.playerId);
  const [invites, setInvites] = useState<InviteView[]>([]);
  /** The relay may rename us (an account-derived id); chat comparisons use this. */
  const relayId = useRef(identity.playerId);
  const typingTimer = useRef<number | null>(null);
  const typingLastSent = useRef(0);
  const relayRef = useRef<Relay | null>(null);
  const seqRef = useRef(0);
  /** True between "find me an opponent" and being matched — so a match found
      while the player wandered off to another screen still opens the arena. */
  const searchingRef = useRef(false);

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
        if (searchingRef.current) {
          searchingRef.current = false;
          const rival = r.members.find((m) => m.id !== ident.playerId)?.name ?? 'a stranger';
          sfx('win');
          toast({ kind: 'success', title: 'Opponent found', body: `You are in with ${rival}.` });
          /* Matching can happen while the player is looking at another screen;
             take them to the board rather than leaving them elsewhere. */
          nav(`/room/${r.code}`);
        }
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
        setMessages((prev) => [...prev.slice(-99), { ...p, isSelf: p.senderId === relayId.current }]);
        if (p.senderId !== relayId.current) {
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
      presence: (p) => setPresence(p),
      welcome: (p) => {
        relayId.current = p.playerId;
        setPlayerId(p.playerId);
      },
      invite: (p) => {
        setInvites((prev) => [...prev.filter((i) => i.inviteId !== p.inviteId).slice(-4), p]);
        sfx('notify');
        toast({ kind: 'info', title: `${p.fromName} wants to play`, body: 'Open Play Together to accept.' });
      },
      inviteClosed: (p) => {
        /* An invitation this player sent. `accepted` is not news — the room
           frame does that — but a decline is worth saying plainly. */
        setInvites((prev) => prev.filter((i) => i.inviteId !== p.inviteId));
        if (p.reason === 'declined') {
          toast({ kind: 'info', title: 'Invitation declined', body: 'They are busy right now.' });
        } else if (p.reason === 'expired') {
          toast({ kind: 'info', title: 'Invitation expired', body: 'Nobody answered in a minute.' });
        }
      },
      queue: (q) => {
        /* `matched` and `cancelled` end the search; `waiting` and `timeout`
           keep it on screen. The room event that follows does the navigating. */
        if (q.status === 'waiting' || q.status === 'timeout') {
          setQueue((prev) => ({
            status: q.status,
            gameId: q.gameId,
            waiting: q.waiting,
            since: q.since,
            /* timeout carries the original timestamp; keep the local one if the
               server's is missing so the clock never resets to zero. */
            at: q.since ?? prev?.at ?? Date.now(),
          }));
        } else {
          setQueue(null);
        }
        if (q.status === 'timeout') sfx('spark');
        if (q.status === 'matched') sfx('win');
      },
      left: () => {
        searchingRef.current = false;
        setRoom(null); setYou(null); setMatch(null); setFinished(null); setMessages([]); setPeerTyping(false); setQueue(null);
        try { localStorage.removeItem(RESUME_KEY); } catch { /* ignore */ }
      },
    });
    try { relay.resumeCode = localStorage.getItem(RESUME_KEY); } catch { /* ignore */ }
    relayRef.current = relay;

    /* Identity, in the order it becomes known: whatever the browser remembers,
       then whatever a token proves. `onSessionChange` fires on sign-in, sign-out,
       a refreshed token and a changed block list, and every one of those means
       the relay should be told again. */
    void startSession().then(async () => {
      relay.updateAuth(await currentToken(), blockedIds());
    });
    const stopWatching = onSessionChange(() => {
      void currentToken().then((token) => relay.updateAuth(token, blockedIds()));
    });

    return () => { stopWatching(); relay.close(); relayRef.current = null; };
    // identity is applied via updateIdentity below; we intentionally build the relay once
  }, []);

  useEffect(() => { relayRef.current?.updateIdentity(ident); }, [ident]);

  const connect = useCallback(() => relayRef.current?.connect(), []);
  const api = useMemo<RoomCtx>(() => ({
    conn, rtt, room, you, match, finished, error, messages, peerTyping, presence, queue,
    findMatch: (gameId, settings, roomName) => {
      searchingRef.current = true;
      setQueue({ status: 'waiting', gameId, waiting: 1, since: Date.now(), at: Date.now() });
      relayRef.current?.queueJoin(gameId, settings, roomName);
    },
    cancelMatch: () => {
      searchingRef.current = false;
      relayRef.current?.queueLeave();
      setQueue(null);
    },
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
      /* Opening a room is also a way of stopping the search: the relay takes
         you out of the queue, so the button must stop saying "looking". */
      searchingRef.current = false;
      setQueue(null);
      relayRef.current?.connect();
      relayRef.current?.send({ t: 'create', gameId, settings, roomName, mode });
    },
    join: (code) => {
      searchingRef.current = false;
      setQueue(null);
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
    playerId,
    invites,
    inviteFriend: (to, gameId, settings) => {
      relayRef.current?.connect();
      relayRef.current?.invite(to, gameId, settings);
      sfx('select');
    },
    respondInvite: (inviteId, accept) => {
      setInvites((prev) => prev.filter((i) => i.inviteId !== inviteId));
      relayRef.current?.inviteReply(inviteId, accept);
      if (accept) sfx('select');
    },
    dismissInvite: (inviteId) => setInvites((prev) => prev.filter((i) => i.inviteId !== inviteId)),
  }), [conn, rtt, room, you, match, finished, error, messages, peerTyping, presence, queue, connect, ident.name, playerId, invites]);

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useRoom() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useRoom must be used inside <RoomProvider>');
  return ctx;
}
