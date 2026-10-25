import { useCallback, useEffect, useRef, useState } from 'react';
import SoloShell from '../../components/SoloShell';
import { Button, Panel, Segmented, Stat } from '../../components/ui';
import { useStore } from '../../lib/store';
import { useTouch } from '../../lib/useTouch';
import type { GameMeta } from '../types';
import {
  BASKET_W, CATCH_Y, DEFAULT_BERRY, FIELD_H, FIELD_W, BERRY_R, createBerry, step, type BerryState,
} from './engine';

/**
 * Berry Catch — a Pikachu with a picnic basket under a berry tree.
 *
 * The simulation is in `engine.ts` and knows nothing about the DOM; this file is
 * only the parts that cannot be tested without a screen: painting the sprites,
 * reading a finger or an arrow key, and pushing the HUD out at a rate a person
 * can read rather than sixty times a second.
 *
 * Three deliberate choices:
 *
 *   • **The clock starts when the player says so.** An arcade game that begins
 *     during a screen transition is a game you lose before you understand it.
 *   • **The field is virtual** (720×460) and scaled to whatever the canvas is, so
 *     the basket covers the same fraction of the play area on a phone.
 *   • **A hidden tab pauses, it never advances.** `engine.step` also clamps a
 *     single frame, so a tab returning after a minute cannot dump sixty berries
 *     into the basket at once.
 */
const BASKET_SPEED = 660;      // field px per second under a held arrow key
const HUD_EVERY_MS = 110;

