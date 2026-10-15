import { useCallback, useEffect, useRef, useState } from 'react';
import { useTouch } from '../../lib/useTouch';
import SoloShell from '../../components/SoloShell';
import { ResultOverlay } from '../../components/Overlays';
import { Button, Icon, Panel, Segmented, Stat } from '../../components/ui';
import { useStore } from '../../lib/store';
import type { Cue } from '../../lib/audio';
import type { GameMeta } from '../types';
import { loadSprites, onSpritesReady, RUNNER_FRAMES, type Sprites } from './sprites';

/**
 * Volt Runner — a side-on endless runner in the Chrome-dinosaur mould.
 *
 * One ground line, one life. Pikachu runs on the spot at a fixed x and the world
 * scrolls past; you jump the things on the ground and duck the things in the air.
 * Speed ramps with distance and never resets, so every run ends.
 *
 * Simulation happens in a fixed *virtual* field (VW × VH below) and the renderer
 * scales that to whatever the canvas actually is. That keeps gravity, jump height
 * and obstacle gaps identical on a phone and on a desktop — tuning against raw
 * canvas pixels made the game trivially easy on a wide screen and impossible on
 * a narrow one.
 *
 * Everything lives in a ref-held world object so React never re-renders per
 * frame; the HUD is pushed out at ~8 Hz. The loop halts on `document.hidden`.
 */

/* ---------------------------------------------------------------- tuning */
const VW = 820;                 // virtual field width — the road you can see
const VH = 290;                 // nominal field height; the canvas CSS matches
                                // this aspect, and the ground is bottom-anchored
                                // so a taller box just means more sky. 290 puts
                                // the jump apex (139) + Pikachu (64) just under
                                // the ceiling instead of stranding dead sky
const PLAYER_X = VW * 0.17;

const GRAVITY = 2650;           // px/s²
const JUMP_V = -860;            // initial jump velocity  → apex ≈ 139px
const FAST_FALL = 2.15;         // gravity multiplier while holding down mid-air
/** How long a jump keeps you off the ground. Drives the minimum obstacle gap. */
const AIR_TIME = (2 * -JUMP_V) / GRAVITY;   // ≈0.649s

const STAND_W = 54, STAND_H = 64;
const DUCK_W = 68, DUCK_H = 38;

/* Forgiving hitboxes — the standard runner trick, and here it is load-bearing.
   Measured against the full sprites, a 54px-wide player passing a 42px-wide
   wall overlaps for 96px of travel; at chill pace that is 0.24s, and since the
   jump only holds you above a 58px wall for 0.50s, a slightly early jump landed
   you on the obstacle's trailing edge while visibly above it. Shrinking both
   boxes buys back ~0.15s of slack and kills the "but I cleared it!" deaths.
   Charges keep a full-size box — a collectible should be easy to take. */
const HIT_PLAYER_X = 0.62;
const HIT_PLAYER_Y = 0.92;
const HIT_OB = 0.84;

const PACES = { chill: 300, standard: 380, frantic: 460 } as const;
type Pace = keyof typeof PACES;

/* ---------------------------------------------------------------- zoom
 * A 2.83:1 side-scroller inside a 393px portrait phone is a 129px letterbox
 * slit, and Pikachu renders about 28px tall. The only lever that makes him
 * bigger is showing LESS road — but naively cropping the road steals reaction
 * time, which is the one thing this game's tuning is built around.
 *
 * So the zoom is derived, not guessed. For a zoom `m` we show `VW/m` of road
 * and then compensate everything that would otherwise change the difficulty:
 *
 *   road    = VW / m                      less road visible
 *   px      = road * 0.17                 player keeps its proportional place
 *   speedK  = (road - px) / (VW - PLAYER_X)
 *                                         speed scaled so the time between an
 *                                         obstacle appearing and reaching you
 *                                         is IDENTICAL to desktop
 *   grav    = GRAVITY / m                 airtime grows by m, so a jump still
 *                                         spans the same obstacle width even
 *                                         though that width is now relatively
 *                                         larger; apex grows by m to match
 *
 * `dist` is then banked in design units (world units ÷ speedK) so a phone score
 * and a desktop score mean the same thing and share one personal best.
 */
