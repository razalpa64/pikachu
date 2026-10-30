/**
 * How carrom looks.
 *
 * Drawn in code rather than shipped as a picture, for two reasons: the board has
 * to be sharp at any size on any screen, and the pieces have to move. Everything
 * here is deterministic — the wood grain comes from a seeded generator, so the
 * board does not shimmer between frames.
 */
import { BOARD, COIN_R, POCKETS, POCKET_R, STRIKER_R } from './physics';
import type { CoinKind } from './physics';
import { rng } from '../types';

const INK = '#8c2f22';

export interface PaintSize { size: number; frame: number; scale: number; origin: number }

export function layout(size: number): PaintSize {
  const frame = Math.max(10, size * 0.052);
  const inner = size - frame * 2;
  return { size, frame, scale: inner / BOARD, origin: frame };
}

const px = (l: PaintSize, v: number) => l.origin + v * l.scale;

/** A carved wooden frame, then the pale playing surface inside it. */
export function paintBoard(ctx: CanvasRenderingContext2D, l: PaintSize) {
  const { size, frame } = l;
  const random = rng(20261030);

  // frame
  const wood = ctx.createLinearGradient(0, 0, size, size);
  wood.addColorStop(0, '#a9722f');
  wood.addColorStop(0.35, '#c08a45');
  wood.addColorStop(0.62, '#9c6526');
  wood.addColorStop(1, '#7d4d1c');
  ctx.fillStyle = wood;
  ctx.fillRect(0, 0, size, size);

  // grain, drawn once per call but stable because the generator is seeded
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, size, size);
  ctx.clip();
  for (let i = 0; i < 90; i++) {
    const y = random() * size;
    const alpha = 0.03 + random() * 0.05;
    ctx.strokeStyle = `rgba(60,32,8,${alpha})`;
    ctx.lineWidth = 0.6 + random() * 1.4;
    ctx.beginPath();
    ctx.moveTo(0, y);
    for (let x = 0; x <= size; x += size / 8) {
      ctx.lineTo(x, y + Math.sin((x / size) * 6 + i) * (1.2 + random() * 2.4));
    }
    ctx.stroke();
  }
  ctx.restore();

  // inner bevel
  const bevel = ctx.createLinearGradient(0, 0, 0, size);
  bevel.addColorStop(0, 'rgba(255,240,210,.45)');
  bevel.addColorStop(0.06, 'rgba(255,240,210,0)');
  bevel.addColorStop(0.95, 'rgba(60,30,5,.18)');
  bevel.addColorStop(1, 'rgba(60,30,5,.3)');
  ctx.fillStyle = bevel;
  ctx.fillRect(0, 0, size, size);

  // playing surface
  const pad = frame;
  const surface = ctx.createRadialGradient(size * 0.44, size * 0.38, size * 0.08, size / 2, size / 2, size * 0.62);
  surface.addColorStop(0, '#fbeccd');
  surface.addColorStop(0.55, '#f2dcb1');
  surface.addColorStop(1, '#dfc090');
  ctx.fillStyle = surface;
  ctx.fillRect(pad, pad, size - pad * 2, size - pad * 2);

  // surface grain, finer than the frame
  ctx.save();
  ctx.beginPath();
  ctx.rect(pad, pad, size - pad * 2, size - pad * 2);
  ctx.clip();
  for (let i = 0; i < 60; i++) {
    const y = pad + random() * (size - pad * 2);
    ctx.strokeStyle = `rgba(150,105,55,${0.02 + random() * 0.035})`;
    ctx.lineWidth = 0.5 + random();
    ctx.beginPath();
    ctx.moveTo(pad, y);
    for (let x = pad; x <= size - pad; x += (size - pad * 2) / 7) {
      ctx.lineTo(x, y + Math.sin((x / size) * 4.5 + i * 0.7) * 1.6);
    }
    ctx.stroke();
  }
  ctx.restore();

  paintMarkings(ctx, l);

  // a soft vignette so the middle of the board reads as lit
  const vignette = ctx.createRadialGradient(size / 2, size / 2, size * 0.2, size / 2, size / 2, size * 0.72);
  vignette.addColorStop(0, 'rgba(255,255,255,0)');
  vignette.addColorStop(1, 'rgba(120,80,30,.14)');
  ctx.fillStyle = vignette;
  ctx.fillRect(pad, pad, size - pad * 2, size - pad * 2);

  for (const p of POCKETS) paintPocket(ctx, l, p.x, p.y);
}

