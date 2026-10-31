/**
 * How carrom looks.
 *
 * Painted, not shipped as a picture, because the board has to be sharp at any
 * size and because the pieces on it move. But painted *from photographs*: the
 * rosewood of the rails and the birch ply of the bed are generated textures in
 * `public/art/carrom`, because grain drawn in code is what made this look like a
 * diagram of a carrom board rather than a carrom board.
 *
 * Three passes have gone into making it read as furniture:
 *
 *   • **scale** — the pieces were a third too small. A real set on a 74 cm bed
 *     has a coin 3.18 cm across, a striker 4.13 and a pocket 4.45; the old radii
 *     drew undersized pieces with a wide empty field between them.
 *   • **the rail** — real boards cut the four rails mitred, chamfer the inner
 *     corner at each pocket, and leave a hairline shadow where the rail meets the
 *     bed. The bed is about 89% of the board, not 83%.
 *   • **the pieces** — carrom coins are turned beech with a shallow recess and a
 *     lacquer, not glass marbles. The gloss was the giveaway: a hard white
 *     highlight reads as plastic. These are matte, with a turned groove and a
 *     warm shadow underneath.
 *
 * The static table is painted once into an offscreen canvas and blitted every
 * frame; only the coins and the striker are drawn per frame.
 */
import { BOARD, COIN_R, POCKETS, POCKET_R, STRIKER_R } from './physics';
import type { CoinKind } from './physics';
import { rng } from '../types';
import { carromArt } from './materials';

const INK = '#8a2b1e';
const INK_SOFT = 'rgba(138,43,30,.5)';

export interface PaintSize { size: number; frame: number; scale: number; origin: number }

export function layout(size: number): PaintSize {
  /* A real board: the rail is about 4.5 cm on an 83 cm frame, so the bed is a
     little under nine tenths of the width. The old 8.5% drew a picture frame
     around the game. */
  const frame = Math.max(9, size * 0.052);
  const inner = size - frame * 2;
  return { size, frame, scale: inner / BOARD, origin: frame };
}

const px = (l: PaintSize, v: number) => l.origin + v * l.scale;

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rad = Math.min(r, w / 2, h / 2);
  ctx.beginPath(); ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

/** Tile an image across a box at a given scale. */
function fillPattern(ctx: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, w: number, h: number, scale: number) {
  const pattern = ctx.createPattern(img, 'repeat');
  if (!pattern) return false;
  const s = (scale * Math.max(w, h)) / Math.max(img.naturalWidth, img.naturalHeight);
  const m = new DOMMatrix();
  m.a = s; m.d = s;
  pattern.setTransform(m);
  ctx.save();
  ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  ctx.fillStyle = pattern;
  ctx.fillRect(x, y, w, h);
  ctx.restore();
  return true;
}

/* ------------------------------------------------------------------ the table */

export function buildBoard(size: number, dpr = 1): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(size * dpr);
  canvas.height = Math.round(size * dpr);
  const ctx = canvas.getContext('2d')!;
  ctx.scale(dpr, dpr);
  paintBoard(ctx, layout(size));
  return canvas;
}