export default function BerrySolo({ game }: { game: GameMeta }) {
  const touch = useTouch();
  const { sfx, finishMatch } = useStore();
  const [duration, setDuration] = useState(60_000);
  const [armed, setArmed] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stateRef = useRef<BerryState>(createBerry({ ...DEFAULT_BERRY, durationMs: 60_000 }, Date.now() >>> 0));
  const basketRef = useRef(FIELD_W / 2);
  const keysRef = useRef<{ left: boolean; right: boolean }>({ left: false, right: false });
  const rafRef = useRef(0);
  const lastTs = useRef(0);
  const hudAt = useRef(0);
  const loggedRef = useRef(false);

  const [hud, setHud] = useState({ score: 0, lives: 3, t: 0, over: false, caught: 0, reason: '' });
  const [dock, setDock] = useState<'ready' | 'playing' | 'over'>('ready');

  const sprites = useRef<{ berry?: HTMLImageElement; rot?: HTMLImageElement; basket?: HTMLImageElement; pika?: HTMLImageElement }>({});

  /* ---------------------------------------------------------------- sprites */
  useEffect(() => {
    const load = (src: string) => {
      const img = new Image();
      img.decoding = 'async';
      img.src = src;
      return img;
    };
    sprites.current = {
      berry: load('/art/berry/berry.webp'),
      rot: load('/art/berry/berry-rot.webp'),
      basket: load('/art/berry/basket.webp'),
      pika: load('/art/pika/run.webp'),
    };
  }, []);

  const reset = useCallback((ms = duration) => {
    stateRef.current = createBerry({ ...DEFAULT_BERRY, durationMs: ms }, (Date.now() ^ 0x2545f491) >>> 0);
    basketRef.current = FIELD_W / 2;
    lastTs.current = 0;
    loggedRef.current = false;
    setHud({ score: 0, lives: DEFAULT_BERRY.lives, t: 0, over: false, caught: 0, reason: '' });
    setDock('ready');
    setArmed(false);
  }, [duration]);

  useEffect(() => { reset(duration); }, [duration, reset]);

  /* ------------------------------------------------------------------ draw */
  const draw = useCallback(() => {
    const cv = canvasRef.current;
    const ctx = cv?.getContext('2d');
    if (!cv || !ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = cv.clientWidth || FIELD_W;
    const h = cv.clientHeight || FIELD_H;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
    }
    const sx = w / FIELD_W;
    const sy = h / FIELD_H;
    ctx.setTransform(dpr * sx, 0, 0, dpr * sy, 0, 0);
    ctx.clearRect(0, 0, FIELD_W, FIELD_H);

    // paper, with a faint cloth stripe at the bottom third so the field has depth
    const paper = ctx.createLinearGradient(0, 0, 0, FIELD_H);
    paper.addColorStop(0, '#fffdf7');
    paper.addColorStop(0.72, '#fdf3e3');
    paper.addColorStop(1, '#f7e7d2');
    ctx.fillStyle = paper;
    ctx.fillRect(0, 0, FIELD_W, FIELD_H);
    ctx.strokeStyle = 'rgba(200,155,120,.22)';
    ctx.lineWidth = 1;
    for (let y = CATCH_Y + 24; y < FIELD_H; y += 26) {
      ctx.beginPath(); ctx.moveTo(0, y + 0.5); ctx.lineTo(FIELD_W, y + 0.5); ctx.stroke();
    }

    const s = stateRef.current;

    // Pikachu stands behind the basket
    const pika = sprites.current.pika;
    if (pika?.complete && pika.naturalWidth) {
      const ph = 96;
      const pw = ph * (pika.naturalWidth / pika.naturalHeight);
      ctx.globalAlpha = 0.97;
      ctx.drawImage(pika, basketRef.current - pw * 0.62, CATCH_Y - ph * 0.62, pw, ph);
      ctx.globalAlpha = 1;
    }

    // the berries
    for (const d of s.drops) {
      const img = d.kind === 'ripe' ? sprites.current.berry : sprites.current.rot;
      const size = BERRY_R * 2.3;
      if (img?.complete && img.naturalWidth) {
        const ratio = img.naturalWidth / img.naturalHeight;
        ctx.save();
        ctx.translate(d.x, d.y);
        ctx.rotate(Math.sin((s.t / 320) + d.wobble) * 0.08);
        ctx.drawImage(img, -size * ratio / 2, -size / 2, size * ratio, size);
        ctx.restore();
      }
    }

    // the basket
    const basket = sprites.current.basket;
    if (basket?.complete && basket.naturalWidth) {
      const bh = 96;
      const bw = bh * (basket.naturalWidth / basket.naturalHeight);
      ctx.drawImage(basket, basketRef.current - bw / 2, CATCH_Y - bh * 0.16, bw, bh);
    }
  }, []);

  /* ------------------------------------------------------------------ loop */
  useEffect(() => {
    const frame = (ts: number) => {
      rafRef.current = requestAnimationFrame(frame);
      const s = stateRef.current;
      if (s.over || !armed) { draw(); return; }
      if (document.hidden) { lastTs.current = ts; return; }
      if (!lastTs.current) lastTs.current = ts;
      const dt = Math.min(80, ts - lastTs.current);
      lastTs.current = ts;

      // keyboard steering
      const k = keysRef.current;
      if (k.left !== k.right) {
        const dir = k.left ? -1 : 1;
        basketRef.current = Math.max(BASKET_W / 2, Math.min(FIELD_W - BASKET_W / 2,
          basketRef.current + dir * BASKET_SPEED * (dt / 1000)));
      }

      const before = s;
      const next = step(s, dt, basketRef.current);
      stateRef.current = next;

      if (next.lastEvent !== before.lastEvent) {
        if (next.lastEvent === 'catch') sfx('pickup');
        else if (next.lastEvent === 'rot') sfx('error');
        else if (next.lastEvent === 'miss') sfx('miss');
      }

      if (ts - hudAt.current > HUD_EVERY_MS) {
        hudAt.current = ts;
        setHud({ score: next.score, lives: next.lives, t: next.t, over: next.over, caught: next.caught, reason: next.reason });
      }

      if (next.over && !loggedRef.current) {
        loggedRef.current = true;
        const record = next.caught >= 25;
        setDock('over');
        sfx(record ? 'win' : 'lose');
        finishMatch({
          gameId: 'berry', mode: 'solo', result: record ? 'win' : 'loss', score: next.score,
          meta: { caught: next.caught, rotted: next.rotted, bestStreak: next.bestStreak, durationMs: next.config.durationMs },
        });
      }

      draw();
    };
    rafRef.current = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(rafRef.current);
  }, [armed, draw, sfx, finishMatch]);

  /* -------------------------------------------------------------- controls */
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') { keysRef.current.left = true; e.preventDefault(); }
      if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') { keysRef.current.right = true; e.preventDefault(); }
      if (e.key === ' ' && !armed && !stateRef.current.over) { setArmed(true); setDock('playing'); sfx('go'); }
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') keysRef.current.left = false;
      if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') keysRef.current.right = false;
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, [armed, sfx]);

  const pointerTo = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const cv = canvasRef.current!;
    const rect = cv.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * FIELD_W;
    basketRef.current = Math.max(BASKET_W / 2, Math.min(FIELD_W - BASKET_W / 2, x));
  };

  const start = () => {
    if (stateRef.current.over) reset(duration);
    setArmed(true);
    setDock('playing');
    sfx('go');
  };

  const secondsLeft = Math.max(0, Math.ceil((duration - hud.t) / 1000));

  return (
    <SoloShell
      game={game}
      wide
      mascot={dock === 'ready' ? 'waiting' : hud.over ? (hud.caught >= 25 ? 'victory' : 'defeated') : hud.lives <= 1 ? 'thinking' : 'competitive'}
      mascotLine={dock === 'ready'
        ? (touch ? 'Slide your thumb to move the basket, then tap to begin.' : 'Arrow keys move the basket. Press space when you are ready.')
        : hud.over
          ? `${hud.reason} Score ${hud.score}.`
          : `${secondsLeft}s left · ${hud.caught} caught · ${hud.lives} ${hud.lives === 1 ? 'life' : 'lives'} left`}
      onRestart={() => reset(duration)}
      controls={
        <>
          <span className="eyebrow ml-1">Run</span>
          <Segmented value={duration} onChange={setDuration} size="sm" label="Run length"
            options={[{ value: 30_000, label: '30s' }, { value: 60_000, label: '60s' }, { value: 90_000, label: '90s' }]} />
        </>
      }
      hud={
        <Panel className="p-2 sm:p-3 flex items-center gap-2 sm:gap-4 flex-wrap justify-center">
          <Stat label="Score" value={hud.score} accent={game.accent} />
          <Stat label="Caught" value={hud.caught} />
          <Stat label="Lives" value={hud.lives} accent={hud.lives <= 1 ? 'var(--color-blush-600)' : undefined} />
          <Stat label="Time" value={`${secondsLeft}s`} />
        </Panel>
      }
    >
      <div className="w-full max-w-[900px] flex flex-col items-center gap-3">
        <div className="relative w-full panel panel-notch p-2 sm:p-3">
          <canvas
            ref={canvasRef}
            aria-label="Berry Catch play field"
            role="img"
            className="w-full block rounded-[14px] touch-none select-none"
            style={{ aspectRatio: `${FIELD_W} / ${FIELD_H}`, background: '#fffdf7', cursor: dock === 'playing' ? 'none' : 'default' }}
            onPointerDown={(e) => { pointerTo(e); if (dock !== 'playing') start(); }}
            onPointerMove={(e) => { if (dock === 'playing') pointerTo(e); }}
          />

          {dock !== 'playing' && (
            <div className="absolute inset-0 grid place-items-center p-4" style={{ borderRadius: 14 }}>
              <div className="panel notch-sm px-4 py-3 text-center max-w-[38ch] bg-ink-800/95">
                <p className="display text-[16px] text-cream-100">
                  {dock === 'ready' ? 'Catch the ripe ones' : 'Run over'}
                </p>
                <p className="text-[11.5px] text-cream-500 leading-snug mt-1">
                  {dock === 'ready'
                    ? 'Ripe berries score and build a streak. Rotten ones cost a life, so let them fall past.'
                    : `Final score ${hud.score} · ${hud.caught} caught.`}
                </p>
                <div className="mt-2.5 flex justify-center">
                  <Button variant="primary" size="sm" onClick={start}>
                    {dock === 'ready' ? 'Start catching' : 'Run again'}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>

        <p className="text-[11px] text-cream-400 text-center max-w-[52ch]">
          Streak bonus: every fourth ripe berry in a row is worth one more point, up to five.
          {touch ? ' Slide to steer.' : ' Arrow keys steer; the game pauses when the tab is hidden.'}
        </p>
      </div>

      {/* A run is one player against the clock, so the versus overlay — built for
          two names and two scores — is the wrong shape here. This is a scorecard. */}
      {hud.over && (
        <div className="fixed inset-0 z-[70] grid place-items-center p-4" style={{ background: 'rgba(92,64,53,.42)' }} role="dialog" aria-modal="true" aria-label="Run finished">
          <Panel className="w-full max-w-[380px] p-5 text-center notch">
            <p className="eyebrow text-volt-700">Run finished</p>
            <p className="display text-[52px] leading-none text-cream-100 tabnum mt-1">{hud.score}</p>
            <p className="text-[12px] text-cream-500 mt-1.5">{hud.reason}</p>
            <div className="grid grid-cols-3 gap-2 mt-3">
              <Stat label="Caught" value={hud.caught} />
              <Stat label="Lives left" value={hud.lives} />
              <Stat label="Time" value={`${Math.round(hud.t / 1000)}s`} />
            </div>
            <div className="flex gap-2 mt-4">
              <Button variant="primary" className="flex-1" onClick={() => reset(duration)}>Run again</Button>
              <Button variant="ghost" onClick={() => reset(duration)}>Change run</Button>
            </div>
          </Panel>
        </div>
      )}
    </SoloShell>
  );
}
