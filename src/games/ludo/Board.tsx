import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { YARDS, cellFor, pathBetween } from './track';
import { buildBoard, boardLayout, drawTarget, drawToken, drawTurnGlow, type Layout, type TokenDraw } from './paint';
import { HOME_STEP, movableTokens, seatOf, type LudoMove, type LudoState } from './rules';
import type { Slot } from '../types';

/**
 * The table, animated.
 *
 * Three ideas hold this together:
 *
 *  1. the board is painted once (see `paint.ts`) and blitted, so the expensive
 *     detail costs nothing per frame;
 *  2. every token has a *queue of squares* to hop through, built from the event
 *     the referee reported — so a six really does walk six squares one at a
 *     time instead of sliding diagonally through the middle;
 *  3. nothing here decides anything. It renders the state it is given and sends
 *     moves back. The relay is the only authority.
 */

const HOP_MS = 118;
const FLY_MS = 520;

type Spot = { gx: number; gy: number };

interface Flight {
  key: string;
  seat: number;
  queue: Spot[];
  startedAt: number;
  from: Spot;
  fromAt: number;
  alpha: number;
  scale: number;
  duration: number;
}

const keyOf = (slot: number, token: number) => `${slot}:${token}`;

/** Where a token belongs when it is not moving. */
function restingSpot(slot: Slot, seat: number, progress: number, token: number): Spot {
  const cell = progress < 0 ? YARDS[seat][token] : cellFor(seat, progress);
  return { gx: cell![0], gy: cell![1] };
}

