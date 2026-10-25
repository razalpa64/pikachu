/**
 * System lines for the arena chat.
 *
 * The room is full of moments that used to happen silently: the rival joins,
 * the match starts, a game is switched, the result lands. Each transition is
 * pushed exactly once (guarded by a ref of the last seen values) so re-renders
 * from pings, clocks or state updates cannot spam the feed.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { gameById } from '../games/registry';
import type { RoomView } from '../../server/protocol';

export type SystemTone = 'join' | 'leave' | 'start' | 'result' | 'neutral';
export interface SystemLine { id: string; text: string; ts: number; tone?: SystemTone }

export function useRoomSystemLines({
  room, finished, slot, matchId,
}: {
  room: RoomView | null;
  finished: { matchId: string; winnerSlot: 0 | 1 | null; reason: string } | null;
  slot: 0 | 1;
  matchId: string | null;
}) {
  const [lines, setLines] = useState<SystemLine[]>([]);
  const seq = useRef(0);
  const seen = useRef({
    code: null as string | null,
    oppName: null as string | null,
    oppConnected: true,
    gameId: null as string | null,
    status: null as string | null,
    matchId: null as string | null,
    finishedId: null as string | null,
  });

  const push = useCallback((text: string, tone: SystemTone) => {
    seq.current += 1;
    const id = `sys-${seq.current}`;
    setLines((prev) => [...prev.slice(-40), { id, text, ts: Date.now(), tone }]);
  }, []);

  useEffect(() => {
    if (!room) return;
    const v = seen.current;
    const opp = room.members.find((m) => m.slot !== slot) ?? null;

    // first sight of this room
    if (v.code !== room.code) {
      v.code = room.code;
      v.gameId = room.gameId;
      v.status = room.status;
      v.matchId = room.matchId ?? null;
      v.oppName = opp?.name ?? null;
      v.oppConnected = opp?.connected ?? true;
      setLines([]);
      push(`Arena opened · ${room.roomName}`, 'neutral');
      return;
    }

    if (opp && v.oppName !== opp.name) {
      v.oppName = opp.name;
      push(`${opp.name} joined the arena`, 'join');
    }
    if (opp && v.oppConnected !== opp.connected) {
      v.oppConnected = opp.connected;
      push(opp.connected ? `${opp.name} is back` : `${opp.name} dropped out`, opp.connected ? 'join' : 'leave');
    }

    if (v.gameId !== room.gameId) {
      v.gameId = room.gameId;
      push(`Game switched to ${gameById(room.gameId)?.title ?? room.gameId}`, 'neutral');
    }

    if (room.matchId && v.matchId !== room.matchId) {
      v.matchId = room.matchId;
      push(`Match started · ${gameById(room.gameId)?.title ?? 'Game'}`, 'start');
    }

    if (v.status !== room.status) {
      const was = v.status;
      v.status = room.status;
      if (was === 'IN_GAME' && (room.status === 'WAITING' || room.status === 'READY_CHECK')) {
        push('Back in the lobby', 'neutral');
      }
    }
  }, [room, slot, push]);

  useEffect(() => {
    if (!finished || seen.current.finishedId === finished.matchId) return;
    seen.current.finishedId = finished.matchId;
    const verdict = finished.winnerSlot === null
      ? 'Draw'
      : finished.winnerSlot === slot ? 'You won' : 'Your rival won';
    push(`${verdict} · ${finished.reason}`, 'result');
  }, [finished, slot, push]);

  // a match ending while the chat has never been opened should still be narrated
  useEffect(() => { if (matchId) seen.current.matchId = matchId; }, [matchId]);

  return lines;
}