export function paintBoard(ctx: CanvasRenderingContext2D, l: PaintSize) {
  const { size, frame } = l;
  const random = rng(20261030);
  const inner = size - frame * 2;
  const radius = size * 0.016;
  const rail = carromArt.rail();
  const bed = carromArt.surface();

  /* --- the room: a dark refectory table under the board ---------------- */
  const table = ctx.createRadialGradient(size * 0.38, size * 0.3, size * 0.04, size * 0.5, size * 0.55, size * 0.9);
  table.addColorStop(0, '#3a2415');
  table.addColorStop(0.55, '#241508');
  table.addColorStop(1, '#120a04');
  ctx.fillStyle = table;
  ctx.fillRect(0, 0, size, size);

  /* --- the board's own drop shadow ------------------------------------ */
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,.72)';
  ctx.shadowBlur = size * 0.05;
  ctx.shadowOffsetY = size * 0.014;
  roundRect(ctx, frame * 0.28, frame * 0.28, size - frame * 0.56, size - frame * 0.56, radius);
  ctx.fillStyle = '#2b1a0c';
  ctx.fill();
  ctx.restore();

  /* --- four rails, mitred --------------------------------------------
     Real carrom boards are four pieces of wood joined at 45°, with the grain
     running along each rail. Filling the whole square with one texture and
     drawing a seam on top looks like wallpaper; filling each rail separately,
     rotated, looks like a joint. */
  const inset = frame * 0.28;
  const outer = { x: inset, y: inset, s: size - inset * 2 };
  const half = outer.s / 2;
  const seam = frame * 0.55;

  ctx.save();
  roundRect(ctx, outer.x, outer.y, outer.s, outer.s, radius);
  ctx.clip();

  const railQuad = (pts: [number, number][]) => {
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath();
  };

  const sides: { pts: [number, number][]; rotate: number }[] = [
    /* top    */ { pts: [[outer.x, outer.y], [outer.x + outer.s, outer.y], [outer.x + outer.s - seam, outer.y + seam], [outer.x + seam, outer.y + seam]], rotate: 0 },
    /* right  */ { pts: [[outer.x + outer.s, outer.y], [outer.x + outer.s, outer.y + outer.s], [outer.x + outer.s - seam, outer.y + outer.s - seam], [outer.x + outer.s - seam, outer.y + seam]], rotate: Math.PI / 2 },
    /* bottom */ { pts: [[outer.x + outer.s, outer.y + outer.s], [outer.x, outer.y + outer.s], [outer.x + seam, outer.y + outer.s - seam], [outer.x + outer.s - seam, outer.y + outer.s - seam]], rotate: 0 },
    /* left   */ { pts: [[outer.x, outer.y + outer.s], [outer.x, outer.y], [outer.x + seam, outer.y + seam], [outer.x + seam, outer.y + outer.s - seam]], rotate: Math.PI / 2 },
  ];

  for (const side of sides) {
    ctx.save();
    railQuad(side.pts);
    ctx.clip();
    if (rail) {
      ctx.translate(half, half);
      ctx.rotate(side.rotate);
      ctx.translate(-half, -half);
      fillPattern(ctx, rail, 0, 0, size, size, 0.62);
    } else {
      const g = ctx.createLinearGradient(outer.x, outer.y, outer.x + outer.s, outer.y + outer.s);
      g.addColorStop(0, '#a4682f');
      g.addColorStop(0.4, '#7d471c');
      g.addColorStop(0.75, '#94592a');
      g.addColorStop(1, '#5d3413');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, size, size);
    }
    // polish: lit along the outer edge, deeper towards the bed
    const sheen = ctx.createLinearGradient(
      side.rotate ? outer.x : outer.y,
      side.rotate ? outer.y : outer.y,
      side.rotate ? outer.x + outer.s : outer.y + seam,
      side.rotate ? outer.y + seam : outer.y + outer.s * (side.pts[0][1] > half ? -1 : 1),
    );
    sheen.addColorStop(0, 'rgba(255,214,150,.16)');
    sheen.addColorStop(0.5, 'rgba(255,214,150,0)');
    sheen.addColorStop(1, 'rgba(40,18,4,.22)');
    ctx.fillStyle = sheen;
    ctx.fillRect(0, 0, size, size);
    ctx.restore();
  }

  // the mitre seams
  ctx.strokeStyle = 'rgba(28,14,4,.5)';
  ctx.lineWidth = Math.max(1, size * 0.0022);
  for (const [sx, sy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]] as const) {
    const x0 = sx > 0 ? outer.x : outer.x + outer.s;
    const y0 = sy > 0 ? outer.y : outer.y + outer.s;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x0 + sx * frame * 1.1, y0 + sy * frame * 1.1);
    ctx.stroke();
  }
  ctx.restore();

  // the chamfered outer edge: a hairline of bright wood on the lit side, a dark
  // bevel everywhere else, so the board has thickness instead of a plastic rim
  ctx.save();
  roundRect(ctx, outer.x, outer.y, outer.s, outer.s, radius);
  ctx.strokeStyle = 'rgba(28,14,4,.7)';
  ctx.lineWidth = Math.max(1.5, size * 0.005);
  ctx.stroke();
  roundRect(ctx, outer.x + size * 0.004, outer.y + size * 0.004, outer.s - size * 0.008, outer.s - size * 0.008, radius);
  ctx.strokeStyle = 'rgba(255,214,160,.28)';
  ctx.lineWidth = Math.max(1, size * 0.0028);
  ctx.stroke();
  ctx.restore();

  /* --- the bed --------------------------------------------------------- */
  ctx.save();
  ctx.beginPath();
  ctx.rect(frame, frame, inner, inner);
  ctx.clip();
  if (bed) {
    fillPattern(ctx, bed, frame, frame, inner, inner, 0.92);
    // keep it pale and warm: raw ply is a touch grey on screen
    ctx.fillStyle = 'rgba(255,246,224,.28)';
    ctx.fillRect(frame, frame, inner, inner);
  } else {
    const surface = ctx.createRadialGradient(size * 0.42, size * 0.34, size * 0.06, size / 2, size / 2, size * 0.66);
    surface.addColorStop(0, '#fdf3d9');
    surface.addColorStop(0.45, '#f7e5c0');
    surface.addColorStop(0.78, '#eed6a9');
    surface.addColorStop(1, '#dcbb87');
    ctx.fillStyle = surface;
    ctx.fillRect(frame, frame, inner, inner);
  }

  // lamplight pooled over the middle, and the rail's shadow on the bed
  const lamp = ctx.createRadialGradient(size * 0.46, size * 0.38, size * 0.02, size * 0.5, size * 0.5, size * 0.56);
  lamp.addColorStop(0, 'rgba(255,250,232,.3)');
  lamp.addColorStop(0.5, 'rgba(255,246,222,.1)');
  lamp.addColorStop(1, 'rgba(255,240,210,0)');
  ctx.fillStyle = lamp;
  ctx.fillRect(frame, frame, inner, inner);

  const shadeW = Math.max(3, size * 0.026);
  const top = ctx.createLinearGradient(0, frame, 0, frame + shadeW);
  top.addColorStop(0, 'rgba(58,32,8,.42)');
  top.addColorStop(1, 'rgba(58,32,8,0)');
  ctx.fillStyle = top;
  ctx.fillRect(frame, frame, inner, shadeW);
  const left = ctx.createLinearGradient(frame, 0, frame + shadeW, 0);
  left.addColorStop(0, 'rgba(58,32,8,.38)');
  left.addColorStop(1, 'rgba(58,32,8,0)');
  ctx.fillStyle = left;
  ctx.fillRect(frame, frame, shadeW, inner);

  const vignette = ctx.createRadialGradient(size / 2, size / 2, size * 0.3, size / 2, size / 2, size * 0.76);
  vignette.addColorStop(0, 'rgba(120,80,32,0)');
  vignette.addColorStop(1, 'rgba(104,64,24,.16)');
  ctx.fillStyle = vignette;
  ctx.fillRect(frame, frame, inner, inner);
  ctx.restore();

  /* --- the painted furniture ------------------------------------------ */
  paintMarkings(ctx, l);

  // the rule inside the rail, drawn *on* the bed, as on a real board
  const insetRule = l.scale * (POCKET_MOUTH_RULE);
  ctx.save();
  ctx.strokeStyle = INK_SOFT;
  ctx.lineWidth = Math.max(0.8, l.scale * 0.22);
  ctx.strokeRect(frame + insetRule * 0.55, frame + insetRule * 0.55, inner - insetRule * 1.1, inner - insetRule * 1.1);
  ctx.restore();

  for (const p of POCKETS) paintPocket(ctx, l, p.x, p.y);
}

