/**
 * How carrom looks.
 *
 * Painted, not shipped as a picture, because the board has to be sharp at any
 * size and because the pieces on it move. It is painted *from a real board*: the
 * reference is the printed tournament board everyone pictures — cream table, a
 * wide dark walnut rail with the pockets drilled into its corners, a pale tan
 * bed, a double rule with a red dot in a pale disc at each inner corner, a
 * diagonal from each of those to a hook-and-circle volute, and an eight-pointed
 * red rosette at the centre.
 *
 * Everything below was measured off that board rather than invented, and the two
 * measurements that matter most are the ones the previous version got wrong:
 *
 *   • **the rail is a sixth of the board**, not a thin frame. A real board is
 *     mostly rail, and the pockets sit *in* it — which is what makes the corners
 *     read as holes rather than as decoration.
 *   • **the bed is a flat tan** (#d2ae7c), not near-white ply. A photographed
 *     surface brought its own lighting and banded under the board's lamp, so the
 *     bed is a tint with a drawn figure and the only photograph left is the
 *     rail's grain, recoloured with a `color` blend.
 *
 * The pocket holes are the one place the painting is bent to the referee: the
 * simulation kills a coin when its centre comes within `POCKET_R` of a corner, so
 * the hole straddles that corner rather than sitting wholly out in the rail where
 * a printer's board has it. A hole drawn in the wrong place is a hole a coin
 * vanishes short of.
 *
 * The static table is painted once into an offscreen canvas and blitted every
 * frame; only the coins and the striker are drawn per frame.
 */
import { BASELINE_Y, BOARD, COIN_R, POCKETS, STRIKER_R } from './physics';
import type { CoinKind } from './physics';
import { rng } from '../types';
import { carromArt } from './materials';

/* The board the painter copies.
 *
 * Every number below was measured off a photograph of a real board rather than
 * guessed — the reference is a printer's board, the one everybody pictures when
 * they hear "carrom": cream table, a narrow dark rail, a pale tan bed, a
 * double rule with a red dot at each corner, a match-cut eight-pointed rosette
 * in the middle, and four drilled pockets that sit in the rail's corners.
 *
 * What it replaces was darker and busier: a rosewood picture frame, near-white
 * ply, red arrowheads, and pockets painted as bowls. It was a good drawing of a
 * board. It was not the board, and this is.
 *
 *   • **the table** — the board is an object on a surface. A cream margin round
 *     it is the difference between a texture that fills a canvas and a thing
 *     lying on a table.
 *   • **the rail** — narrow (6.3% of the board), dark walnut, mitred, with a lit
 *     outer arris and a hard shadow line where it meets the bed.
 *   • **the bed** — pine-tan, not white. The reference's bed is #d2ab76; ours
 *     was #f0dfc0, which is why it looked like a diagram.
 *   • **the furniture** — a double rule 13.4 and 18 units in, with the joint disc
 *     and red dot at each inner corner; a diagonal from each dot toward the
 *     centre that ends in a hooked volute; and the rosette, eight cut points,
 *     half of them shaded dark.
 */
const INK = '#513a20';
const INK_SOFT = 'rgba(67,48,27,.62)';
const RED = '#a8301a';
const RED_DARK = '#7d2114';

export interface PaintSize { size: number; frame: number; margin: number; scale: number; origin: number }