/** The painted furniture: centre rosette, baselines, corner arrows. */
function paintMarkings(ctx: CanvasRenderingContext2D, l: PaintSize) {
  const cx = px(l, 50), cy = px(l, 50);
  const r = 13 * l.scale;

  ctx.save();
  ctx.strokeStyle = INK;
  ctx.fillStyle = INK;
  ctx.lineWidth = Math.max(1, l.scale * 0.42);

  // outer circle and inner circle
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.arc(cx, cy, r * 0.62, 0, Math.PI * 2); ctx.stroke();
  // eight petals
  for (let i = 0; i < 8; i++) {
    const a = (Math.PI / 4) * i;
    ctx.beginPath();
    ctx.ellipse(cx + Math.cos(a) * r * 0.31, cy + Math.sin(a) * r * 0.31, r * 0.12, r * 0.055, a, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.beginPath(); ctx.arc(cx, cy, r * 0.1, 0, Math.PI * 2); ctx.fill();

  // baselines, one per player
  for (const y of [18, 82]) {
    const y0 = px(l, y), x0 = px(l, 20), x1 = px(l, 80);
    ctx.lineWidth = Math.max(1, l.scale * 0.34);
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y0); ctx.stroke();
    for (const cx2 of [20, 80]) {
      ctx.beginPath(); ctx.arc(px(l, cx2), y0, l.scale * 2.4, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(px(l, cx2), y0, l.scale * 0.9, 0, Math.PI * 2); ctx.fill();
    }
    // the little dots that mark the striker's allowed span
    for (let i = 1; i <= 6; i++) {
      if (i === 3 || i === 6) continue;
      ctx.beginPath(); ctx.arc(px(l, 20 + (60 / 7) * i), y0, l.scale * 0.55, 0, Math.PI * 2); ctx.fill();
    }
  }

  // corner arrows pointing at the centre, the way a real board paints them
  for (const [ax, ay, sx, sy] of [[1, 1, -1, -1], [-1, 1, 1, -1], [1, -1, -1, 1], [-1, -1, 1, 1]] as const) {
    const from = { x: px(l, ax > 0 ? 13 : 87), y: px(l, ay > 0 ? 13 : 87) };
    const to = { x: px(l, ax > 0 ? 34 : 66), y: px(l, ay > 0 ? 34 : 66) };
    ctx.lineWidth = Math.max(1, l.scale * 0.3);
    ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.lineTo(to.x, to.y); ctx.stroke();
    const angle = Math.atan2(to.y - from.y, to.x - from.x);
    const head = l.scale * 2.4;
    ctx.beginPath();
    ctx.moveTo(to.x, to.y);
    ctx.lineTo(to.x - Math.cos(angle - 0.4) * head, to.y - Math.sin(angle - 0.4) * head);
    ctx.lineTo(to.x - Math.cos(angle + 0.4) * head, to.y - Math.sin(angle + 0.4) * head);
    ctx.closePath(); ctx.fill();
    void sx; void sy;
  }
  ctx.restore();
}

function paintPocket(ctx: CanvasRenderingContext2D, l: PaintSize, x: number, y: number) {
  const cxp = px(l, x), cyp = px(l, y);
  const r = POCKET_R * l.scale;
  // rim
  const rim = ctx.createRadialGradient(cxp, cyp, r * 0.6, cxp, cyp, r * 1.15);
  rim.addColorStop(0, 'rgba(70,40,12,.35)');
  rim.addColorStop(1, 'rgba(70,40,12,0)');
  ctx.fillStyle = rim;
  ctx.beginPath(); ctx.arc(cxp, cyp, r * 1.15, 0, Math.PI * 2); ctx.fill();
  // hole
  const hole = ctx.createRadialGradient(cxp - r * 0.25, cyp - r * 0.25, r * 0.1, cxp, cyp, r);
  hole.addColorStop(0, '#2a1a0d');
  hole.addColorStop(0.55, '#160d06');
  hole.addColorStop(1, '#000000');
  ctx.fillStyle = hole;
  ctx.beginPath(); ctx.arc(cxp, cyp, r, 0, Math.PI * 2); ctx.fill();
  // brass ring
  ctx.strokeStyle = 'rgba(214,170,96,.55)';
  ctx.lineWidth = Math.max(1, l.scale * 0.3);
  ctx.beginPath(); ctx.arc(cxp, cyp, r * 1.02, Math.PI * 0.1, Math.PI * 0.9); ctx.stroke();
}

const COIN_STYLE: Record<CoinKind, { face: [string, string, string]; rim: string; edge: string; gloss: number }> = {
  white: { face: ['#fffdf4', '#f6e6c6', '#dcbc8c'], rim: '#c39a63', edge: '#a97f4a', gloss: 0.55 },
  black: { face: ['#6a5b50', '#3b3029', '#1d1512'], rim: '#120c09', edge: '#87705c', gloss: 0.42 },
  queen: { face: ['#e4574f', '#b8232f', '#7d141f'], rim: '#6d0f18', edge: '#f0c169', gloss: 0.6 },
};

export function paintCoin(ctx: CanvasRenderingContext2D, l: PaintSize, c: { x: number; y: number; kind: CoinKind }, lift = 0) {
  const x = px(l, c.x), y = px(l, c.y);
  const r = COIN_R * l.scale;
  const style = COIN_STYLE[c.kind];
  const oy = -lift * r * 0.35;

  // shadow
  ctx.save();
  const shadow = ctx.createRadialGradient(x + r * 0.15, y + r * 0.35 + lift * r * 0.2, r * 0.2, x + r * 0.1, y + r * 0.3, r * 1.25);
  shadow.addColorStop(0, 'rgba(64,38,10,.34)');
  shadow.addColorStop(1, 'rgba(64,38,10,0)');
  ctx.fillStyle = shadow;
  ctx.beginPath(); ctx.ellipse(x + r * 0.06, y + r * 0.18, r * 1.15, r * 0.95, 0, 0, Math.PI * 2); ctx.fill();
  ctx.restore();

  // body
  const body = ctx.createRadialGradient(x - r * 0.35, y - r * 0.45 + oy, r * 0.15, x, y + oy, r * 1.05);
  body.addColorStop(0, style.face[0]);
  body.addColorStop(0.55, style.face[1]);
  body.addColorStop(1, style.face[2]);
  ctx.fillStyle = body;
  ctx.beginPath(); ctx.arc(x, y + oy, r, 0, Math.PI * 2); ctx.fill();

  // rim
  ctx.strokeStyle = style.rim;
  ctx.lineWidth = Math.max(0.8, r * 0.14);
  ctx.beginPath(); ctx.arc(x, y + oy, r * 0.94, 0, Math.PI * 2); ctx.stroke();

  // inner ring, and the queen's crown of eight dots
  ctx.strokeStyle = c.kind === 'queen' ? style.edge : 'rgba(255,255,255,.35)';
  ctx.lineWidth = Math.max(0.6, r * 0.08);
  ctx.beginPath(); ctx.arc(x, y + oy, r * 0.62, 0, Math.PI * 2); ctx.stroke();
  if (c.kind === 'queen') {
    ctx.fillStyle = style.edge;
    for (let i = 0; i < 8; i++) {
      const a = (Math.PI / 4) * i;
      ctx.beginPath();
      ctx.arc(x + Math.cos(a) * r * 0.62, y + oy + Math.sin(a) * r * 0.62, r * 0.07, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // gloss
  const gloss = ctx.createRadialGradient(x - r * 0.38, y - r * 0.5 + oy, 0, x - r * 0.38, y - r * 0.5 + oy, r * 0.85);
  gloss.addColorStop(0, `rgba(255,255,255,${style.gloss})`);
  gloss.addColorStop(0.45, 'rgba(255,255,255,.08)');
  gloss.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gloss;
  ctx.beginPath(); ctx.arc(x, y + oy, r, 0, Math.PI * 2); ctx.fill();
}

export function paintStriker(ctx: CanvasRenderingContext2D, l: PaintSize, x: number, y: number, glow = 0) {
  const cxp = px(l, x), cyp = px(l, y);
  const r = STRIKER_R * l.scale;

  if (glow > 0) {
    ctx.save();
    ctx.globalAlpha = glow;
    const halo = ctx.createRadialGradient(cxp, cyp, r * 0.6, cxp, cyp, r * 2.6);
    halo.addColorStop(0, 'rgba(255,214,102,.55)');
    halo.addColorStop(1, 'rgba(255,214,102,0)');
    ctx.fillStyle = halo;
    ctx.beginPath(); ctx.arc(cxp, cyp, r * 2.6, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  ctx.save();
  const shadow = ctx.createRadialGradient(cxp + r * 0.2, cyp + r * 0.35, r * 0.2, cxp, cyp, r * 1.3);
  shadow.addColorStop(0, 'rgba(64,38,10,.4)');
  shadow.addColorStop(1, 'rgba(64,38,10,0)');
  ctx.fillStyle = shadow;
  ctx.beginPath(); ctx.ellipse(cxp + r * 0.08, cyp + r * 0.22, r * 1.2, r * 1, 0, 0, Math.PI * 2); ctx.fill();
  ctx.restore();

  const body = ctx.createRadialGradient(cxp - r * 0.4, cyp - r * 0.5, r * 0.12, cxp, cyp, r * 1.05);
  body.addColorStop(0, '#ffffff');
  body.addColorStop(0.5, '#eef4fb');
  body.addColorStop(1, '#b9cfe4');
  ctx.fillStyle = body;
  ctx.beginPath(); ctx.arc(cxp, cyp, r, 0, Math.PI * 2); ctx.fill();

  ctx.strokeStyle = '#7fa3c4';
  ctx.lineWidth = Math.max(0.8, r * 0.16);
  ctx.beginPath(); ctx.arc(cxp, cyp, r * 0.9, 0, Math.PI * 2); ctx.stroke();

  const ring = ctx.createLinearGradient(cxp - r, cyp - r, cxp + r, cyp + r);
  ring.addColorStop(0, '#ff8a5c');
  ring.addColorStop(0.5, '#e2452f');
  ring.addColorStop(1, '#a5241a');
  ctx.strokeStyle = ring;
  ctx.lineWidth = Math.max(1, r * 0.34);
  ctx.beginPath(); ctx.arc(cxp, cyp, r * 0.6, 0, Math.PI * 2); ctx.stroke();

  const gloss = ctx.createRadialGradient(cxp - r * 0.42, cyp - r * 0.52, 0, cxp - r * 0.42, cyp - r * 0.52, r * 0.8);
  gloss.addColorStop(0, 'rgba(255,255,255,.95)');
  gloss.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gloss;
  ctx.beginPath(); ctx.arc(cxp, cyp, r, 0, Math.PI * 2); ctx.fill();
}

/** The aiming guide: a dashed line, a glow where it will go, and a power ring. */
export function paintAim(ctx: CanvasRenderingContext2D, l: PaintSize, from: { x: number; y: number }, angle: number, power: number) {
  const x0 = px(l, from.x), y0 = px(l, from.y);
  const len = (18 + power * 74) * l.scale;
  const x1 = x0 + Math.cos(angle) * len;
  const y1 = y0 + Math.sin(angle) * len;

  ctx.save();
  const grad = ctx.createLinearGradient(x0, y0, x1, y1);
  grad.addColorStop(0, `rgba(214,60,40,${0.25 + power * 0.5})`);
  grad.addColorStop(1, 'rgba(214,60,40,0.08)');
  ctx.strokeStyle = grad;
  ctx.lineWidth = Math.max(2, l.scale * 0.7);
  ctx.setLineDash([l.scale * 2.2, l.scale * 1.8]);
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = `rgba(214,60,40,${0.15 + power * 0.25})`;
  ctx.beginPath(); ctx.arc(x1, y1, STRIKER_R * l.scale * 0.9, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}
