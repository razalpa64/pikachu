import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BASELINE_X, BASELINE_Y, BOARD, legalStrikerX, simulateShot } from './physics';
import type { Coin, Frame, Shot } from './physics';
import { layout, paintAim, paintBoard, paintCoin, paintStriker } from './paint';
import type { CarromState } from './rules';
import type { Slot } from '../types';

/**
 * The table.
 *
 * One canvas, one animation loop, and one rule about honesty: what you see is
 * the simulation, not a drawing of the outcome. When you let go, the shot you
 * aimed is played out frame by frame from the same function the server referees
 * with — so if the striker clips a coin on the way, you see it happen.
 *
 * Aiming is a slingshot: press anywhere on your half, the striker slides along
 * the baseline to your finger, then pull back from it. The further back, the
 * harder. Let go to shoot.
 */
export default function CarromBoard({
  state, youSlot, interactive, onShoot, className = '',
}: {
  state: CarromState;
  youSlot: Slot;
  interactive: boolean;
  onShoot: (shot: Shot) => void;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState(520);
  const [aim, setAim] = useState<{ angle: number; power: number; x: number } | null>(null);
  const aimRef = useRef<typeof aim>(null);
  const dragRef = useRef<{ id: number } | null>(null);
  const framesRef = useRef<Frame[]>([]);
  const frameAt = useRef(0);
  const previous = useRef<{ coins: Coin[]; at: number } | null>(null);
  const raf = useRef(0);
  /** the newest state, for animation callbacks that outlive the render they started in */
  const latest = useRef(state);
  latest.current = state;

  aimRef.current = aim;

  /* The board is exactly the width the stage gave it. Sizing is `BoardStage`'s
     job (`fitBoardWidth`), not this component's: a board that measures the
     window instead of its column is the bug the stage exists to prevent. */
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      setSize(Math.max(240, Math.round(entry.contentRect.width)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const draw = useCallback((coins: Coin[], striker: { x: number; y: number } | null, strikerAlive: boolean, aimState: typeof aim, glow: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(2.5, window.devicePixelRatio || 1);
    if (canvas.width !== Math.round(size * dpr)) {
      canvas.width = Math.round(size * dpr);
      canvas.height = Math.round(size * dpr);
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);
    const l = layout(size);
    paintBoard(ctx, l);

    // shadows fall left-down; sort so nearer coins overlap further ones
    for (const c of coins) if (c.alive) paintCoin(ctx, l, c);
    if (striker && strikerAlive) {
      if (aimState) paintAim(ctx, l, striker, aimState.angle, aimState.power);
      paintStriker(ctx, l, striker.x, striker.y, glow);
    }
  }, [size]);

  /* Playback of a shot the local player just took. */
  const play = useCallback((frames: Frame[]) => {
    framesRef.current = frames;
    frameAt.current = 0;
    const started = performance.now();
    const step = () => {
      const frames2 = framesRef.current;
      if (!frames2.length) return;
      const elapsed = performance.now() - started;
      const index = Math.min(frames2.length - 1, Math.floor(elapsed / 8.4));
      frameAt.current = index;
      const f = frames2[index];
      draw(f.coins.map((c, i) => ({ ...state.coins[i], ...c })), f.striker, f.alive, null, 0);
      if (index < frames2.length - 1) raf.current = requestAnimationFrame(step);
      else {
        framesRef.current = [];
        /* Redraw from whatever the state is *now*. Drawing the state this
           animation started from left the striker missing from the board: the
           shot had already been applied by then, and the idle effect had
           skipped its frame because the animation was still running. */
        const s2 = latest.current;
        draw(s2.coins, { x: s2.strikerX, y: BASELINE_Y[s2.turn] }, true, null, 0.6);
      }
    };
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(step);
  }, [draw, state.coins]);

  /* A shot that arrives from elsewhere (the opponent, or the server): slide the
     coins from where they were to where they now are. It is not the full replay,
     but it is the truth of the change rather than a teleport. */
  useEffect(() => {
    const before = previous.current;
    previous.current = { coins: state.coins, at: performance.now() };
    if (!before || framesRef.current.length) return;
    const moved = state.coins.some((c, i) => before.coins[i] && Math.hypot(c.x - before.coins[i].x, c.y - before.coins[i].y) > 0.2);
    if (!moved) return;
    const started = performance.now();
    const from = before.coins;
    const step = () => {
      const t = Math.min(1, (performance.now() - started) / 520);
      const ease = 1 - Math.pow(1 - t, 3);
      const mid = state.coins.map((c, i) => {
        const f = from[i] ?? c;
        return { ...c, x: f.x + (c.x - f.x) * ease, y: f.y + (c.y - f.y) * ease, alive: c.alive || (f.alive ? true : false) };
      });
      draw(mid, null, false, null, 0);
      if (t < 1) requestAnimationFrame(step);
      else draw(state.coins, null, false, null, 0);
    };
    requestAnimationFrame(step);
  }, [state.coins, draw]);

  /* Idle render: the board, the coins, the striker waiting on its baseline. */
  useEffect(() => {
    if (framesRef.current.length) return;
    const y = BASELINE_Y[state.turn];
    draw(state.coins, { x: state.strikerX, y }, true, aim, interactive ? 0.6 : 0.25);
  }, [state.coins, state.turn, state.strikerX, aim, interactive, draw]);

  const toBoard = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const l = layout(rect.width);
    const scale = rect.width / size;
    const x = ((clientX - rect.left) / scale - l.origin) / l.scale;
    const y = ((clientY - rect.top) / scale - l.origin) / l.scale;
    return { x, y };
  };

  const release = () => {
    const a = aimRef.current;
    dragRef.current = null;
    setAim(null);
    if (!a || !interactive) return;
    if (a.power < 0.06) return;
    const shot: Shot = { x: a.x, angle: a.angle, power: a.power };
    const striker = { x: a.x, y: BASELINE_Y[state.turn] };
    const sim = simulateShot(state.coins, striker, shot, true);
    play(sim.frames);
    onShoot(shot);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (!interactive) return;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    const p = toBoard(e.clientX, e.clientY);
    dragRef.current = { id: e.pointerId };
    const x = legalStrikerX(state.coins, state.turn, p.x);
    setAim({ x, angle: state.turn === 0 ? -Math.PI / 2 : Math.PI / 2, power: 0 });
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current || !interactive) return;
    const p = toBoard(e.clientX, e.clientY);
    const striker = { x: aimRef.current?.x ?? state.strikerX, y: BASELINE_Y[state.turn] };
    const dx = striker.x - p.x, dy = striker.y - p.y;
    const dist = Math.hypot(dx, dy);
    const angle = Math.atan2(dy, dx);
    const power = Math.min(1, dist / 28);
    setAim({ x: legalStrikerX(state.coins, state.turn, striker.x), angle, power });
  };

  const coinsKey = useMemo(() => state.coins.map((c) => `${c.alive ? 1 : 0}`).join(''), [state.coins]);

  return (
    <div ref={wrapRef} className={`w-full flex justify-center ${className}`}>
      <canvas
        ref={canvasRef}
        width={size}
        height={size}
        style={{
          width: '100%',
          maxWidth: 'var(--stage-w, 100%)',
          aspectRatio: '1',
          marginInline: 'auto',
          display: 'block',
          touchAction: 'none',
          borderRadius: 18,
          cursor: interactive ? 'grab' : 'default',
        }}
        role="img"
        aria-label={`Carrom board. ${state.coins.filter((c) => c.alive).length} coins on the board, ${interactive ? 'your shot' : 'waiting'}.`}
        data-coins={coinsKey}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={release}
        onPointerCancel={() => { dragRef.current = null; setAim(null); }}
      />
    </div>
  );
}

/** Board units are 0..100; exported so a caller can test drag maths without a canvas. */
export const BOARD_SPAN = BOARD;
export const BASELINE_RANGE = BASELINE_X;