export function layout(size: number): PaintSize {
  /* margin → rail → bed, read off the reference with a ruler rather than
     guessed: a 4% cream margin, then a *wide* rail — 16.7% of the board, which is
     where the pockets are drilled — leaving a bed of two thirds of the board.
     The old board was almost all bed with a thin frame, which is why it read as a
     diagram: a real printed board is mostly rail. */
  const margin = size * 0.04;
  const board = size - margin * 2;
  const frame = board * 0.167;
  const inner = board - frame * 2;
  return { size, frame, margin, scale: inner / BOARD, origin: margin + frame };
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

/**
 * One copy of a photograph stretched over a box.
 *
 * Tiling a 512px grain over a 1040px canvas leaves a seam across the middle of
 * every rail — which is exactly what the last version had. Grain has no scale in
 * a texture this flat, so stretching it once beats repeating it four times.
 */
function fillStretched(ctx: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, w: number, h: number) {
  ctx.save();
  ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  ctx.drawImage(img, x, y, w, h);
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
  const { size, frame, margin } = l;
  const random = rng(20261101);
  const board = size - margin * 2;
  const inner = board - frame * 2;
  const bedX = l.origin;
  const radius = size * 0.024;
  const rail = carromArt.rail();

  /* --- the table: warm linen, lit top left, falling away at the edges ---- */
  const table = ctx.createRadialGradient(size * 0.34, size * 0.2, size * 0.04, size * 0.52, size * 0.58, size * 1.02);
  table.addColorStop(0, '#d3bb9f');
  table.addColorStop(0.55, '#c7ac8f');
  table.addColorStop(1, '#b09677');
  ctx.fillStyle = table;
  ctx.fillRect(0, 0, size, size);

  // a tooth to the paper, so the margin is not a flat field of colour
  ctx.save();
  for (let i = 0; i < 900; i++) {
    const x = random() * size, y = random() * size;
    const a = 0.012 + random() * 0.03;
    ctx.fillStyle = random() > 0.5 ? `rgba(255,247,225,${a})` : `rgba(96,66,34,${a})`;
    ctx.fillRect(x, y, 1.1, 1.1);
  }
  ctx.restore();

  /* --- the board's shadow on that surface ------------------------------- */
  ctx.save();
  ctx.shadowColor = 'rgba(64,40,14,.5)';
  ctx.shadowBlur = size * 0.032;
  ctx.shadowOffsetY = size * 0.008;
  roundRect(ctx, margin, margin, board, board, radius);
  ctx.fillStyle = '#6b4a24';
  ctx.fill();
  ctx.restore();

  /* --- the rail --------------------------------------------------------
     Walnut, wide, matte: on a real board the rail is a sixth of the board's
     width and the pockets are drilled into it. Two things are load-bearing and
     both were wrong before — the width, and the fact that this surface is
     *flat*. Anything that varies across it fast enough to see reads as moulded
     plastic, which is how three earlier versions failed. */
  const seam = frame;
  const outer = { x: margin, y: margin, s: board };

  ctx.save();
  roundRect(ctx, outer.x, outer.y, outer.s, outer.s, radius);
  ctx.clip();

  const top = outer.y, right = outer.x + outer.s, bottom = outer.y + outer.s, left = outer.x;

  ctx.save();
  ctx.fillStyle = '#7c552c';
  ctx.fillRect(left, top, outer.s, outer.s);

  ctx.save();
  roundRect(ctx, left, top, outer.s, outer.s, radius);
  ctx.clip();
  /* The photograph, recoloured to the board's own walnut.
     Drawn grain reads as scratches and a tiled or stretched photograph picks up
     a seam — but a photograph recoloured with a `color` blend keeps its figure
     and loses its own lighting, which is the one thing neither of the first two
     attempts could do at once. */
  if (rail) {
    ctx.globalAlpha = 0.6;
    fillStretched(ctx, rail, left, top, outer.s, outer.s);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'color';
    ctx.fillStyle = '#6b4220';
    ctx.fillRect(left, top, outer.s, outer.s);
    ctx.globalCompositeOperation = 'soft-light';
    ctx.fillStyle = 'rgba(255,232,196,.1)';
    ctx.fillRect(left, top, outer.s, outer.s);
    // the reference's walnut is a good deal darker than the photograph's
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = 'rgba(122,84,44,.34)';
    ctx.fillRect(left, top, outer.s, outer.s);
    ctx.globalCompositeOperation = 'source-over';
  } else {
    for (let i = 0; i < 500; i++) {
      const x = left + random() * outer.s, y = top + random() * outer.s;
      ctx.strokeStyle = random() > 0.45
        ? `rgba(40,21,6,${0.04 + random() * 0.08})`
        : `rgba(216,168,108,${0.03 + random() * 0.07})`;
      ctx.lineWidth = 0.5 + random() * 0.7;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + (random() - 0.5) * 1.5, y + 2 + random() * size * 0.03);
      ctx.stroke();
    }
  }
  ctx.restore();

  /* the arris: the lightest thing on the board, a hair inside the outer edge,
     and the shade the rail drops onto the bed */
  const arrisW = seam * 0.26;
  const band = arrisW * 1.5;
  const arris = ctx.createLinearGradient(0, top, 0, top + arrisW);
  arris.addColorStop(0, 'rgba(255,228,182,.13)');
  arris.addColorStop(1, 'rgba(255,228,182,0)');
  ctx.fillStyle = arris;
  ctx.fillRect(left, top, outer.s, arrisW);
  const arrisL = ctx.createLinearGradient(left, 0, left + arrisW, 0);
  arrisL.addColorStop(0, 'rgba(255,228,182,.13)');
  arrisL.addColorStop(1, 'rgba(255,228,182,0)');
  ctx.fillStyle = arrisL;
  ctx.fillRect(left, top, arrisW, outer.s);

  /* These bands were drawn across the whole canvas at first, so the shadow of
     the north rail was painted over the east and west rails too — a cross of two
     dark stripes straight through the frame. Each one is bounded by the board. */
  const bedEdge = ctx.createLinearGradient(0, top + seam, 0, top + seam - band);
  bedEdge.addColorStop(0, 'rgba(26,12,2,.30)');
  bedEdge.addColorStop(1, 'rgba(26,12,2,0)');
  ctx.fillStyle = bedEdge;
  ctx.fillRect(left, top + seam - band, outer.s, band);

  const bedEdgeB = ctx.createLinearGradient(0, bottom - seam, 0, bottom - seam + band);
  bedEdgeB.addColorStop(0, 'rgba(26,12,2,.22)');
  bedEdgeB.addColorStop(1, 'rgba(26,12,2,0)');
  ctx.fillStyle = bedEdgeB;
  ctx.fillRect(left, bottom - seam, outer.s, band);

  const bedEdgeL = ctx.createLinearGradient(left + seam, 0, left + seam - band, 0);
  bedEdgeL.addColorStop(0, 'rgba(26,12,2,.26)');
  bedEdgeL.addColorStop(1, 'rgba(26,12,2,0)');
  ctx.fillStyle = bedEdgeL;
  ctx.fillRect(left + seam - band, top, band, outer.s);

  const bedEdgeR = ctx.createLinearGradient(right - seam, 0, right - seam + band, 0);
  bedEdgeR.addColorStop(0, 'rgba(26,12,2,.22)');
  bedEdgeR.addColorStop(1, 'rgba(26,12,2,0)');
  ctx.fillStyle = bedEdgeR;
  ctx.fillRect(right - seam, top, band, outer.s);

  // the mitre seams, from each outer corner in
  ctx.strokeStyle = 'rgba(30,16,4,.07)';
  ctx.lineWidth = Math.max(0.7, size * 0.001);
  for (const [sx, sy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]] as const) {
    const x0 = sx > 0 ? left : right;
    const y0 = sy > 0 ? top : bottom;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x0 + sx * seam, y0 + sy * seam);
    ctx.stroke();
  }

  // the arris: a bright hairline just inside the outer edge, and a dark one
  // outside it, which is what reads as a chamfer at this size
  roundRect(ctx, outer.x + size * 0.0035, outer.y + size * 0.0035, outer.s - size * 0.007, outer.s - size * 0.007, radius);
  ctx.strokeStyle = 'rgba(255,226,178,.34)';
  ctx.lineWidth = Math.max(1, size * 0.0022);
  ctx.stroke();
  ctx.restore();

  roundRect(ctx, outer.x, outer.y, outer.s, outer.s, radius);
  ctx.strokeStyle = 'rgba(30,16,4,.55)';
  ctx.lineWidth = Math.max(1, size * 0.0018);
  ctx.stroke();

  /* --- the bed ---------------------------------------------------------
     Corners are cut, not square: on a real board the rail is relieved at each
     pocket so a coin can run into the hole. Drawing the bed square left the
     holes sitting on plain wood with nothing to explain them. */
  const mouth = MOUTH * l.scale;
  ctx.save();
  ctx.beginPath();
  roundRect(ctx, bedX, bedX, inner, inner, mouth);
  ctx.clip();
  /* An even tan with a faint ply figure drawn in.
     The photograph of a real bed carries its own lighting, and stretched over
     this board it banded the surface — a flat printed board has no such thing,
     so the figure is drawn: long, very low-contrast bands. */
  ctx.fillStyle = '#d2ae7c';
  ctx.fillRect(bedX, bedX, inner, inner);
  for (let i = 0; i < 54; i++) {
    const y = bedX + random() * inner;
    const h = 1 + random() * 2.6;
    ctx.fillStyle = random() > 0.5
      ? `rgba(172,128,74,${0.02 + random() * 0.04})`
      : `rgba(255,240,208,${0.02 + random() * 0.05})`;
    ctx.beginPath();
    ctx.ellipse(bedX + inner * (0.2 + random() * 0.6), y, inner * (0.14 + random() * 0.32), h, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // lamp light pooled slightly above centre, and the bed darkening at its edges
  const lamp = ctx.createRadialGradient(size * 0.44, size * 0.36, size * 0.02, size * 0.5, size * 0.52, size * 0.62);
  lamp.addColorStop(0, 'rgba(255,248,226,.10)');
  lamp.addColorStop(0.55, 'rgba(255,246,220,.03)');
  lamp.addColorStop(1, 'rgba(120,80,34,.07)');
  ctx.fillStyle = lamp;
  ctx.fillRect(bedX, bedX, inner, inner);
  // a last clean pass so the bed is a surface, not a photo under glass
  ctx.fillStyle = 'rgba(222,186,132,.34)';
  ctx.fillRect(bedX, bedX, inner, inner);

  /* the rail's shadow, falling onto the bed: hard at each edge, gone within a
     few millimetres — a soft wide gradient here reads as a vignette instead */
  const shadeW = Math.max(2.5, size * 0.012);
  const edgeShade = (x0: number, y0: number, x1: number, y1: number, a: number) => {
    const g = ctx.createLinearGradient(x0, y0, x1, y1);
    g.addColorStop(0, `rgba(74,44,14,${a})`);
    g.addColorStop(1, 'rgba(74,44,14,0)');
    ctx.fillStyle = g;
  };
  edgeShade(bedX, bedX, bedX, bedX + shadeW, 0.34);
  ctx.fillRect(bedX, bedX, inner, shadeW);
  edgeShade(bedX, bedX, bedX + shadeW, bedX, 0.3);
  ctx.fillRect(bedX, bedX, shadeW, inner);
  edgeShade(bedX, bedX + inner, bedX, bedX + inner - shadeW, 0.2);
  ctx.fillRect(bedX, bedX + inner - shadeW, inner, shadeW);
  edgeShade(bedX + inner, bedX, bedX + inner - shadeW, bedX, 0.16);
  ctx.fillRect(bedX + inner - shadeW, bedX, shadeW, inner);
  ctx.restore();

  /* the hard line where the rail ends and the bed begins */
  ctx.save();
  ctx.strokeStyle = 'rgba(38,20,4,.16)';
  ctx.lineWidth = Math.max(0.8, size * 0.0016);
  roundRect(ctx, bedX, bedX, inner, inner, mouth);
  ctx.stroke();
  ctx.restore();

  /* --- the painted furniture ------------------------------------------ */
  paintMarkings(ctx, l);

  for (const p of POCKETS) paintPocket(ctx, l, p.x, p.y);
}

/* ---------------------------------------------------------------- markings */

/** The double rule in from the bed's edge, in board units. */
const RULE_OUTER = 4.6;
const RULE_INNER = 10.4;
/** how far the rail is relieved at each pocket, in board units */
const MOUTH = 2.2;
/** The volute at the end of each corner diagonal. */
const CURL = { at: 22.6, r: 5.7 };

/** The painted furniture: double rule, corner joints, corner volutes, rosette. */
function paintMarkings(ctx: CanvasRenderingContext2D, l: PaintSize) {
  const cx = px(l, 50), cy = px(l, 50);
  const unit = l.scale;

  ctx.save();
  ctx.strokeStyle = INK;
  ctx.fillStyle = INK;
  ctx.lineCap = 'round';

  /* --- the double rule ------------------------------------------------ */
  ctx.lineWidth = Math.max(0.6, unit * 0.26);
  const o0 = px(l, RULE_OUTER), o1 = px(l, 100 - RULE_OUTER);
  ctx.strokeRect(o0, o0, o1 - o0, o1 - o0);
  ctx.lineWidth = Math.max(0.55, unit * 0.24);
  const i0 = px(l, RULE_INNER), i1 = px(l, 100 - RULE_INNER);
  ctx.strokeRect(i0, i0, i1 - i0, i1 - i0);

  /* --- a joint disc and a red dot at each inner corner ------------------ */
  for (const [sx, sy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]] as const) {
    const x = px(l, sx > 0 ? RULE_OUTER : 100 - RULE_OUTER);
    const y = px(l, sy > 0 ? RULE_OUTER : 100 - RULE_OUTER);
    const r = unit * 2.0;
    // the pale disc the rails are jointed with
    const disc = ctx.createRadialGradient(x - r * 0.3, y - r * 0.35, r * 0.1, x, y, r);
    disc.addColorStop(0, '#f3e6c9');
    disc.addColorStop(0.62, '#e6d3ab');
    disc.addColorStop(1, '#d3bb92');
    ctx.fillStyle = disc;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(58,40,18,.5)';
    ctx.lineWidth = Math.max(0.5, unit * 0.16);
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
    // the dot
    const dot = ctx.createRadialGradient(x - r * 0.16, y - r * 0.2, r * 0.05, x, y, r * 0.62);
    dot.addColorStop(0, '#c1482a');
    dot.addColorStop(0.7, RED);
    dot.addColorStop(1, RED_DARK);
    ctx.fillStyle = dot;
    ctx.beginPath(); ctx.arc(x, y, r * 0.55, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(64,20,8,.45)';
    ctx.lineWidth = Math.max(0.4, unit * 0.12);
    ctx.beginPath(); ctx.arc(x, y, r * 0.55, 0, Math.PI * 2); ctx.stroke();
  }

  /* --- the corner volutes --------------------------------------------- */
  for (const [sx, sy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]] as const) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(sx, sy);
    ctx.translate(-cx, -cy);
    paintVolute(ctx, l);
    ctx.restore();
  }

  /* --- the baselines ---------------------------------------------------
     The reference is a printer's board and has none, but the striker lives on
     them and a player has to see where they may put it, so they are drawn in the
     board's own ink: a hairline between the two extremes of the legal span, a
     small red dot at each, and a tick every few units. Circles at the ends were
     the first attempt; they collided with the corner volutes and turned the
     board's four corners into a mess. */
  for (const y of BASELINE_Y) {
    const y0 = px(l, y);
    /* the line runs between the corner volutes; the striker's legal extremes sit
       just outside it, and are marked with a dot each so the limit is still
       visible without drawing a rule straight through the ornament */
    const x0 = px(l, CURL.at + CURL.r * 1.1), x1 = px(l, 100 - CURL.at - CURL.r * 1.1);
    ctx.strokeStyle = INK;
    ctx.lineWidth = Math.max(0.6, unit * 0.26);
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y0); ctx.stroke();
    for (let i = 1; i <= 6; i++) {
      const tx = x0 + ((x1 - x0) / 7) * i;
      if (i === 3) continue;
      ctx.beginPath(); ctx.moveTo(tx, y0 - unit * 0.75); ctx.lineTo(tx, y0 + unit * 0.75); ctx.stroke();
    }
    ctx.fillStyle = RED;
    for (const tx of [x0, x1]) {
      ctx.beginPath(); ctx.arc(tx, y0, unit * 0.95, 0, Math.PI * 2); ctx.fill();
    }
  }

  /* --- the rosette ----------------------------------------------------- */
  const R = unit * 19.2;
  ctx.strokeStyle = INK;
  ctx.lineWidth = Math.max(0.6, unit * 0.24);
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeStyle = INK_SOFT;
  ctx.lineWidth = Math.max(0.45, unit * 0.14);
  ctx.beginPath(); ctx.arc(cx, cy, R * 0.925, 0, Math.PI * 2); ctx.stroke();
  paintStar(ctx, cx, cy, unit * 17.3, unit * 14.5, unit * 5.6, unit);
  ctx.restore();
}