export interface Tune { m: number; road: number; px: number; grav: number; speedK: number; air: number; vh: number; apex: number }
export function tuneFor(m: number): Tune {
  const road = VW / m;
  const px = road * 0.17;
  const speedK = (road - px) / (VW - PLAYER_X);
  const grav = GRAVITY / m;
  const air = (2 * -JUMP_V) / grav;
  const apex = (JUMP_V * JUMP_V) / (2 * grav);
  // the box has to hold the ground strip, the (taller) jump apex and the sprite
  const vh = Math.max(VH, 54 + apex + STAND_H + 18);
  return { m, road, px, grav, speedK, air, vh, apex };
}
/** Phones get the zoom; anything with room for the full road keeps m = 1. */
export const pickZoom = (vw: number) => (vw < 560 ? 1.7 : vw < 760 ? 1.25 : 1);

const DAY_LEN = 2400;           // distance units per half of the day/night cycle

type ObKind = 'tree' | 'wall' | 'drone-low' | 'drone-high' | 'charge';

/**
 * Drawn height of each obstacle plus its sprite's real aspect ratio, so the
 * hitbox is derived from the same numbers the renderer blits with.
 *
 * This used to be hand-tuned per kind and the hay bales (a 450x200 sprite) drew
 * ~130 virtual px wide against a 42px hitbox — you could sail straight through
 * two thirds of a visible obstacle. `obWidth` is now the only source of width.
 * `arcade.test.ts` asserts these aspects still match the files on disk.
 */
const OB_SPEC: Record<ObKind, { h: number; aspect: number }> = {
  tree: { h: 56, aspect: 227 / 220 },          // blossom tree: tall, narrow
  wall: { h: 40, aspect: 450 / 200 },          // hay bales: low, wide
  'drone-low': { h: 40, aspect: 167 / 160 },
  'drone-high': { h: 40, aspect: 167 / 160 },
  charge: { h: 34, aspect: 77 / 106 },
};
const obWidth = (k: ObKind) => OB_SPEC[k].h * OB_SPEC[k].aspect;
const mk = (k: ObKind, x: number, base: number): Ob =>
  ({ x, kind: k, w: obWidth(k), h: OB_SPEC[k].h, base, bob: Math.random() * 6 });

interface Ob {
  x: number; kind: ObKind; w: number; h: number;
  /** bottom edge measured upward from the ground line (0 = on the ground) */
  base: number;
  hit?: boolean; bob: number;
}

interface World {
  t: number; dist: number; score: number; base: number; tune: Tune;
  /** player vertical offset above the ground, positive = airborne */
  y: number; vy: number; ducking: boolean; airborne: boolean;
  obs: Ob[]; nextGap: number;
  over: boolean; flash: number; shake: number; night: number;
  charges: number; runFrame: number;
}

/* ================================================================= world */
function newWorld(base: number, tune: Tune = tuneFor(1)): World {
  return {
    t: 0, dist: 0, score: 0, base: base * tune.speedK, tune,
    y: 0, vy: 0, ducking: false, airborne: false,
    obs: [], nextGap: tune.road * 0.75,
    over: false, flash: 0, shake: 0, night: 0,
    charges: 0, runFrame: 0,
  };
}

/** Current scroll speed in virtual px/s. Ramps with distance, then plateaus. */
function speedOf(w: World) {
  return w.base * Math.min(2.45, 1 + w.dist / 2800);
}

export function jump(w: World, sfx: (k: Cue) => void) {
  if (w.over || w.airborne) return;
  w.vy = JUMP_V;
  w.airborne = true;
  w.ducking = false;
  sfx('jump');
}

