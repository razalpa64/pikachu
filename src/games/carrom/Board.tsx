import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BASELINE_X, BASELINE_Y, BOARD, COIN_R, legalStrikerX, simulateShot } from './physics';
import type { Coin, Frame, Shot } from './physics';
import {
  aimPreview, buildBoard, layout, paintAim, paintCoin, paintGhost, paintPocketBurst, paintStriker,
} from './paint';
import type { PaintSize } from './paint';
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
 * The same is true of the *other* player's shot. The referee records the shot it
 * actually ran (`state.lastMove`), and every client replays it with the same
 * deterministic simulation. That is the difference between watching an opponent
 * play and watching their coins appear somewhere else: a shot takes as long here
 * as it took on their screen, because it is the same shot.
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
  const [size, setSize] = useState(520);
  const [aim, setAim] = useState<{ angle: number; power: number; x: number } | null>(null);
  const aimRef = useRef<typeof aim>(null);
  const dragRef = useRef<{ id: number } | null>(null);
  const framesRef = useRef<Frame[]>([]);
  const previous = useRef<{ coins: Coin[]; at: number } | null>(null);
  const raf = useRef(0);
  const lastFrame = useRef<{ coins: { x: number; y: number; alive: boolean }[]; striker: { x: number; y: number }; alive: boolean } | null>(null);
  const bursts = useRef<{ x: number; y: number; kind: Coin['kind']; at: number }[]>([]);
  const texture = useRef<{ canvas: HTMLCanvasElement; size: number; dpr: number } | null>(null);
  /** the newest state, for animation callbacks that outlive the render they started in */
  const latest = useRef(state);
  latest.current = state;
  /** the shot id whose replay this board has already played — so it plays once */
  const playedId = useRef(0);
  const prevState = useRef<CarromState>(state);

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

  /* The table is painted once and blitted; only the pieces move. */
  const getTexture = useCallback(() => {
    const dpr = Math.min(2.5, window.devicePixelRatio || 1);
    if (!texture.current || texture.current.size !== size || texture.current.dpr !== dpr) {
      texture.current = { canvas: buildBoard(size, dpr), size, dpr };
    }
    return texture.current.canvas;
  }, [size]);

  const draw = useCallback((
    coins: Coin[],
    striker: { x: number; y: number } | null,
    strikerAlive: boolean,
    aimState: typeof aim,
    glow: number,
    trail?: { x: number; y: number }[] | null,
  ) => {
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
    const l: PaintSize = layout(size);
    ctx.clearRect(0, 0, size, size);
    ctx.drawImage(getTexture(), 0, 0, size, size);

    // a coin's motion leaves a short streak, so a fast break can be followed
    if (trail) {
      ctx.save();
      ctx.lineCap = 'round';
      for (let i = 0; i < coins.length; i++) {
        const c = coins[i];
        const p = trail[i];
        if (!c.alive || !p) continue;
        const dx = c.x - p.x, dy = c.y - p.y;
        if (Math.hypot(dx, dy) < 0.35) continue;
        const x0 = l.origin + p.x * l.scale, y0 = l.origin + p.y * l.scale;
        const x1 = l.origin + c.x * l.scale, y1 = l.origin + c.y * l.scale;
        const g = ctx.createLinearGradient(x0, y0, x1, y1);
        g.addColorStop(0, 'rgba(255,250,235,0)');
        g.addColorStop(1, c.kind === 'black' ? 'rgba(70,50,34,.28)' : 'rgba(255,252,240,.5)');
        ctx.strokeStyle = g;
        ctx.lineWidth = COIN_R * l.scale * 1.5;
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
      }
      ctx.restore();
    }

    for (const c of coins) if (c.alive) paintCoin(ctx, l, c);
    // the striker is painted over the coins it is among, like a real striker
    if (striker && strikerAlive) {
      if (aimState) {
        const preview = aimPreview(coins, striker, aimState.angle);
        paintAim(ctx, l, striker, aimState.angle, aimState.power);
        if (preview.hitAt && aimState.power > 0.05) paintGhost(ctx, l, preview.hitAt, preview.coin);
      }
      paintStriker(ctx, l, striker.x, striker.y, glow);
    }

    // anything that went into a pocket this second
    const now = performance.now();
    bursts.current = bursts.current.filter((b) => now - b.at < 420);
    for (const b of bursts.current) paintPocketBurst(ctx, l, b.x, b.y, (now - b.at) / 420, b.kind);
  }, [size, getTexture]);

  /** Play a shot's frames. Used for your own shot *and* the opponent's. */
  const play = useCallback((frames: Frame[]) => {
    if (!frames.length) return;
    /* A plain DOM flag while frames are running. It costs nothing, it keeps the
       component out of a re-render per frame, and it is what the browser test
       watches to prove the opponent's shot is actually being played. */
    if (canvasRef.current) canvasRef.current.dataset.carromPlaying = '1';
    framesRef.current = frames;
    lastFrame.current = null;
    previous.current = { coins: latest.current.coins, at: performance.now() };
    const started = performance.now();
    // real time at 120 Hz, compressed only if a shot somehow runs very long
    const perFrame = Math.min(8.34, 2600 / frames.length);

    const step = () => {
      const list = framesRef.current;
      if (!list.length) return;
      const index = Math.min(list.length - 1, Math.floor((performance.now() - started) / perFrame));
      const f = list[index];
      const skin = latest.current.coins;

      // a coin that was here last frame and is gone now just went in a pocket
      const prev = lastFrame.current;
      if (prev) {
        f.coins.forEach((c, i) => {
          if (prev.coins[i]?.alive && !c.alive) {
            bursts.current.push({ x: prev.coins[i].x, y: prev.coins[i].y, kind: skin[i]?.kind ?? 'white', at: performance.now() });
          }
        });
      }
      const animated = f.coins.map((c, i) => ({ ...skin[i], ...c }));
      draw(animated, f.striker, f.alive, null, 0, prev ? prev.coins : null);
      lastFrame.current = { coins: f.coins, striker: f.striker, alive: f.alive };

      if (index < list.length - 1) raf.current = requestAnimationFrame(step);
      else {
        framesRef.current = [];
        lastFrame.current = null;
        if (canvasRef.current) canvasRef.current.dataset.carromPlaying = '0';
        /* Redraw from whatever the state is *now*. Drawing the state this
           animation started from left the striker missing from the board: the
           shot had already been applied by then, and the idle effect had
           skipped its frame because the animation was still running. */
        const s2 = latest.current;
        previous.current = { coins: s2.coins, at: performance.now() };
        draw(s2.coins, { x: s2.strikerX, y: BASELINE_Y[s2.turn] }, true, null, 0.6);
      }
    };
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(step);
  }, [draw]);

  /**
   * Every shot the referee announces is replayed here — including the other
   * player's. This is the fix for "their move happens in an instant": the board
   * used to slide the coins from where they were to where they ended up in one
   * easing blur, which at network speed looked like nothing at all. Now the same
   * deterministic simulation that decided the outcome draws it again.
   */
  useEffect(() => {
    const before = prevState.current;
    prevState.current = state;
    const move = state.lastMove;
    if (!move || move.id === playedId.current) return;
    playedId.current = move.id;
    if (!before || before.coins === state.coins) return;
    const frames = simulateShot(before.coins, { x: move.shot.x, y: BASELINE_Y[move.player] }, move.shot, true).frames;
    play(frames);
  }, [state, play]);

  /* Idle render: the board, the coins, the striker waiting on its baseline. */
  useEffect(() => {
    /* a replay is running — unless the board was reset underneath it */
    if (framesRef.current.length) {
      if (state.lastMove === null) {
        framesRef.current = [];
        cancelAnimationFrame(raf.current);
        if (canvasRef.current) canvasRef.current.dataset.carromPlaying = '0';
      } else return;
    }
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
    // the state that comes back will carry this same shot; do not play it twice
    playedId.current = state.shots + 1;
    play(sim.frames);
    onShoot(shot);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (!interactive || framesRef.current.length) return;
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
    <div className={`w-full flex justify-center ${className}`}>
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
        data-carrom-shots={state.shots}
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