/**
 * One corner of the reference board: a shaft from the corner dot toward the
 * centre, ending inside a circle with a hooked volute at each of its two open
 * ends. Drawn in the top-left orientation and mirrored into the other three.
 */
function paintVolute(ctx: CanvasRenderingContext2D, l: PaintSize) {
  const unit = l.scale;
  const cx = px(l, CURL.at), cy = px(l, CURL.at);
  const r = CURL.r * unit;

  ctx.strokeStyle = INK;
  ctx.lineWidth = Math.max(0.65, unit * 0.26);
  ctx.lineCap = 'round';

  /* the shaft: from the dot, straight down the diagonal, out through the far
     side of the circle — it runs *past* the circle's centre, as on the board */
  const shaftEnd = px(l, CURL.at + CURL.r * 1.05);
  const shaftFrom = px(l, RULE_OUTER);
  ctx.beginPath(); ctx.moveTo(shaftFrom, shaftFrom); ctx.lineTo(shaftEnd, shaftEnd); ctx.stroke();

  /* The circle, open on the side facing the corner. Canvas angles run with y
     downwards, so for the top-left corner "up-left" is -135°. */
  const gap = -Math.PI * 0.75;
  const half = Math.PI * 0.17;
  const a0 = gap + half;
  const a1 = gap - half + Math.PI * 2;
  ctx.beginPath(); ctx.arc(cx, cy, r, a0, a1); ctx.stroke();

  /* At each open end the stroke turns back on itself, inside the circle: the
     double curl is the whole of the ornament. Read off the reference, the hooks
     sit *within* the circle with their tips pointing at its centre — flared
     outside it, the corner looks like a cloud. */
  for (const [angle, dir] of [[a0, 1], [a1, -1]] as const) {
    const ex = cx + Math.cos(angle) * r;
    const ey = cy + Math.sin(angle) * r;
    const hr = r * 0.26;
    // tangent to the arc, tucked inside it
    /* tangent to the arc from the inside, so the stroke turns smoothly into the
       curl instead of crossing it */
    const hx = cx + Math.cos(angle) * (r - hr);
    const hy = cy + Math.sin(angle) * (r - hr);
    const start = Math.atan2(ey - hy, ex - hx);
    ctx.beginPath();
    ctx.arc(hx, hy, hr, start, start + dir * Math.PI * 1.65, dir < 0);
    ctx.stroke();
  }
}