/** The bed's inner rule sits clear of the pocket mouths. */
const POCKET_MOUTH_RULE = 0;

/** The painted furniture: centre rosette, baselines, corner arrows. */
function paintMarkings(ctx: CanvasRenderingContext2D, l: PaintSize) {
  const cx = px(l, 50), cy = px(l, 50);
  const r = 13 * l.scale;

  ctx.save();
  ctx.strokeStyle = INK;
  ctx.fillStyle = INK;
  ctx.lineWidth = Math.max(1, l.scale * 0.42);

  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.arc(cx, cy, r * 0.62, 0, Math.PI * 2); ctx.stroke();
  for (let i = 0; i < 8; i++) {
    const a = (Math.PI / 4) * i;
    ctx.beginPath();
    ctx.ellipse(cx + Math.cos(a) * r * 0.31, cy + Math.sin(a) * r * 0.31, r * 0.12, r * 0.055, a, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.beginPath(); ctx.arc(cx, cy, r * 0.1, 0, Math.PI * 2); ctx.fill();

  ctx.strokeStyle = INK_SOFT;
  ctx.lineWidth = Math.max(0.6, l.scale * 0.2);
  ctx.beginPath(); ctx.arc(cx, cy, r * 1.12, 0, Math.PI * 2); ctx.stroke();

  // baselines, one per player, with the striker's circles at each end
  for (const y of [18, 82]) {
    const y0 = px(l, y), x0 = px(l, 20), x1 = px(l, 80);
    ctx.strokeStyle = INK;
    ctx.lineWidth = Math.max(1, l.scale * 0.34);
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y0); ctx.stroke();
    for (const cx2 of [20, 80]) {
      ctx.beginPath(); ctx.arc(px(l, cx2), y0, l.scale * 2.6, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(px(l, cx2), y0, l.scale * 0.9, 0, Math.PI * 2); ctx.fill();
    }
    for (let i = 1; i <= 6; i++) {
      if (i === 3 || i === 6) continue;
      ctx.beginPath(); ctx.arc(px(l, 20 + (60 / 7) * i), y0, l.scale * 0.55, 0, Math.PI * 2); ctx.fill();
    }
  }

  // corner arrows pointing at the centre
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

/**
 * A pocket.
 *
 * A hole in the corner: a dark mouth, a lit bevel on the arc that faces the play,
 * and the rail's shadow falling into it. The *visual* centre is inset from the
 * corner while the physics' pocket stays exactly at the corner, because a hole
 * drawn dead-centre on the corner is half outside the board — which is what made
 * two earlier attempts look like a hole punched through the frame.
 *
 * The tempting embellishments are all wrong here. A brass ring around the mouth
 * reads as a coin slot; a scalloped cut of the whole corner reads as damage. The
 * only thing a real board has is bare wood, chamfered, and a dark hole.
 */
function paintPocket(ctx: CanvasRenderingContext2D, l: PaintSize, x: number, y: number) {
  const r = POCKET_R * l.scale;
  const inx = x === 0 ? 1 : -1;
  const iny = y === 0 ? 1 : -1;
  const cxp = px(l, x) + inx * r * 0.72;
  const cyp = px(l, y) + iny * r * 0.72;
  const facing = Math.atan2(iny, inx);

  // the rail's shadow, falling away from the mouth across the bed
  const spill = ctx.createRadialGradient(cxp, cyp, r * 0.95, cxp, cyp, r * 1.85);
  spill.addColorStop(0, 'rgba(40,22,8,.36)');
  spill.addColorStop(1, 'rgba(40,22,8,0)');
  ctx.fillStyle = spill;
  ctx.beginPath(); ctx.arc(cxp, cyp, r * 1.85, 0, Math.PI * 2); ctx.fill();

  // the hole: deepest towards the corner
  const hole = ctx.createRadialGradient(cxp + inx * r * 0.34, cyp + iny * r * 0.34, r * 0.04, cxp, cyp, r * 1.04);
  hole.addColorStop(0, '#060403');
  hole.addColorStop(0.5, '#120c07');
  hole.addColorStop(0.84, '#251608');
  hole.addColorStop(1, '#3d2611');
  ctx.fillStyle = hole;
  ctx.beginPath(); ctx.arc(cxp, cyp, r * 1.04, 0, Math.PI * 2); ctx.fill();

  // chamfer: lit on the arc facing the play, dark behind it, nothing in between
  ctx.lineWidth = Math.max(1, r * 0.13);
  ctx.strokeStyle = 'rgba(255,232,190,.5)';
  ctx.beginPath();
  ctx.arc(cxp, cyp, r * 1.02, facing - 1.2, facing + 1.2);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(28,16,6,.75)';
  ctx.beginPath();
  ctx.arc(cxp, cyp, r * 1.05, facing + 1.9, facing + 4.4);
  ctx.stroke();

  // and the hard inner edge where wood meets nothing
  ctx.strokeStyle = 'rgba(0,0,0,.55)';
  ctx.lineWidth = Math.max(0.8, r * 0.06);
  ctx.beginPath();
  ctx.arc(cxp, cyp, r * 0.9, 0, Math.PI * 2);
  ctx.stroke();
}

/* ------------------------------------------------------------------ pieces */

/**
 * A coin is turned beech: a flat face, a shallow recess inside a raised rim, a
 * faint ring where the lathe left it, and lacquer — but matte lacquer. The hard
 * white highlight the old painter used is what made them look like glass beads.
 */
const COIN_STYLE: Record<CoinKind, {
  face: [string, string, string]; rim: string; recess: string; edge: string; queen?: boolean;
}> = {
  white: { face: ['#fbf2dd', '#efdcb8', '#cfb184'], rim: '#f7ead0', recess: 'rgba(150,112,60,.22)', edge: '#b99a6a' },
  black: { face: ['#4a3f36', '#2e2620', '#1a1512'], rim: '#5a4c40', recess: 'rgba(0,0,0,.35)', edge: '#171310' },
  queen: { face: ['#c8402f', '#a3271c', '#6d120c'], rim: '#d9553f', recess: 'rgba(70,8,4,.35)', edge: '#5c0f08', queen: true },
};

export function paintCoin(ctx: CanvasRenderingContext2D, l: PaintSize, c: { x: number; y: number; kind: CoinKind }, lift = 0) {
  const x = px(l, c.x), y = px(l, c.y);
  const r = COIN_R * l.scale;
  const style = COIN_STYLE[c.kind];
  const oy = -lift * r * 0.4;

  // a soft, warm contact shadow — wide, never a hard ring
  ctx.save();
  const spread = 1 + lift * 0.5;
  const shadow = ctx.createRadialGradient(x + r * 0.14, y + r * 0.3, r * 0.12, x + r * 0.1, y + r * 0.24, r * 1.1 * spread);
  shadow.addColorStop(0, `rgba(52,30,8,${0.36 - lift * 0.14})`);
  shadow.addColorStop(0.55, `rgba(52,30,8,${0.16 - lift * 0.06})`);
  shadow.addColorStop(1, 'rgba(52,30,8,0)');
  ctx.fillStyle = shadow;
  ctx.beginPath();
  ctx.ellipse(x + r * 0.08, y + r * 0.2, r * 1.06 * spread, r * 0.92 * spread, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // thickness: the disc's edge, visible under the face
  ctx.fillStyle = style.edge;
  ctx.beginPath();
  ctx.arc(x, y + oy + r * 0.07, r, 0, Math.PI * 2);
  ctx.fill();

  // the face
  const body = ctx.createRadialGradient(x - r * 0.34, y - r * 0.42 + oy, r * 0.06, x, y + oy, r * 1.02);
  body.addColorStop(0, style.face[0]);
  body.addColorStop(0.55, style.face[1]);
  body.addColorStop(1, style.face[2]);
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.arc(x, y + oy, r, 0, Math.PI * 2);
  ctx.fill();

  /* the raised rim, then the shallow recess inside it: two thin rings, dark on
     the far side and catching light on the near side, which is how a turned
     edge reads under a lamp */
  const ringAt = (rr: number, dark: string, light: string, width: number) => {
    ctx.lineWidth = width;
    ctx.strokeStyle = dark;
    ctx.beginPath(); ctx.arc(x, y + oy, rr, -0.35, Math.PI + 0.55); ctx.stroke();
    ctx.strokeStyle = light;
    ctx.beginPath(); ctx.arc(x, y + oy, rr, Math.PI - 0.45, Math.PI * 2 + 0.25); ctx.stroke();
  };
  ringAt(r * 0.88, 'rgba(60,36,10,.28)', 'rgba(255,246,224,.5)', Math.max(0.8, r * 0.06));
  ringAt(r * 0.62, style.recess, 'rgba(255,248,230,.34)', Math.max(0.7, r * 0.05));

  // the recess itself, very slightly darker in the middle
  const bowl = ctx.createRadialGradient(x - r * 0.12, y - r * 0.16 + oy, r * 0.04, x, y + oy, r * 0.62);
  bowl.addColorStop(0, 'rgba(255,255,255,.06)');
  bowl.addColorStop(1, 'rgba(70,44,14,.09)');
  ctx.fillStyle = bowl;
  ctx.beginPath(); ctx.arc(x, y + oy, r * 0.6, 0, Math.PI * 2); ctx.fill();

  if (style.queen) {
    // the queen's ring of eight gold dots, and a small rosette in the middle
    ctx.fillStyle = '#f0cf86';
    for (let i = 0; i < 8; i++) {
      const a = (Math.PI / 4) * i + Math.PI / 8;
      ctx.beginPath();
      ctx.arc(x + Math.cos(a) * r * 0.74, y + oy + Math.sin(a) * r * 0.74, r * 0.075, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = 'rgba(240,207,134,.8)';
    ctx.lineWidth = Math.max(0.6, r * 0.05);
    ctx.beginPath(); ctx.arc(x, y + oy, r * 0.3, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(x, y + oy, r * 0.08, 0, Math.PI * 2); ctx.fill();
  }

  // a broad matte sheen from the top left — no white dot
  const sheen = ctx.createLinearGradient(x - r * 0.8, y - r * 0.9 + oy, x + r * 0.6, y + r * 0.7 + oy);
  sheen.addColorStop(0, 'rgba(255,255,255,.3)');
  sheen.addColorStop(0.42, 'rgba(255,255,255,.05)');
  sheen.addColorStop(1, 'rgba(0,0,0,.12)');
  ctx.save();
  ctx.beginPath(); ctx.arc(x, y + oy, r, 0, Math.PI * 2); ctx.clip();
  ctx.fillStyle = sheen;
  ctx.fillRect(x - r, y - r + oy, r * 2, r * 2);
  ctx.restore();

  // and a thin lit edge, so the coin separates from the wood behind it
  ctx.strokeStyle = 'rgba(255,248,232,.34)';
  ctx.lineWidth = Math.max(0.6, r * 0.045);
  ctx.beginPath(); ctx.arc(x, y + oy, r * 0.985, Math.PI * 1.05, Math.PI * 1.8); ctx.stroke();
}

/**
 * The striker: ivory disc, a red ring around the face, a turned centre. That is
 * what a carrom striker is — a plain polished disc you flick — not the chrome
 * pucks the arcade uses.
 */
export function paintStriker(ctx: CanvasRenderingContext2D, l: PaintSize, x: number, y: number, glow = 0) {
  const cxp = px(l, x), cyp = px(l, y);
  const r = STRIKER_R * l.scale;

  if (glow > 0) {
    ctx.save();
    ctx.globalAlpha = glow;
    const halo = ctx.createRadialGradient(cxp, cyp, r * 0.7, cxp, cyp, r * 2.4);
    halo.addColorStop(0, 'rgba(255,214,102,.4)');
    halo.addColorStop(1, 'rgba(255,214,102,0)');
    ctx.fillStyle = halo;
    ctx.beginPath(); ctx.arc(cxp, cyp, r * 2.4, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  // shadow
  ctx.save();
  const shadow = ctx.createRadialGradient(cxp + r * 0.16, cyp + r * 0.3, r * 0.15, cxp, cyp, r * 1.22);
  shadow.addColorStop(0, 'rgba(52,30,8,.4)');
  shadow.addColorStop(1, 'rgba(52,30,8,0)');
  ctx.fillStyle = shadow;
  ctx.beginPath(); ctx.ellipse(cxp + r * 0.06, cyp + r * 0.18, r * 1.14, r * 0.96, 0, 0, Math.PI * 2); ctx.fill();
  ctx.restore();

  ctx.fillStyle = '#cbb187';
  ctx.beginPath(); ctx.arc(cxp, cyp + r * 0.07, r, 0, Math.PI * 2); ctx.fill();

  const body = ctx.createRadialGradient(cxp - r * 0.36, cyp - r * 0.44, r * 0.06, cxp, cyp, r * 1.02);
  body.addColorStop(0, '#fffdf7');
  body.addColorStop(0.5, '#f6eedd');
  body.addColorStop(1, '#dccbaa');
  ctx.fillStyle = body;
  ctx.beginPath(); ctx.arc(cxp, cyp, r, 0, Math.PI * 2); ctx.fill();

  // the red ring and the turned centre
  ctx.strokeStyle = '#b8352a';
  ctx.lineWidth = Math.max(1, r * 0.16);
  ctx.beginPath(); ctx.arc(cxp, cyp, r * 0.68, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeStyle = 'rgba(150,110,60,.35)';
  ctx.lineWidth = Math.max(0.6, r * 0.05);
  ctx.beginPath(); ctx.arc(cxp, cyp, r * 0.42, 0, Math.PI * 2); ctx.stroke();

  // matte sheen and a lit edge
  ctx.save();
  ctx.beginPath(); ctx.arc(cxp, cyp, r, 0, Math.PI * 2); ctx.clip();
  const sheen = ctx.createLinearGradient(cxp - r * 0.8, cyp - r * 0.9, cxp + r * 0.6, cyp + r * 0.7);
  sheen.addColorStop(0, 'rgba(255,255,255,.6)');
  sheen.addColorStop(0.45, 'rgba(255,255,255,.06)');
  sheen.addColorStop(1, 'rgba(90,60,20,.14)');
  ctx.fillStyle = sheen;
  ctx.fillRect(cxp - r, cyp - r, r * 2, r * 2);
  ctx.restore();

  ctx.strokeStyle = 'rgba(255,252,240,.5)';
  ctx.lineWidth = Math.max(0.6, r * 0.05);
  ctx.beginPath(); ctx.arc(cxp, cyp, r * 0.98, Math.PI * 1.05, Math.PI * 1.82); ctx.stroke();
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