/** Spawns one pattern and returns the extra width it occupies past its anchor. */
function spawn(w: World): number {
  const r = Math.random();
  // Flying obstacles only start appearing once the run is up to speed, exactly
  // like the dino's pterodactyls — otherwise the first ten seconds are brutal.
  const canFly = w.dist > 700;
  if (canFly && r < 0.16) {
    // low flyer: overlaps a standing player, clears a ducking one → must duck
    w.obs.push(mk('drone-low', w.tune.road + 40, 40));
    return 0;
  } else if (canFly && r < 0.24) {
    // high flyer: safe while standing, punishes a careless jump
    w.obs.push(mk('drone-high', w.tune.road + 40, 88));
    return 0;
  } else if (r < 0.46) {
    w.obs.push(mk('tree', w.tune.road + 40, 0));
    return 0;
  } else if (r < 0.72) {
    w.obs.push(mk('wall', w.tune.road + 40, 0));
    return 0;
  } else if (r < 0.84) {
    // a cluster of two — the classic double cactus. The follower's width is
    // handed back so it is charged against the *next* gap; otherwise a cluster
    // silently eats 40px of the following reaction window.
    w.obs.push(mk('tree', w.tune.road + 40, 0));
    w.obs.push(mk('tree', w.tune.road + 40 + obWidth('tree') - 6, 0));
    return obWidth('tree') - 6;
  }
  // a charge floating within a normal jump arc — optional points, never a hazard
  /* A charge has to sit INSIDE a normal jump, so its height is a fraction of
     the arc rather than an absolute number. Obstacle heights stay absolute —
     they are judged against the player's body, which does not scale — but the
     apex grows with the zoom, and a fixed 70-100 left phone players sailing
     clean over every charge. At m=1 this is still 69-99, exactly as before. */
  /* A charge must sit where the player's BODY passes, which is a band around
     the apex, not the apex itself: at the top of the arc the sprite occupies
     [y, y+STAND_H], so a charge level with the apex is already under its feet.
     Obstacle heights stay absolute — they are judged against the body, which
     does not scale — but the apex grows with the zoom, so this one has to
     follow it or phone players sail clean over every charge. */
  w.obs.push(mk('charge', w.tune.road + 40, w.tune.apex - 46 + Math.random() * 40));
  return 0;
}

function tickWorld(w: World, dt: number, sfx: (k: Cue) => void) {
  w.t += dt;
  const sp = speedOf(w);
  w.dist += (sp / w.tune.speedK) * dt * 0.1;   // design units, device-independent
  w.score = Math.floor(w.dist) + w.charges * 25;
  w.night = (w.dist % (DAY_LEN * 2)) / DAY_LEN;   // 0..2, >1 is night
  if (w.flash > 0) w.flash -= dt * 3;
  if (w.shake > 0) w.shake -= dt * 4;
  w.runFrame = (w.runFrame + dt * (6 + sp / 120)) % RUNNER_FRAMES;

  /* ---- player physics ----
     `y` is measured upward from the ground line; `vy` is negative while rising.
     Holding down in mid-air multiplies gravity, which is the dino's fast-drop. */
  if (w.airborne) {
    w.vy += w.tune.grav * dt * (w.ducking ? FAST_FALL : 1);
    w.y += -w.vy * dt;
    if (w.y <= 0) { w.y = 0; w.vy = 0; w.airborne = false; }
  }

  /* ---- scroll + spawn ---- */
  w.nextGap -= sp * dt;
  if (w.nextGap <= 0) {
    const extra = spawn(w);
    /* Gaps are measured in SECONDS, not pixels.
       A jump commits you for AIR_TIME (~0.65s) and has to be started ~0.33s
       before the obstacle arrives, so two obstacles AIR_TIME apart are literally
       unclearable: you land 0.32s after the first and the second already needed
       its jump 0.09s ago. The floor is therefore a full airtime PLUS a reaction
       buffer, and it only tightens a little as the run speeds up. */
    const ramp = Math.min(1, w.dist / 3000);
    const minSec = w.tune.air + 0.46 - ramp * 0.11;   // 1.11s → 1.00s at m=1
    const varSec = 0.85 - ramp * 0.30;                // 0.85s → 0.55s
    w.nextGap = sp * (minSec + Math.random() * varSec) + extra;
  }

  const fullW = w.ducking ? DUCK_W : STAND_W;
  const fullH = w.ducking ? DUCK_H : STAND_H;

  for (const o of w.obs) {
    o.x -= sp * dt;
    if (o.hit) continue;
    const pick = o.kind === 'charge';
    const pw = (pick ? fullW : fullW * HIT_PLAYER_X) / 2;
    const ph = pick ? fullH : fullH * HIT_PLAYER_Y;
    const ow = (pick ? o.w : o.w * HIT_OB) / 2;
    const oh = pick ? o.h : o.h * HIT_OB;
    if (o.x + ow < w.tune.px - pw || o.x - ow > w.tune.px + pw) continue;
    if (w.y + ph <= o.base || w.y >= o.base + oh) continue;   // clean miss vertically
    if (pick) {
      o.hit = true; w.charges += 1; sfx('pickup');
    } else {
      o.hit = true; w.over = true; w.flash = 1; w.shake = 1; sfx('lose');
    }
  }
  w.obs = w.obs.filter((o) => o.x > -80 && !(o.hit && o.kind === 'charge'));
}