/**
 * The eight-pointed rosette.
 *
 * A compass star, as it is printed on the board: eight points, the ones on the
 * axes longer than the ones on the diagonals, each point a triangle whose two
 * base corners sit at the same radius as its neighbours' — so the star is one
 * solid shape with concave notches, not eight separate spikes. Each point is
 * filled as two halves split along its own median, one lighter than the other,
 * which is what makes it look carved rather than printed.
 */
function paintStar(ctx: CanvasRenderingContext2D, cx: number, cy: number, long: number, short: number, base: number, unit: number) {
  const half = Math.PI / 8;
  ctx.save();
  for (let i = 0; i < 8; i++) {
    const a = (Math.PI / 4) * i - Math.PI / 2;
    const reach = i % 2 === 0 ? long : short;
    const tipX = cx + Math.cos(a) * reach, tipY = cy + Math.sin(a) * reach;
    const lx = cx + Math.cos(a + half) * base, ly = cy + Math.sin(a + half) * base;
    const rx = cx + Math.cos(a - half) * base, ry = cy + Math.sin(a - half) * base;

    ctx.beginPath(); ctx.moveTo(tipX, tipY); ctx.lineTo(lx, ly); ctx.lineTo(cx, cy); ctx.closePath();
    ctx.fillStyle = '#ab3f27'; ctx.fill();
    ctx.beginPath(); ctx.moveTo(tipX, tipY); ctx.lineTo(rx, ry); ctx.lineTo(cx, cy); ctx.closePath();
    ctx.fillStyle = '#8a2a18'; ctx.fill();

    // the median, which reads as the fold of the cut
    ctx.strokeStyle = 'rgba(58,26,10,.45)';
    ctx.lineWidth = Math.max(0.45, unit * 0.1);
    ctx.beginPath(); ctx.moveTo(tipX, tipY); ctx.lineTo(cx, cy); ctx.stroke();
    // and the notch between this point and the next
    ctx.strokeStyle = 'rgba(58,26,10,.3)';
    ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(rx, ry); ctx.stroke();
  }
  const hub = ctx.createRadialGradient(cx, cy, 0, cx, cy, unit * 1.5);
  hub.addColorStop(0, '#33200f');
  hub.addColorStop(0.55, 'rgba(74,38,18,.9)');
  hub.addColorStop(1, 'rgba(74,38,18,0)');
  ctx.fillStyle = hub;
  ctx.beginPath(); ctx.arc(cx, cy, unit * 1.5, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

/* ----------------------------------------------------------------- pockets */

/**
 * A pocket.
 *
 * The reference board drills them into the rail's corners: a clean dark hole
 * that bites a little out of the bed and a little out of each rail, with a hard
 * lit lip on the bed side and nothing else — no ring, no scallop, no brass.
 *
 * The mouth stays where the simulation puts it (`POCKET_MOUTH` from each corner)
 * so a coin that dies is inside the hole the eye sees.
 */
function paintPocket(ctx: CanvasRenderingContext2D, l: PaintSize, x: number, y: number) {
  /* The hole is drilled in the *rail's* corner, so its centre is the bed's
     corner, not a point inside the bed: two thirds of it sits over the rail and
     a quarter bites into the bed, which is exactly where a coin disappears. */
  /* Measured off the reference: the hole sits *in the rail*, just outside the
     bed's corner, and only its inner edge bites the bed — which is why the red
     dot of the corner joint is never swallowed by it. */
  const r = 4.6 * l.scale;
  const inx = x === 0 ? 1 : -1;
  const iny = y === 0 ? 1 : -1;
  /* The reference drills the hole 10 units out into the rail, clear of the bed.
     That reads beautifully and lies about the game: the simulation swallows a
     coin when its centre comes within `POCKET_R` of the corner, so a hole that
     far out would have coins vanishing a hole's width short of it. Pulled in to
     4.6 units the hole still sits mostly in the relief but its lip reaches the
     corner, which is where the coin actually dies. */
  /* The hole is centred just outside the bed's corner and straddles it, because
     that is where the simulation actually kills a coin: its centre within
     `POCKET_R` of the corner. A hole drawn wholly in the rail — which is where a
     printer's board puts it — looks right and lies: coins would vanish short of
     it. Straddling, the death zone is inside the black. */
  const cxp = px(l, x) - inx * 1.5 * l.scale;
  const cyp = px(l, y) - iny * 1.5 * l.scale;
  const facing = Math.atan2(iny, inx);

  // the shadow the lip throws onto the bed
  const spill = ctx.createRadialGradient(cxp, cyp, r * 0.98, cxp, cyp, r * 1.9);
  spill.addColorStop(0, 'rgba(54,32,10,.11)');
  spill.addColorStop(1, 'rgba(54,32,10,0)');
  ctx.fillStyle = spill;
  ctx.beginPath(); ctx.arc(cxp, cyp, r * 1.22, 0, Math.PI * 2); ctx.fill();

  // the hole: black, with the faintest warmth at the far wall
  const hole = ctx.createRadialGradient(cxp + inx * r * 0.3, cyp + iny * r * 0.3, r * 0.05, cxp, cyp, r);
  hole.addColorStop(0, '#060504');
  hole.addColorStop(0.62, '#100b06');
  hole.addColorStop(0.92, '#221507');
  hole.addColorStop(1, '#33200e');
  ctx.fillStyle = hole;
  ctx.beginPath(); ctx.arc(cxp, cyp, r, 0, Math.PI * 2); ctx.fill();

  // the hard lip, lit on the arc facing the play and dark behind it
  /* A hole in wood has a soft dark rim where the drill tore the grain, and only
     the thinnest catch of light on the edge facing the lamp — anything brighter
     and it becomes a metal socket. */
  const rim = ctx.createRadialGradient(cxp, cyp, r * 0.965, cxp, cyp, r * 1.035);
  rim.addColorStop(0, 'rgba(18,9,2,.65)');
  rim.addColorStop(0.5, 'rgba(18,9,2,.3)');
  rim.addColorStop(1, 'rgba(18,9,2,0)');
  ctx.fillStyle = rim;
  ctx.beginPath(); ctx.arc(cxp, cyp, r * 1.035, 0, Math.PI * 2); ctx.fill();
  ctx.lineWidth = Math.max(0.8, r * 0.03);
  ctx.strokeStyle = 'rgba(255,238,206,.09)';
  ctx.beginPath(); ctx.arc(cxp, cyp, r * 1.0, facing - 0.5, facing + 0.5); ctx.stroke();
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