export function LudoBoard({
  state, youSlot, interactive, onMove, className = '',
}: {
  state: LudoState;
  youSlot: Slot;
  interactive: boolean;
  onMove: (m: LudoMove) => void;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState(560);
  const [selected, setSelected] = useState<number | null>(null);
  const flights = useRef<Map<string, Flight>>(new Map());
  const spots = useRef<Map<string, Spot>>(new Map());
  const texture = useRef<{ canvas: HTMLCanvasElement; size: number; active: string } | null>(null);
  const raf = useRef(0);

  const activeSeats = state.seats;

  /* Fit the stage: square, and never larger than the column it is in. */
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setSize(Math.max(240, Math.round(entry.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const layout: Layout = useMemo(() => boardLayout(size), [size]);

  /* Paint (or repaint) the board when its size or its occupants change. */
  const getTexture = useCallback(() => {
    const key = `${activeSeats.join(',')}`;
    const dpr = Math.min(2.5, window.devicePixelRatio || 1);
    if (!texture.current || texture.current.size !== size || texture.current.active !== key) {
      texture.current = { canvas: buildBoard(size, activeSeats, dpr), size, active: key };
    }
    return texture.current.canvas;
  }, [size, activeSeats]);

  /* Seed the resting positions, then queue a hop for whatever the event says
     moved. This runs *during* render on purpose: a flight queued from an effect
     could race the frame loop, which reads the same maps. */
  const renderedFor = useRef<string>('');
  const renderKey = JSON.stringify(state.tokens) + '|' + (state.event ? JSON.stringify(state.event) : '');
  if (renderedFor.current !== renderKey) {
    renderedFor.current = renderKey;
    const seen = new Map<string, Spot>();
    for (const slot of [0, 1] as Slot[]) {
      const seat = seatOf(slot);
      state.tokens[slot].forEach((progress, token) => {
        seen.set(keyOf(slot, token), restingSpot(slot, seat, progress, token));
      });
    }

    const ev = state.event;
    if (ev && ev.token !== undefined && (ev.kind === 'move' || ev.kind === 'capture' || ev.kind === 'home' || ev.kind === 'out')) {
      const slot = ev.slot;
      const seat = seatOf(slot);
      const key = keyOf(slot, ev.token);
      const from = ev.from ?? -1;
      const to = ev.to ?? 0;
      const queue: Spot[] = [];
      if (from < 0) queue.push(seen.get(key) ?? { gx: 0, gy: 0 });
      else if (to >= HOME_STEP) {
        for (const [gx, gy] of pathBetween(seat, from + 1, HOME_STEP - 1)) queue.push({ gx, gy });
        queue.push({ gx: 7, gy: 7 });
      } else {
        for (const [gx, gy] of pathBetween(seat, from + 1, to)) queue.push({ gx, gy });
      }
      const current = spots.current.get(key) ?? seen.get(key) ?? { gx: 0, gy: 0 };
      flights.current.set(key, {
        key, seat, queue, startedAt: performance.now(), from: current, fromAt: 0,
        alpha: 1, scale: 1, duration: HOP_MS,
      });

      /* captured tokens fly home */
      for (const c of ev.captured ?? []) {
        const ck = keyOf(c.slot, c.token);
        const cseat = seatOf(c.slot);
        const home = YARDS[cseat][c.token];
        flights.current.set(ck, {
          key: ck, seat: cseat,
          queue: [{ gx: home[0], gy: home[1] }],
          startedAt: performance.now(),
          from: spots.current.get(ck) ?? { gx: home[0], gy: home[1] },
          fromAt: 0, alpha: 1, scale: 1, duration: FLY_MS,
        });
      }
    }
    spots.current = seen;
  }

  /* The frame loop. */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(2.5, window.devicePixelRatio || 1);
    if (canvas.width !== Math.round(size * dpr)) {
      canvas.width = Math.round(size * dpr);
      canvas.height = Math.round(size * dpr);
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const movable = new Set(
      interactive && state.dice !== null ? movableTokens(state, youSlot, state.dice) : [],
    );

    const draw = (now: number) => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size, size);
      ctx.drawImage(getTexture(), 0, 0, size, size);

      // the seat to play gets a halo behind its yard
      drawTurnGlow(ctx, layout, seatOf(state.turn), now);

      // where every token is *right now*
      const positions: { key: string; slot: Slot; token: number; seat: number; spot: Spot; lift: number; alpha: number; scale: number }[] = [];
      for (const slot of [0, 1] as Slot[]) {
        const seat = seatOf(slot);
        state.tokens[slot].forEach((progress, token) => {
          const key = keyOf(slot, token);
          const rest = spots.current.get(key) ?? restingSpot(slot, seat, progress, token);
          const flight = flights.current.get(key);
          if (!flight) {
            positions.push({ key, slot, token, seat, spot: rest, lift: 0, alpha: 1, scale: 1 });
            return;
          }
          const elapsed = now - flight.startedAt;
          const per = flight.duration;
          const index = Math.floor(elapsed / per);
          if (index >= flight.queue.length) {
            flights.current.delete(key);
            const last = flight.queue[flight.queue.length - 1] ?? rest;
            positions.push({ key, slot, token, seat, spot: last, lift: 0, alpha: 1, scale: 1 });
            return;
          }
          const t = (elapsed % per) / per;
          const from = index === 0 ? flight.from : (flight.queue[index - 1] ?? flight.from);
          const to = flight.queue[index] ?? from;
          const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
          const isFly = per === FLY_MS;
          positions.push({
            key, slot, token, seat,
            spot: { gx: from.gx + (to.gx - from.gx) * ease, gy: from.gy + (to.gy - from.gy) * ease },
            lift: Math.sin(Math.PI * t) * (isFly ? 1.35 : 0.75),
            alpha: isFly ? Math.max(0.25, 1 - t * 0.5) : 1,
            scale: isFly ? 1 - t * 0.25 : 1,
          });
        });
      }

      // draw the token that is in the air last, so it passes over the others
      positions.sort((a, b) => a.lift - b.lift);
      for (const p of positions) {
        const drawable: TokenDraw = {
          gx: p.spot.gx, gy: p.spot.gy, seat: p.seat, lift: p.lift, alpha: p.alpha, scale: p.scale,
        };
        drawToken(ctx, layout, drawable);
      }

      // a ring around every token the player may move, and around the selected one
      if (interactive && state.dice !== null) {
        const pulse = 0.5 + Math.sin(now / 260) * 0.5;
        for (const p of positions) {
          if (p.slot !== youSlot || !movable.has(p.token)) continue;
          const isSel = selected === p.token;
          if (!isSel) {
            drawTarget(ctx, layout, p.spot.gx, p.spot.gy, 'rgba(255,240,180,.55)', pulse * 0.55);
          }
          if (isSel) {
            drawTarget(ctx, layout, p.spot.gx, p.spot.gy, 'rgba(255,255,255,.9)', pulse);
          }
        }
      }
      raf.current = requestAnimationFrame(draw);
    };

    raf.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf.current);
  }, [size, layout, state, youSlot, interactive, selected, getTexture]);

  /* Tapping a token that can move plays it. */
  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!interactive || state.dice === null) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const scale = size / rect.width;
    const gx = ((e.clientX - rect.left) * scale - layout.ox) / layout.cell;
    const gy = ((e.clientY - rect.top) * scale - layout.oy) / layout.cell;
    const movable = movableTokens(state, youSlot, state.dice);
    let best: { token: number; d: number } | null = null;
    for (const token of movable) {
      const key = keyOf(youSlot, token);
      const spot = spots.current.get(key);
      if (!spot) continue;
      const d = Math.hypot(spot.gx - gx, spot.gy - gy);
      if (d < 1.1 && (!best || d < best.d)) best = { token, d };
    }
    if (!best) { setSelected(null); return; }
    setSelected(best.token);
    onMove({ t: 'move', token: best.token });
  };

  const youSeat = seatOf(youSlot);
  const waiting = !interactive;

  /* The hit targets, published. It is what the pointer handler uses and what an
     end-to-end test can aim at, instead of guessing at pixels. */
  const hitTargets = useMemo(() => {
    if (!interactive || state.dice === null) return '[]';
    return JSON.stringify(
      movableTokens(state, youSlot, state.dice).map((token) => {
        const spot = spots.current.get(keyOf(youSlot, token));
        return spot ? { token, gx: +spot.gx.toFixed(2), gy: +spot.gy.toFixed(2) } : null;
      }).filter(Boolean),
    );
  }, [state, youSlot, interactive]);

  return (
    <div className={`w-full flex flex-col items-center gap-2 ${className}`}>
      <canvas
        ref={canvasRef}
        width={size}
        height={size}
        data-ludo-board=""
        data-ludo-turn={state.turn}
        data-ludo-dice={state.dice ?? ''}
        data-ludo-tokens={JSON.stringify(state.tokens)}
        data-ludo-hits={hitTargets}
        aria-label={`Ludo board. ${waiting ? 'Waiting for the other player' : state.dice === null ? 'Your turn to roll' : `You rolled ${state.dice}`}.`}
        role="img"
        onPointerDown={onPointerDown}
        style={{
          width: '100%',
          maxWidth: 'var(--stage-w, 100%)',
          aspectRatio: '1',
          marginInline: 'auto',
          display: 'block',
          touchAction: 'manipulation',
          cursor: interactive && state.dice !== null ? 'pointer' : 'default',
          borderRadius: size * 0.03,
        }}
      />
    </div>
  );
}

export { HOME_STEP };
