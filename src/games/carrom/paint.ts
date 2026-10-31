/**
 * How carrom looks.
 *
 * Drawn in code rather than shipped as a picture, for two reasons: the board has
 * to be sharp at any size on any screen, and the pieces have to move. Everything
 * here is deterministic — the wood grain comes from a seeded generator, so the
 * board does not shimmer between frames.
 *
 * The table itself is *painted once* into an offscreen canvas (`buildBoard`) and
 * blitted every frame. That is what buys the detail: a carved frame with mitred
 * corners and brass pins, three layers of grain, a lit surface, recessed pockets
 * with copper rims and a warm pool of lamplight over the middle all cost nothing
 * while nineteen coins are rolling around on top of them.
 */
import { BOARD, COIN_R, POCKETS, POCKET_R, STRIKER_R } from './physics';
import type { CoinKind } from './physics';
import { rng } from '../types';

const INK = '#8c2f22';
const INK_SOFT = 'rgba(140,47,34,.55)';

export interface PaintSize { size: number; frame: number; scale: number; origin: number }

export function layout(size: number): PaintSize {
  /* A real carrom board's rail is about a tenth of its width; a hairline frame
     reads as a printed sheet, not a piece of furniture. */
  const frame = Math.max(14, size * 0.085);
  const inner = size - frame * 2;
  return { size, frame, scale: inner / BOARD, origin: frame };
}

const px = (l: PaintSize, v: number) => l.origin + v * l.scale;

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rad = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

/* ------------------------------------------------------------------ the table */

/**
 * The whole static table, painted once at the device's resolution. The caller
 * keeps the canvas and blits it; nothing in here is cheap enough to run at 60 fps.
 */
export function buildBoard(size: number, dpr = 1): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(size * dpr);
  canvas.height = Math.round(size * dpr);
  const ctx = canvas.getContext('2d')!;
  ctx.scale(dpr, dpr);
  paintBoard(ctx, layout(size));
  return canvas;
}