/* ============================================================== renderer */
/** Blend two #rrggbb colours. Used so dusk eases in instead of snapping. */
function mix(a: string, b: string, t: number) {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const k = Math.max(0, Math.min(1, t));
  const ch = (sh: number) => Math.round((((pa >> sh) & 255) * (1 - k)) + (((pb >> sh) & 255) * k));
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
}

function render(
  cv: HTMLCanvasElement | null, w: World, quality: string,
  running: boolean, paused: boolean, sp: Sprites, touch = false,
) {
  if (!cv) return;
  const dpr = Math.min(window.devicePixelRatio || 1, quality === 'performance' ? 1 : 2);
  const cw = cv.clientWidth, ch = cv.clientHeight;
  if (!cw || !ch) return;
  if (cv.width !== Math.round(cw * dpr) || cv.height !== Math.round(ch * dpr)) {
    cv.width = Math.round(cw * dpr); cv.height = Math.round(ch * dpr);
  }
  const ctx = cv.getContext('2d');
  if (!ctx) return;

  /* Fit on WIDTH, not height, and anchor the ground to the bottom edge.
     Scaling to height meant a phone showed ~340 virtual px of road against a
     desktop's ~800: the same obstacle at the same speed gave a phone player a
     third of the reaction time. Fitting width makes the visible road exactly
     `tune.road` wide everywhere; the zoom then trades road for sprite size and
     pays the difference back in speed, so reaction time is identical on every
     screen (see `tuneFor`). */
  const s = cw / w.tune.road;
  const vw = w.tune.road;
  const vh = ch / s;                     // however much sky this canvas affords
  const GY = vh - 54;                    // the ground line
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cw, ch);

  const shake = w.shake > 0 ? (Math.random() - 0.5) * 7 * w.shake : 0;
  ctx.save();
  ctx.translate(shake, 0);
  ctx.scale(s, s);

  const lod = quality === 'performance' ? 0.45 : quality === 'balanced' ? 0.75 : 1;
  /* w.night runs 0→2. A raised cosine makes 0 and 2 full day, 1 full night, and
     everything between a smooth dusk — the earlier expression evaluated to 1 at
     distance zero, so every run opened at midnight. */
  const night = (1 - Math.cos(Math.PI * w.night)) / 2;

  /* ---- sky: day gradient, then a night wash over the sky only ---- */
  const sky = ctx.createLinearGradient(0, 0, 0, vh);
  sky.addColorStop(0, '#dff1fb');
  sky.addColorStop(1, '#fff4de');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, vw, vh);
  if (night > 0.01) {
    ctx.globalAlpha = night * 0.82;
    ctx.fillStyle = '#2b2a46';
    ctx.fillRect(0, 0, vw, vh);
    ctx.globalAlpha = 1;
  }

  /* ---- sun / moon ---- */
  ctx.beginPath();
  ctx.arc(vw * 0.82, 62, 24, 0, Math.PI * 2);
  ctx.fillStyle = mix('#ffd95a', '#f3efd6', night);
  ctx.fill();

  /* ---- clouds (parallax, cheap) ---- */
  const clouds = Math.round(4 * lod);
  ctx.fillStyle = `rgba(255,255,255,${(0.85 - night * 0.66).toFixed(3)})`;
  for (let i = 0; i < clouds; i++) {
    const cx = ((i * 310 - w.dist * 1.6) % (vw + 260) + vw + 260) % (vw + 260) - 130;
    const cy = 44 + ((i * 53) % 70);
    ctx.beginPath();
    ctx.ellipse(cx, cy, 36, 14, 0, 0, Math.PI * 2);
    ctx.ellipse(cx + 26, cy + 4, 26, 11, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  /* ---- distant hills: always drawn. Gating scenery behind the quality tier
     made the Performance preset look like the art was missing rather than like
     a cheaper frame — four quadratic curves cost nothing. ---- */
  {
    ctx.fillStyle = mix('#cfe9d4', '#3b3758', night);
    const off = (w.dist * 0.35) % 420;
    for (let i = -1; i < vw / 420 + 2; i++) {
      const hx = i * 420 - off;
      ctx.beginPath();
      ctx.moveTo(hx, GY);
      ctx.quadraticCurveTo(hx + 105, GY - 92, hx + 210, GY);
      ctx.fill();
    }
  }

  /* ---- ground ---- */
  ctx.fillStyle = mix('#f6e3c4', '#514766', night);
  ctx.fillRect(0, GY, vw, vh - GY);
  ctx.strokeStyle = mix('#c9a87c', '#8d82a8', night);
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(0, GY + 1.5);
  ctx.lineTo(vw, GY + 1.5);
  ctx.stroke();
  // speckles that scroll, so motion reads even on an empty stretch
  ctx.fillStyle = mix('#e2c59b', '#6d6287', night);
  const stride = 58;
  const soff = w.dist * 10 % stride;
  for (let i = -1; i < vw / stride + 2; i++) {
    const gx = i * stride - soff;
    ctx.fillRect(gx, GY + 14, 22, 3);
    ctx.fillRect(gx + 30, GY + 28, 11, 3);
  }

  /* ---- obstacles ---- */
  for (const o of w.obs) {
    if (o.hit && o.kind === 'charge') continue;
    const bob = o.kind.startsWith('drone') ? Math.sin(w.t * 6 + o.bob) * 5 : 0;
    const yTop = GY - o.base - o.h + bob;
    const im = o.kind === 'charge' ? sp.img.charge
      : o.kind === 'tree' ? sp.img.tree          // the small hop
        : o.kind === 'wall' ? sp.img.wall        // the big one
          : sp.img.drone;
    if (im && im.naturalWidth) {
      // o.w came from the same aspect the file has, so pixels == hitbox
      ctx.drawImage(im, o.x - o.w / 2, yTop, o.w, o.h);
    } else {
      ctx.fillStyle = o.kind === 'charge' ? '#ffd95a' : o.kind.startsWith('drone') ? '#8ec8f6' : '#7fb98a';
      ctx.fillRect(o.x - o.w / 2, yTop, o.w, o.h);
    }
  }

  /* ---- player ---- */
  const runner = sp.img.runner;
  const phH = w.ducking ? DUCK_H : STAND_H;
  const py = GY - w.y - phH;
  if (runner && runner.naturalWidth && sp.runnerFrameW) {
    const fw = sp.runnerFrameW, fh = runner.naturalHeight;
    // airborne shows a single held frame, like the dino's fixed jump pose
    const f = w.airborne ? 0 : Math.floor(w.runFrame) % RUNNER_FRAMES;
    const drawW = (fw / fh) * phH * (w.ducking ? 1.5 : 1);
    ctx.drawImage(runner, f * fw, 0, fw, fh, w.tune.px - drawW / 2, py, drawW, phH);
  } else {
    ctx.fillStyle = '#ffd95a';
    ctx.fillRect(w.tune.px - STAND_W / 2, py, w.ducking ? DUCK_W : STAND_W, phH);
  }

  /* ---- hit flash ---- */
  if (w.flash > 0) {
    ctx.fillStyle = `rgba(242,119,154,${Math.min(0.5, w.flash * 0.5)})`;
    ctx.fillRect(0, 0, vw, vh);
  }

  ctx.restore();

  /* ---- overlay text (unscaled, so it stays crisp) ---- */
  ctx.save();
  ctx.textAlign = 'center';
  ctx.fillStyle = night > 0.5 ? '#fff6e6' : '#5c4035';  // text needs contrast, not a blend
  if (!running && !w.over) {
    ctx.font = '700 17px Quicksand, system-ui, sans-serif';
    ctx.fillText(touch ? 'Tap to run' : 'Press space, or tap, to run', cw / 2, ch / 2 - 6);
    ctx.font = '600 13px Quicksand, system-ui, sans-serif';
    ctx.fillText(touch ? 'Jump and Duck are below' : 'Space / ↑ jumps · ↓ ducks', cw / 2, ch / 2 + 18);
  } else if (paused) {
    ctx.font = '700 19px Quicksand, system-ui, sans-serif';
    ctx.fillText('Paused', cw / 2, ch / 2);
  }
  ctx.restore();
}

/* =================================================================== view */
export default function ArcadeSolo({ game }: { game: GameMeta }) {
  const touch = useTouch();
  const { sfx, finishMatch, settings, progress } = useStore();
  const [pace, setPace] = useState<Pace>('standard');
  const [paused, setPaused] = useState(false);
  const [running, setRunning] = useState(false);
  const [shown, setShown] = useState(false);
  const [hud, setHud] = useState({ score: 0, dist: 0, charges: 0, speed: 1 });

  const cvRef = useRef<HTMLCanvasElement>(null);
  /* The zoom is chosen from the viewport once and re-chosen on rotate, but a
     run in progress keeps the tuning it started with — re-tuning mid-run would
     teleport the obstacles. */
  const [tune, setTune] = useState<Tune>(() => tuneFor(pickZoom(typeof window === 'undefined' ? 1200 : window.innerWidth)));
  const tuneRef = useRef(tune);
  tuneRef.current = tune;
  const w = useRef<World>(newWorld(PACES[pace], tune));
  const raf = useRef(0);
  const last = useRef(0);
  const hudAt = useRef(0);
  /** Cleared on a pace change, set by reset(). The loop reads a ref so it stops
      on the very next frame instead of waiting for React to re-run the effect. */
  const armed = useRef(false);
  const best = progress.stats['arcade']?.best ?? 0;

  const spr = loadSprites();
  const [, setSpriteTick] = useState(0);
  useEffect(() => onSpritesReady(() => setSpriteTick((n) => n + 1)), []);

  /**
   * Whether this run's end has already been dealt with — the score banked and the
   * result offered once. A ref, not `shown`: the card can be dismissed while the
   * run stays over, and re-deriving from `over` would both fight the Close button
   * and bank the same score twice.
   */
  const settled = useRef(false);

  const reset = useCallback(() => {
    w.current = newWorld(PACES[pace], tuneRef.current);
    settled.current = false; armed.current = true;
    setShown(false); setPaused(false); setRunning(true);
    setHud({ score: 0, dist: 0, charges: 0, speed: 1 });
  }, [pace]);

  useEffect(() => {
    w.current = newWorld(PACES[pace], tuneRef.current);
    settled.current = false; armed.current = false;
    setRunning(false); setShown(false);
  }, [pace]);

  /* Rotating the phone changes how much road fits. Re-tune on a real breakpoint
     change only, and only while nothing is running. */
  useEffect(() => {
    const onResize = () => {
      const next = pickZoom(window.innerWidth);
      setTune((cur) => {
        if (cur.m === next) return cur;
        const t = tuneFor(next);
        if (!armed.current) { w.current = newWorld(PACES[pace], t); }
        return t;
      });
    };
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    };
  }, [pace]);

  /* ---------- input ---------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // while the result card is up it owns the keyboard
      if (shown) return;
      const k = e.key;
      if (k === ' ' || k === 'ArrowUp' || k === 'w' || k === 'W') {
        e.preventDefault();
        if (!running) { reset(); return; }
        if (!paused) jump(w.current, sfx);
      } else if (k === 'ArrowDown' || k === 's' || k === 'S') {
        e.preventDefault();
        if (running && !paused && !w.current.over) w.current.ducking = true;
      } else if (k === 'p' || k === 'P' || k === 'Escape') {
        if (running) setPaused((p) => !p);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') w.current.ducking = false;
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);

    /* ---- touch: tap or swipe up to jump, hold a downward swipe to duck ---- */
    const cv = cvRef.current;
    let sx = 0, sy = 0, st = 0, tracking = false, ducked = false;
    const SWIPE = 26;
    const down = (e: PointerEvent) => {
      tracking = true; ducked = false;
      sx = e.clientX; sy = e.clientY; st = performance.now();
      cv?.setPointerCapture?.(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (!tracking) return;
      if (e.clientY - sy > SWIPE && Math.abs(e.clientX - sx) < SWIPE * 1.6) {
        if (running && !paused && !w.current.over) { w.current.ducking = true; ducked = true; }
      }
    };
    const up = (e: PointerEvent) => {
      if (!tracking) return;
      tracking = false;
      w.current.ducking = false;
      const dx = e.clientX - sx, dy = e.clientY - sy;
      const quick = performance.now() - st < 420;
      if (ducked) return;                                   // that gesture was a duck
      if (!running) { reset(); return; }
      if (paused) return;
      if (dy < -SWIPE || (quick && Math.abs(dx) < SWIPE && Math.abs(dy) < SWIPE)) jump(w.current, sfx);
    };
    cv?.addEventListener('pointerdown', down);
    cv?.addEventListener('pointermove', move);
    cv?.addEventListener('pointerup', up);
    cv?.addEventListener('pointercancel', up);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
      cv?.removeEventListener('pointerdown', down);
      cv?.removeEventListener('pointermove', move);
      cv?.removeEventListener('pointerup', up);
      cv?.removeEventListener('pointercancel', up);
    };
  }, [running, paused, shown, reset, sfx]);

  /* ---------- loop ---------- */
  useEffect(() => {
    const frame = (ts: number) => {
      raf.current = requestAnimationFrame(frame);
      if (!last.current) last.current = ts;
      const dt = Math.min(0.05, (ts - last.current) / 1000);
      last.current = ts;
      const wr = w.current;
      // Test seam: the e2e runner bot reads obstacle positions from here to prove
      // the spawn gaps are actually clearable. Just a reference to a live object.
      if (cvRef.current) (cvRef.current as unknown as { __world: World }).__world = wr;
      if (armed.current && running && !paused && !wr.over && !document.hidden) tickWorld(wr, dt, sfx);
      render(cvRef.current, wr, settings.quality, running, paused, spr, touch);
      if (ts - hudAt.current > 120) {
        hudAt.current = ts;
        setHud({
          score: Math.floor(wr.score), dist: Math.floor(wr.dist),
          charges: wr.charges, speed: Math.round((speedOf(wr) / wr.base) * 10) / 10,
        });
        if (wr.over && running) setRunning(false);
      }
    };
    raf.current = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf.current); last.current = 0; };
  }, [running, paused, settings.quality, sfx, spr]);

  useEffect(() => {
    if (!w.current.over || settled.current || running) return;
    settled.current = true;
    setShown(true);
    const score = Math.floor(w.current.score);
    finishMatch({ gameId: 'arcade', mode: 'solo', result: score > best ? 'win' : 'draw', score, meta: { arcadeScore: score } });
  }, [running, best, finishMatch]);

  const nudge = (down: boolean) => {
    if (running && !paused && !w.current.over) w.current.ducking = down;
  };

  return (
    <SoloShell game={game} wide
      mascot={w.current.over ? (hud.score > best ? 'victory' : 'defeated') : paused ? 'waiting' : running ? 'competitive' : 'idle'}
      mascotLine={!running && !shown ? (touch ? 'Tap to run. Jump over the trees and bales, duck under the storm clouds — one bump and the run is over.' : 'Press space to run. Space or up jumps, down ducks — one bump and the run is over.')
        : paused ? 'Paused — the meadow waits.'
        : w.current.over ? 'Caught! Run it back.'
        : hud.dist > 1200 ? 'Storm clouds out. Duck the low ones.'
        : 'Hop the blossom trees and hay bales.'}
      onRestart={reset}
      controls={
        <div className="flex items-center gap-2 flex-wrap">
          <span className="eyebrow">Pace</span>
          <Segmented value={pace} onChange={(v) => setPace(v as Pace)} size="sm" label="Pace"
            options={[{ value: 'chill', label: 'Chill' }, { value: 'standard', label: 'Standard' }, { value: 'frantic', label: 'Frantic' }]} />
          <Button size="sm" variant={running ? 'ghost' : 'primary'} onClick={() => (running ? setPaused((p) => !p) : reset())}
            icon={<Icon name={running && !paused ? 'pause' : 'play'} size={13} />}>
            {!running ? 'Launch' : paused ? 'Resume' : 'Pause'}
          </Button>
        </div>
      }
      hud={
        <Panel className="p-2 sm:p-3 flex items-center gap-2 sm:gap-3 flex-wrap justify-center">
          <Stat label="Score" value={hud.score.toLocaleString()} accent="#ffcb05" />
          <Stat label="Best" value={best.toLocaleString()} />
          {/* The HUD is a no-wrap scroll strip on mobile, so a phone only gets
              what it can show without a hidden scroll: score, the best to beat,
              and the charge count. Distance is near-identical to score
              (score = distance + 25 per charge) and speed is decorative, so
              those two are the ones that yield. */}
          <div className="hidden sm:block"><Stat label="Distance" value={`${hud.dist} m`} /></div>
          <Stat label="Charges" value={hud.charges} accent="#5fd28a" />
          <div className="hidden sm:block"><Stat label="Speed" value={`${hud.speed}x`} accent="#ef4b35" /></div>
        </Panel>
      }
      footer={
        <div className="flex gap-2 justify-center sm:hidden">
          <button className="px-8 py-3 panel text-cream-100 no-tap active:bg-volt-400 active:text-[#5a3a12]" aria-label="Jump"
            onClick={() => { if (!running) reset(); else jump(w.current, sfx); }}><Icon name="chevron-up" size={20} /></button>
          <button className="px-8 py-3 panel text-cream-100 no-tap active:bg-volt-400 active:text-[#5a3a12]" aria-label="Duck"
            onPointerDown={() => nudge(true)} onPointerUp={() => nudge(false)} onPointerLeave={() => nudge(false)}>
            <Icon name="chevron-down" size={20} /></button>
        </div>
      }>
      <div className="relative w-full flex justify-center">
        <div className="panel panel-notch p-2.5">
          <canvas ref={cvRef} style={{ aspectRatio: `${tune.road} / ${tune.vh}` }}
            className="block w-[min(90vw,820px)] max-h-[58vh] no-tap touch-none select-none"
            role="img"
            aria-label={`Volt Runner. Score ${hud.score}, ${hud.dist} metres. Space or up arrow to jump over trees and hay bales, down arrow to duck under storm clouds, tap to jump on a touchscreen.`} />
        </div>
        {shown && (
          <ResultOverlay verdict={hud.score > best ? 'win' : 'loss'}
            reason={hud.score > best ? 'New personal best!' : 'Caught on the road'}
            playerA={{ name: 'This run', score: hud.score.toLocaleString(), you: true }}
            playerB={{ name: 'Best', score: Math.max(best, hud.score).toLocaleString() }}
            rows={[{ label: 'Distance', a: `${hud.dist} m`, b: '' }, { label: 'Charges', a: hud.charges, b: '' }]}
            onRematch={reset} rematchLabel="Run again" onExit={() => setShown(false)} exitLabel="Close" />
        )}
      </div>
    </SoloShell>
  );
}