/** A carved wooden frame, then the pale playing surface inside it. */
export function paintBoard(ctx: CanvasRenderingContext2D, l: PaintSize) {
  const { size, frame } = l;
  const random = rng(20261030);
  const pad = frame;
  const inner = size - pad * 2;
  const radius = size * 0.022;

  /* --- the table under the board -------------------------------------- */
  const table = ctx.createRadialGradient(size * 0.46, size * 0.38, size * 0.05, size * 0.5, size * 0.5, size * 0.8);
  table.addColorStop(0, '#5d3a18');
  table.addColorStop(0.6, '#40260f');
  table.addColorStop(1, '#2a1808');
  ctx.fillStyle = table;
  ctx.fillRect(0, 0, size, size);

  /* --- the frame: a lit top edge, a dark base, mitred corners ---------- */
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,.55)';
  ctx.shadowBlur = size * 0.03;
  ctx.shadowOffsetY = size * 0.008;
  roundRect(ctx, pad * 0.35, pad * 0.35, size - pad * 0.7, size - pad * 0.7, radius);
  const wood = ctx.createLinearGradient(0, 0, size * 0.85, size);
  wood.addColorStop(0, '#c99456');
  wood.addColorStop(0.18, '#a9722f');
  wood.addColorStop(0.42, '#8a5620');
  wood.addColorStop(0.7, '#a5712c');
  wood.addColorStop(1, '#6f451a');
  ctx.fillStyle = wood;
  ctx.fill();
  ctx.restore();

  // grain on the frame — three passes of different weight, like real veneer
  ctx.save();
  roundRect(ctx, pad * 0.35, pad * 0.35, size - pad * 0.7, size - pad * 0.7, radius);
  ctx.clip();
  for (let i = 0; i < 130; i++) {
    const y = random() * size;
    ctx.strokeStyle = `rgba(60,32,8,${0.02 + random() * 0.045})`;
    ctx.lineWidth = 0.5 + random() * 1.8;
    ctx.beginPath();
    ctx.moveTo(0, y);
    for (let x = 0; x <= size; x += size / 9) ctx.lineTo(x, y + Math.sin((x / size) * 6 + i * 0.8) * (1 + random() * 2.6));
    ctx.stroke();
  }
  // figure: a few wide, pale bands the way a cut board catches light
  for (let i = 0; i < 5; i++) {
    const y = random() * size;
    const g = ctx.createLinearGradient(0, y - size * 0.06, 0, y + size * 0.06);
    g.addColorStop(0, 'rgba(255,220,160,0)');
    g.addColorStop(0.5, `rgba(255,220,160,${0.05 + random() * 0.05})`);
    g.addColorStop(1, 'rgba(255,220,160,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, y - size * 0.06, size, size * 0.12);
  }
  ctx.restore();

  // mitred corner seams, so the frame reads as four pieces of wood
  ctx.save();
  ctx.strokeStyle = 'rgba(52,28,6,.45)';
  ctx.lineWidth = Math.max(1, size * 0.0035);
  for (const [sx, sy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]] as const) {
    const x0 = sx > 0 ? pad * 0.35 : size - pad * 0.35;
    const y0 = sy > 0 ? pad * 0.35 : size - pad * 0.35;
    ctx.beginPath();
    ctx.moveTo(x0 - sx * pad * 0.34, y0);
    ctx.lineTo(x0, y0);
    ctx.lineTo(x0, y0 - sy * pad * 0.34);
    ctx.stroke();
  }
  ctx.restore();

  // brass pins at the corners
  for (const [cx, cy] of [[pad * 0.72, pad * 0.72], [size - pad * 0.72, pad * 0.72], [pad * 0.72, size - pad * 0.72], [size - pad * 0.72, size - pad * 0.72]]) {
    const r = size * 0.006;
    const pin = ctx.createRadialGradient(cx - r * 0.4, cy - r * 0.4, 0, cx, cy, r);
    pin.addColorStop(0, '#fff0cc');
    pin.addColorStop(0.5, '#d9ab5f');
    pin.addColorStop(1, '#7d5220');
    ctx.fillStyle = pin;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(40,22,4,.5)';
    ctx.lineWidth = Math.max(0.5, r * 0.25);
    ctx.stroke();
  }

  /* --- the rail: a bevel from frame to surface ------------------------- */
  ctx.save();
  const bevel = ctx.createLinearGradient(0, pad * 0.6, 0, pad * 2.1);
  bevel.addColorStop(0, 'rgba(255,226,168,.55)');
  bevel.addColorStop(0.4, 'rgba(146,88,26,.26)');
  bevel.addColorStop(1, 'rgba(58,30,8,.34)');
  roundRect(ctx, pad * 0.62, pad * 0.62, size - pad * 1.24, size - pad * 1.24, radius * 0.9);
  ctx.fillStyle = bevel;
  ctx.fill();
  ctx.restore();

  /* --- the playing surface -------------------------------------------- */
  const surface = ctx.createRadialGradient(size * 0.42, size * 0.34, size * 0.06, size / 2, size / 2, size * 0.66);
  surface.addColorStop(0, '#fdf3d9');
  surface.addColorStop(0.45, '#f7e5c0');
  surface.addColorStop(0.78, '#eed6a9');
  surface.addColorStop(1, '#dcbb87');
  ctx.fillStyle = surface;
  ctx.fillRect(pad, pad, inner, inner);

  ctx.save();
  ctx.beginPath();
  ctx.rect(pad, pad, inner, inner);
  ctx.clip();

  // fine grain across the surface
  for (let i = 0; i < 70; i++) {
    const y = pad + random() * inner;
    ctx.strokeStyle = `rgba(150,105,55,${0.008 + random() * 0.016})`;
    ctx.lineWidth = 0.4 + random() * 0.7;
    ctx.beginPath();
    ctx.moveTo(pad, y);
    for (let x = pad; x <= size - pad; x += inner / 7) ctx.lineTo(x, y + Math.sin((x / size) * 4.5 + i * 0.7) * 1.6);
    ctx.stroke();
  }

  // a pool of lamplight over the middle, falling off to the rails
  const lamp = ctx.createRadialGradient(size * 0.47, size * 0.4, size * 0.02, size * 0.5, size * 0.5, size * 0.5);
  lamp.addColorStop(0, 'rgba(255,250,232,.34)');
  lamp.addColorStop(0.45, 'rgba(255,246,222,.12)');
  lamp.addColorStop(1, 'rgba(255,240,210,0)');
  ctx.fillStyle = lamp;
  ctx.fillRect(pad, pad, inner, inner);

  // inner shadow where the rail meets the board
  const edge = ctx.createLinearGradient(0, pad, 0, pad + size * 0.05);
  edge.addColorStop(0, 'rgba(90,55,18,.28)');
  edge.addColorStop(1, 'rgba(90,55,18,0)');
  ctx.fillStyle = edge;
  ctx.fillRect(pad, pad, inner, size * 0.05);
  const edgeTop = ctx.createLinearGradient(pad, 0, pad + size * 0.05, 0);
  edgeTop.addColorStop(0, 'rgba(90,55,18,.22)');
  edgeTop.addColorStop(1, 'rgba(90,55,18,0)');
  ctx.fillStyle = edgeTop;
  ctx.fillRect(pad, pad, size * 0.05, inner);

  // a break in the light, so the board does not look like a flat gradient
  const shade = ctx.createRadialGradient(size * 0.72, size * 0.74, size * 0.04, size * 0.7, size * 0.72, size * 0.44);
  shade.addColorStop(0, 'rgba(120,78,30,.14)');
  shade.addColorStop(1, 'rgba(120,78,30,0)');
  ctx.fillStyle = shade;
  ctx.fillRect(pad, pad, inner, inner);
  ctx.restore();

  /* The rule a real board has: a pair of fine red lines inside the rail, with
     the corner squares left for the pockets. It is the difference between a
     sheet of pale wood and a carrom board. */
  const inset = l.scale * 2.4;
  const inner2 = size - pad * 2;
  ctx.save();
  ctx.strokeStyle = 'rgba(140,47,34,.5)';
  ctx.lineWidth = Math.max(1, l.scale * 0.28);
  ctx.strokeRect(pad + inset, pad + inset, inner2 - inset * 2, inner2 - inset * 2);
  ctx.strokeStyle = 'rgba(140,47,34,.22)';
  ctx.lineWidth = Math.max(0.7, l.scale * 0.16);
  ctx.strokeRect(pad + inset * 1.9, pad + inset * 1.9, inner2 - inset * 3.8, inner2 - inset * 3.8);
  ctx.restore();

  paintMarkings(ctx, l);

  // the vignette sits over the paint, the way the rail shadows it
  const vignette = ctx.createRadialGradient(size / 2, size / 2, size * 0.24, size / 2, size / 2, size * 0.74);
  vignette.addColorStop(0, 'rgba(255,255,255,0)');
  vignette.addColorStop(1, 'rgba(110,70,26,.2)');
  ctx.fillStyle = vignette;
  ctx.fillRect(pad, pad, inner, inner);

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
  // eight petals, each with a lighter core so they read as painted, not printed
  for (let i = 0; i < 8; i++) {
    const a = (Math.PI / 4) * i;
    ctx.beginPath();
    ctx.ellipse(cx + Math.cos(a) * r * 0.31, cy + Math.sin(a) * r * 0.31, r * 0.12, r * 0.055, a, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.beginPath(); ctx.arc(cx, cy, r * 0.1, 0, Math.PI * 2); ctx.fill();

  // a fine outer ring, the second circle a real board has
  ctx.strokeStyle = INK_SOFT;
  ctx.lineWidth = Math.max(0.6, l.scale * 0.2);
  ctx.beginPath(); ctx.arc(cx, cy, r * 1.12, 0, Math.PI * 2); ctx.stroke();

  // baselines, one per player
  for (const y of [18, 82]) {
    const y0 = px(l, y), x0 = px(l, 20), x1 = px(l, 80);
    ctx.strokeStyle = INK;
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
  for (const [ax, ay] of [[1, 1], [-1, 1], [1, -1], [-1, -1]] as const) {
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
  }
  ctx.restore();
}

/** A pocket: a recessed hole with a copper rim and a dark lip. */
function paintPocket(ctx: CanvasRenderingContext2D, l: PaintSize, x: number, y: number) {
  const cxp = px(l, x), cyp = px(l, y);
  const r = POCKET_R * l.scale;

  /* The wood around the hole is polished by a century of thumbs. Drawn before
     the mouth, so it darkens the surface rather than greying the hole. */
  const worn = ctx.createRadialGradient(cxp, cyp, r * 0.9, cxp, cyp, r * 1.9);
  worn.addColorStop(0, 'rgba(255,246,220,.3)');
  worn.addColorStop(1, 'rgba(255,246,220,0)');
  ctx.fillStyle = worn;
  ctx.beginPath(); ctx.arc(cxp, cyp, r * 1.9, 0, Math.PI * 2); ctx.fill();

  /* The rail is cut away at each corner to make the pocket's mouth. Without it
     the hole sits on the rail's edge like a sticker; with it the corner reads as
     a corner somebody made a hole in — and it is warm dark wood, never grey. */
  ctx.save();
  const mouth = ctx.createRadialGradient(cxp, cyp, r * 0.95, cxp, cyp, r * 1.4);
  mouth.addColorStop(0, 'rgba(26,14,6,.95)');
  mouth.addColorStop(0.6, 'rgba(38,22,9,.8)');
  mouth.addColorStop(1, 'rgba(50,30,12,0)');
  ctx.fillStyle = mouth;
  ctx.beginPath(); ctx.arc(cxp, cyp, r * 1.4, 0, Math.PI * 2); ctx.fill();
  ctx.restore();

  // shadow cast into the hole
  const rim = ctx.createRadialGradient(cxp, cyp, r * 0.55, cxp, cyp, r * 1.25);
  rim.addColorStop(0, 'rgba(50,28,8,.5)');
  rim.addColorStop(1, 'rgba(50,28,8,0)');
  ctx.fillStyle = rim;
  ctx.beginPath(); ctx.arc(cxp, cyp, r * 1.25, 0, Math.PI * 2); ctx.fill();

  // the hole itself, darker at the bottom so it has depth
  const hole = ctx.createRadialGradient(cxp - r * 0.2, cyp - r * 0.3, r * 0.05, cxp, cyp + r * 0.1, r * 1.02);
  hole.addColorStop(0, '#3a2513');
  hole.addColorStop(0.45, '#1c1008');
  hole.addColorStop(1, '#050302');
  ctx.fillStyle = hole;
  ctx.beginPath(); ctx.arc(cxp, cyp, r, 0, Math.PI * 2); ctx.fill();

  // copper rim: bright on the lit side, dim on the other
  ctx.lineWidth = Math.max(1, r * 0.11);
  const brass = ctx.createLinearGradient(cxp - r, cyp - r, cxp + r, cyp + r);
  brass.addColorStop(0, '#ffe7ae');
  brass.addColorStop(0.35, '#d9a961');
  brass.addColorStop(0.7, '#8a5c22');
  brass.addColorStop(1, '#c79a55');
  ctx.strokeStyle = brass;
  ctx.beginPath(); ctx.arc(cxp, cyp, r * 1.02, 0, Math.PI * 2); ctx.stroke();

  // and a soft inner lip of light on the lit side
  ctx.strokeStyle = 'rgba(255,236,190,.4)';
  ctx.lineWidth = Math.max(0.6, r * 0.05);
  ctx.beginPath(); ctx.arc(cxp, cyp, r * 0.88, Math.PI * 1.05, Math.PI * 1.85); ctx.stroke();
}

/* ------------------------------------------------------------------ pieces */

const COIN_STYLE: Record<CoinKind, { face: [string, string, string]; rim: string; edge: string; gloss: number; grain: string }> = {
  white: { face: ['#fffdf6', '#f8e9cb', '#d9b784'], rim: '#c49a63', edge: '#a97f4a', gloss: 0.7, grain: 'rgba(150,110,60,.10)' },
  black: { face: ['#7c6a5c', '#443830', '#1b1411'], rim: '#0f0a08', edge: '#8d7660', gloss: 0.5, grain: 'rgba(255,235,205,.06)' },
  queen: { face: ['#f0665c', '#bf2733', '#740f1c'], rim: '#5d0b14', edge: '#f3c76d', gloss: 0.72, grain: 'rgba(255,230,190,.08)' },
};

/**
 * One coin.
 *
 * Three things make a disc read as a piece of turned wood rather than a circle:
 * a contact shadow that is soft where the piece is thick and hard where it
 * meets the board, a rim that catches the light on one side only, and a
 * highlight that slides across the face as a real polish does. The queen gets
 * her crown of eight dots.
 */
export function paintCoin(ctx: CanvasRenderingContext2D, l: PaintSize, c: { x: number; y: number; kind: CoinKind }, lift = 0) {
  const x = px(l, c.x), y = px(l, c.y);
  const r = COIN_R * l.scale;
  const style = COIN_STYLE[c.kind];
  const oy = -lift * r * 0.35;

  // contact shadow — tight and dark at rest, wide and soft in the air
  ctx.save();
  const spread = 1 + lift * 0.5;
  const shadow = ctx.createRadialGradient(x + r * 0.18, y + r * 0.3, r * 0.15, x + r * 0.12, y + r * 0.26, r * 1.15 * spread);
  shadow.addColorStop(0, `rgba(58,34,8,${0.42 - lift * 0.16})`);
  shadow.addColorStop(0.6, `rgba(58,34,8,${0.16 - lift * 0.06})`);
  shadow.addColorStop(1, 'rgba(58,34,8,0)');
  ctx.fillStyle = shadow;
  ctx.beginPath();
  ctx.ellipse(x + r * 0.1, y + r * 0.2, r * 1.12 * spread, r * 0.95 * spread, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // the disc's edge, visible under the face from this angle
  ctx.fillStyle = style.edge;
  ctx.beginPath();
  ctx.arc(x, y + oy + r * 0.06, r, 0, Math.PI * 2);
  ctx.fill();

  // body
  const body = ctx.createRadialGradient(x - r * 0.36, y - r * 0.46 + oy, r * 0.1, x, y + oy, r * 1.08);
  body.addColorStop(0, style.face[0]);
  body.addColorStop(0.5, style.face[1]);
  body.addColorStop(0.86, style.face[2]);
  body.addColorStop(1, style.face[2]);
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.arc(x, y + oy, r, 0, Math.PI * 2);
  ctx.fill();

  // turned-wood grain rings, very faint
  ctx.save();
  ctx.globalAlpha = 0.55;
  for (const ring of [0.34, 0.52, 0.72]) {
    ctx.strokeStyle = style.grain;
    ctx.lineWidth = Math.max(0.4, r * 0.05);
    ctx.beginPath();
    ctx.arc(x + r * 0.04, y + oy + r * 0.02, r * ring, 0.2, Math.PI * 1.9);
    ctx.stroke();
  }
  ctx.restore();

  // rim: lit on the upper left, dark on the lower right
  ctx.lineWidth = Math.max(0.8, r * 0.13);
  ctx.strokeStyle = style.rim;
  ctx.beginPath(); ctx.arc(x, y + oy, r * 0.93, 0, Math.PI * 2); ctx.stroke();
  ctx.lineWidth = Math.max(0.6, r * 0.07);
  ctx.strokeStyle = 'rgba(255,246,224,.55)';
  ctx.beginPath(); ctx.arc(x, y + oy, r * 0.96, Math.PI * 1.02, Math.PI * 1.78); ctx.stroke();

  // inner ring, and the queen's crown of eight dots
  ctx.strokeStyle = c.kind === 'queen' ? style.edge : 'rgba(120,88,48,.35)';
  ctx.lineWidth = Math.max(0.6, r * 0.07);
  ctx.beginPath(); ctx.arc(x, y + oy, r * 0.6, 0, Math.PI * 2); ctx.stroke();
  if (c.kind === 'queen') {
    ctx.fillStyle = style.edge;
    for (let i = 0; i < 8; i++) {
      const a = (Math.PI / 4) * i;
      ctx.beginPath();
      ctx.arc(x + Math.cos(a) * r * 0.6, y + oy + Math.sin(a) * r * 0.6, r * 0.07, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // specular: a tight hot spot and a loose sheen
  const gloss = ctx.createRadialGradient(x - r * 0.36, y - r * 0.48 + oy, 0, x - r * 0.36, y - r * 0.48 + oy, r * 0.8);
  gloss.addColorStop(0, `rgba(255,255,255,${style.gloss})`);
  gloss.addColorStop(0.35, 'rgba(255,255,255,.12)');
  gloss.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gloss;
  ctx.beginPath(); ctx.arc(x, y + oy, r, 0, Math.PI * 2); ctx.fill();

  // a second, smaller hotspot — the tell of a polished surface
  const hot = ctx.createRadialGradient(x + r * 0.34, y + oy - r * 0.5, 0, x + r * 0.34, y + oy - r * 0.5, r * 0.26);
  hot.addColorStop(0, 'rgba(255,255,255,.5)');
  hot.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = hot;
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
  shadow.addColorStop(0, 'rgba(58,34,8,.45)');
  shadow.addColorStop(1, 'rgba(58,34,8,0)');
  ctx.fillStyle = shadow;
  ctx.beginPath(); ctx.ellipse(cxp + r * 0.08, cyp + r * 0.2, r * 1.18, r * 0.98, 0, 0, Math.PI * 2); ctx.fill();
  ctx.restore();

  // steel edge under the face
  ctx.fillStyle = '#8fa9c0';
  ctx.beginPath(); ctx.arc(cxp, cyp + r * 0.06, r, 0, Math.PI * 2); ctx.fill();

  const body = ctx.createRadialGradient(cxp - r * 0.42, cyp - r * 0.52, r * 0.1, cxp, cyp, r * 1.06);
  body.addColorStop(0, '#ffffff');
  body.addColorStop(0.42, '#f2f7fd');
  body.addColorStop(0.8, '#d7e4f1');
  body.addColorStop(1, '#a9c0d6');
  ctx.fillStyle = body;
  ctx.beginPath(); ctx.arc(cxp, cyp, r, 0, Math.PI * 2); ctx.fill();

  ctx.strokeStyle = '#6f93b4';
  ctx.lineWidth = Math.max(0.8, r * 0.14);
  ctx.beginPath(); ctx.arc(cxp, cyp, r * 0.9, 0, Math.PI * 2); ctx.stroke();

  // a turned inner bowl, lit from the top left
  const bowl = ctx.createRadialGradient(cxp - r * 0.2, cyp - r * 0.24, r * 0.02, cxp, cyp, r * 0.66);
  bowl.addColorStop(0, 'rgba(255,255,255,.85)');
  bowl.addColorStop(0.55, 'rgba(210,228,245,.35)');
  bowl.addColorStop(1, 'rgba(150,180,208,.18)');
  ctx.fillStyle = bowl;
  ctx.beginPath(); ctx.arc(cxp, cyp, r * 0.66, 0, Math.PI * 2); ctx.fill();

  const ring = ctx.createLinearGradient(cxp - r, cyp - r, cxp + r, cyp + r);
  ring.addColorStop(0, '#ff9a6b');
  ring.addColorStop(0.5, '#e2452f');
  ring.addColorStop(1, '#9c1f16');
  ctx.strokeStyle = ring;
  ctx.lineWidth = Math.max(1, r * 0.3);
  ctx.beginPath(); ctx.arc(cxp, cyp, r * 0.6, 0, Math.PI * 2); ctx.stroke();

  const gloss = ctx.createRadialGradient(cxp - r * 0.42, cyp - r * 0.54, 0, cxp - r * 0.42, cyp - r * 0.54, r * 0.82);
  gloss.addColorStop(0, 'rgba(255,255,255,.98)');
  gloss.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gloss;
  ctx.beginPath(); ctx.arc(cxp, cyp, r, 0, Math.PI * 2); ctx.fill();
}

/** A coin going into a pocket: a ring that opens and fades. `t` runs 0…1. */
export function paintPocketBurst(ctx: CanvasRenderingContext2D, l: PaintSize, x: number, y: number, t: number, kind: CoinKind) {
  if (t <= 0 || t >= 1) return;
  const cxp = px(l, x), cyp = px(l, y);
  const r = COIN_R * l.scale;
  const style = COIN_STYLE[kind];
  const ease = 1 - Math.pow(1 - t, 3);
  ctx.save();
  ctx.globalAlpha = (1 - t) * 0.9;
  ctx.strokeStyle = kind === 'queen' ? '#f3c76d' : 'rgba(255,236,196,.9)';
  ctx.lineWidth = Math.max(1, r * 0.16 * (1 - t * 0.6));
  ctx.beginPath(); ctx.arc(cxp, cyp, r * (1 + ease * 1.6), 0, Math.PI * 2); ctx.stroke();
  ctx.globalAlpha = (1 - t) * 0.5;
  ctx.fillStyle = style.face[0];
  ctx.beginPath(); ctx.arc(cxp, cyp, r * (1 - ease) * 0.9, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

/**
 * Where a shot would first touch something.
 *
 * A ghost of the striker at the moment of impact, and the coin it would hit —
 * worked out with a plain ray/circle intersection rather than by simulating,
 * because this runs while a finger is dragging and a full simulation is 23 ms.
 */
export function aimPreview(
  coins: { x: number; y: number; alive: boolean }[],
  from: { x: number; y: number },
  angle: number,
): { hitAt: { x: number; y: number } | null; coin: { x: number; y: number } | null } {
  const dx = Math.cos(angle), dy = Math.sin(angle);
  let best = Infinity;
  let coin: { x: number; y: number } | null = null;
  const sum = STRIKER_R + COIN_R;
  for (const c of coins) {
    if (!c.alive) continue;
    const ox = c.x - from.x, oy = c.y - from.y;
    const proj = ox * dx + oy * dy;
    if (proj <= 0) continue;
    const perp = Math.abs(ox * dy - oy * dx);
    if (perp > sum) continue;
    const along = proj - Math.sqrt(Math.max(0, sum * sum - perp * perp));
    if (along < best) { best = along; coin = c; }
  }
  // and the rails, so the guide never runs off the table
  const rail = 100 - STRIKER_R;
  const edges: { t: number }[] = [];
  if (dx > 1e-6) edges.push({ t: (rail - from.x) / dx });
  if (dx < -1e-6) edges.push({ t: (STRIKER_R - from.x) / dx });
  if (dy > 1e-6) edges.push({ t: (rail - from.y) / dy });
  if (dy < -1e-6) edges.push({ t: (STRIKER_R - from.y) / dy });
  const wall = Math.min(...edges.filter((e) => e.t > 0).map((e) => e.t), Infinity);

  if (coin && best < wall) return { hitAt: { x: from.x + dx * best, y: from.y + dy * best }, coin };
  if (Number.isFinite(wall)) return { hitAt: { x: from.x + dx * wall, y: from.y + dy * wall }, coin: null };
  return { hitAt: null, coin: null };
}

/** The aiming guide: the line to the first thing it will touch, and a ghost of the striker there. */
export function paintAim(ctx: CanvasRenderingContext2D, l: PaintSize, from: { x: number; y: number }, angle: number, power: number) {
  const x0 = px(l, from.x), y0 = px(l, from.y);
  const reach = (12 + power * 92) * l.scale;
  const x1 = x0 + Math.cos(angle) * reach;
  const y1 = y0 + Math.sin(angle) * reach;

  ctx.save();
  const grad = ctx.createLinearGradient(x0, y0, x1, y1);
  grad.addColorStop(0, `rgba(214,60,40,${0.3 + power * 0.55})`);
  grad.addColorStop(0.7, `rgba(214,60,40,${0.12 + power * 0.2})`);
  grad.addColorStop(1, 'rgba(214,60,40,0.05)');
  ctx.strokeStyle = grad;
  ctx.lineWidth = Math.max(2, l.scale * 0.7);
  ctx.setLineDash([l.scale * 2.2, l.scale * 1.8]);
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
  ctx.setLineDash([]);

  // power ring around the striker: the arc closes as you pull back
  const ringR = STRIKER_R * l.scale * 1.5;
  ctx.strokeStyle = 'rgba(214,60,40,.22)';
  ctx.lineWidth = Math.max(1.5, l.scale * 0.5);
  ctx.beginPath(); ctx.arc(x0, y0, ringR, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeStyle = power > 0.8 ? 'rgba(240,120,40,.95)' : 'rgba(214,60,40,.8)';
  ctx.lineWidth = Math.max(2, l.scale * 0.7);
  ctx.beginPath(); ctx.arc(x0, y0, ringR, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, power)); ctx.stroke();
  ctx.restore();
}

/** The ghost striker at the point of contact, and the coin it is aimed at. */
export function paintGhost(ctx: CanvasRenderingContext2D, l: PaintSize, at: { x: number; y: number }, target: { x: number; y: number } | null) {
  const x = px(l, at.x), y = px(l, at.y);
  const r = STRIKER_R * l.scale;
  ctx.save();
  ctx.setLineDash([l.scale * 1.4, l.scale * 1.4]);
  ctx.strokeStyle = 'rgba(214,60,40,.5)';
  ctx.lineWidth = Math.max(1, l.scale * 0.3);
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
  ctx.setLineDash([]);
  if (target) {
    const tx = px(l, target.x), ty = px(l, target.y);
    const tr = COIN_R * l.scale * 1.35;
    ctx.strokeStyle = 'rgba(255,196,80,.8)';
    ctx.lineWidth = Math.max(1.2, l.scale * 0.35);
    ctx.beginPath(); ctx.arc(tx, ty, tr, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.restore();
}
