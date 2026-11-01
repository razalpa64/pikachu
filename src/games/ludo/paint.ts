/**
 * Ludo, painted — a flat printed board.
 *
 * The board this replaced was a *table*: veneered walnut, brass inlay, marble,
 * lacquer, a gilt star. It was pretty and it was wrong — the reference board is
 * a printed sheet, and a printed sheet has no highlights in it. So this painter
 * has almost no gradients in it at all:
 *
 *   · cream paper stock, one ink (`#2e2a22`), four seat colours;
 *   · four flat corner yards, each with the creature that owns it;
 *   · ivory squares outlined in ink, exactly as a printed grid is;
 *   · a pinwheel rosette in the middle where the four lanes arrive;
 *   · motifs in the margin — flame, leaf, wave, bolt — cut from the same shapes
 *     the pieces use.
 *
 * The board is expensive and never changes while a token hops, so it is painted
 * once into an offscreen canvas and blitted every frame. Only the pieces move on
 * top.
 *
 * Coordinates: everything is in *squares* of the 15×15 grid, and `Layout` turns
 * a square into pixels. A tile with index `i` occupies `[i, i+1]`, so its centre
 * is `i + 0.5` — that is the convention the token coordinates use, and it is the
 * only place the half-square lives.
 */
import { HOME_LANES, RING, SAFE, START, YARD_CORNER } from './track';
import { material, type MaterialId } from './materials';

export interface Layout { size: number; pad: number; cell: number; ox: number; oy: number }

/** A grid coordinate (a tile's left edge, or a token's centre) in pixels. */
export const place = (l: Layout, gx: number) => l.ox + gx * l.cell;

export function boardLayout(size: number): Layout {
  /* A printed board is a sheet of card with a margin: the field fills most of
     it, a band of paper is left around for the border motifs and the rules. */
  const pad = size * 0.094;
  const inner = size - pad * 2;
  return { size, pad, cell: inner / 15, ox: pad, oy: pad };
}

/* ------------------------------------------------------------------ palette */

/** Cream stock. */
export const PAPER = '#f4ecdb';
/** One ink for every line on the board — this is what makes it read as print. */
export const INK = '#2e2a22';
/** The pale square. */
const TILE = '#f9f2e2';
/** The olive rule used in the margin. */
const RULE = '#b99f6e';

export type Glyph = 'flame' | 'leaf' | 'drop' | 'bolt';

export interface SeatPaint {
  /** what the player is called: "Blue", "Rose" */
  name: string;
  light: string;
  mid: string;
  deep: string;
  glow: string;
  ink: string;
  /** the creature printed in this seat's yard */
  creature: MaterialId;
  /** the shape printed on this seat's pieces */
  glyph: Glyph;
}

/**
 * Four colours, taken off the reference board: a deep red, a sage green, a
 * marine blue, a mustard gold. They are flat — the old set had a `light` stop
 * near white that turned every yard into a plastic gradient.
 *
 * Seat order is fixed by the rules (seat 0 is the player who opens, and the UI
 * calls them Blue), so the colours are assigned to the seats rather than to the
 * corners of the picture.
 */
export const SEAT_PAINT: SeatPaint[] = [
  { name: 'Blue', light: '#7fa3cf', mid: '#3f5f9e', deep: '#28406e', glow: '#a7c8f5', ink: '#16233c', creature: 'yard-water', glyph: 'drop' },
  { name: 'Amber', light: '#f0ca6a', mid: '#d9a832', deep: '#9c7414', glow: '#ffdd8b', ink: '#3a2a06', creature: 'yard-spark', glyph: 'bolt' },
  { name: 'Rose', light: '#d67a5f', mid: '#b0442f', deep: '#7c2c1d', glow: '#ff9c7c', ink: '#3a110a', creature: 'yard-fire', glyph: 'flame' },
  { name: 'Green', light: '#94bc96', mid: '#5d8b63', deep: '#3a5c40', glow: '#aedcb0', ink: '#17301d', creature: 'yard-leaf', glyph: 'leaf' },
];

/* ------------------------------------------------------------------ helpers */

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

/** Mix two hex colours; `t` 0 gives `a`, 1 gives `b`. */
function mix(a: string, b: string, t: number): string {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  const c = pa.map((v, i) => Math.round(v + (pb[i] - v) * t));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

function starPath(ctx: CanvasRenderingContext2D, cx: number, cy: number, outer: number, inner = outer * 0.42, points = 5) {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const a = (Math.PI / points) * i - Math.PI / 2;
    const r = i % 2 === 0 ? outer : inner;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

/**
 * The four shapes the print is built from: a flame, a leaf, a drop, a bolt.
 *
 * They are drawn on a unit square centred on the origin, `s` being the half
 * height, so the same path can be a 20 px piece emblem or a 9 px margin motif.
 */
function glyphPath(ctx: CanvasRenderingContext2D, kind: Glyph, s: number) {
  ctx.beginPath();
  if (kind === 'flame') {
    ctx.moveTo(0, s * 1.02);
    ctx.bezierCurveTo(-s * 0.72, s * 1.02, -s * 1.10, s * 0.42, -s * 0.86, -s * 0.16);
    ctx.bezierCurveTo(-s * 0.74, -s * 0.52, -s * 0.42, -s * 0.62, -s * 0.34, -s * 0.40);
    ctx.bezierCurveTo(-s * 0.26, -s * 0.86, -s * 0.02, -s * 0.96, s * 0.14, -s * 1.08);
    ctx.bezierCurveTo(s * 0.14, -s * 0.68, s * 0.52, -s * 0.58, s * 0.66, -s * 0.18);
    ctx.bezierCurveTo(s * 1.00, s * 0.42, s * 0.72, s * 1.02, 0, s * 1.02);
    ctx.closePath();
  } else if (kind === 'bolt') {
    ctx.moveTo(s * 0.30, -s * 1.02);
    ctx.lineTo(-s * 0.56, s * 0.10);
    ctx.lineTo(-s * 0.04, s * 0.10);
    ctx.lineTo(-s * 0.30, s * 1.02);
    ctx.lineTo(s * 0.58, -s * 0.16);
    ctx.lineTo(s * 0.04, -s * 0.16);
    ctx.closePath();
  } else if (kind === 'leaf') {
    ctx.moveTo(0, s * 1.04);
    ctx.bezierCurveTo(-s * 1.24, s * 0.36, -s * 1.02, -s * 0.86, 0, -s * 1.04);
    ctx.bezierCurveTo(s * 1.02, -s * 0.86, s * 1.24, s * 0.36, 0, s * 1.04);
    ctx.closePath();
  } else {
    ctx.moveTo(0, -s * 1.06);
    ctx.bezierCurveTo(s * 0.60, -s * 0.36, s * 0.94, s * 0.08, s * 0.72, s * 0.50);
    ctx.bezierCurveTo(s * 0.44, s * 0.98, -s * 0.44, s * 0.98, -s * 0.72, s * 0.50);
    ctx.bezierCurveTo(-s * 0.94, s * 0.08, -s * 0.60, -s * 0.36, 0, -s * 1.06);
    ctx.closePath();
  }
}

/** Fill and ink a glyph, the way the print does: flat colour, one thick edge. */
function drawGlyph(
  ctx: CanvasRenderingContext2D, kind: Glyph, cx: number, cy: number, s: number,
  fill: string, stroke: string, lw: number, alpha = 1,
) {
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.translate(cx, cy);
  glyphPath(ctx, kind, s);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = lw;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = stroke;
  ctx.stroke();
  if (kind === 'flame') {
    /* the printed flame has a hot core inside it */
    ctx.save();
    ctx.translate(cx, cy + s * 0.30);
    ctx.scale(0.5, 0.5);
    glyphPath(ctx, 'flame', s);
    ctx.globalAlpha *= 0.62;
    ctx.fillStyle = '#fbf6ea';
    ctx.fill();
    ctx.restore();
  }
  if (kind === 'leaf') {
    ctx.beginPath();
    ctx.moveTo(0, s * 0.86);
    ctx.quadraticCurveTo(s * 0.10, 0, 0, -s * 0.82);
    ctx.lineWidth = Math.max(0.4, lw * 0.7);
    ctx.globalAlpha *= 0.75;
    ctx.stroke();
  }
  if (kind === 'drop') {
    /* a highlight on the shoulder, so a 14px drop still reads as wet */
    ctx.beginPath();
    ctx.arc(-s * 0.30, s * 0.30, s * 0.20, Math.PI * 0.9, Math.PI * 1.9);
    ctx.lineWidth = Math.max(0.4, lw * 0.8);
    ctx.strokeStyle = 'rgba(251,246,234,.75)';
    ctx.globalAlpha *= 0.8;
    ctx.stroke();
  }
  ctx.restore();
}

/* ------------------------------------------------------------------ paper */

/**
 * The tooth of the stock: a scatter of tiny darker specks. It is deterministic,
 * so repainting the board on a resize does not make the paper crawl.
 */
function paperTooth(ctx: CanvasRenderingContext2D, l: Layout) {
  let seed = 20261101;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  ctx.save();
  ctx.fillStyle = 'rgba(120,96,60,.055)';
  const n = Math.round(l.size * 1.1);
  for (let i = 0; i < n; i++) {
    const x = rnd() * l.size;
    const y = rnd() * l.size;
    const r = 0.4 + rnd() * 0.9;
    ctx.fillRect(x, y, r, r);
  }
  ctx.restore();
}

/** A whisper of warmth at the edges, so the sheet is not a flat fill. */
function paperVignette(ctx: CanvasRenderingContext2D, l: Layout) {
  const g = ctx.createRadialGradient(l.size * 0.46, l.size * 0.42, l.size * 0.24, l.size * 0.5, l.size * 0.5, l.size * 0.78);
  g.addColorStop(0, 'rgba(120,96,60,0)');
  g.addColorStop(1, 'rgba(120,96,60,.10)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, l.size, l.size);
}

/* ------------------------------------------------------------------ margin */

/**
 * The margin: two rules and a run of motifs, one motif per side of each corner,
 * in the colour of the yard nearest it. This is the part of the reference that
 * makes it look like something off a shelf rather than a UI widget.
 */
function paintMargin(ctx: CanvasRenderingContext2D, l: Layout, paints: SeatPaint[]) {
  const { size, pad, cell } = l;
  const band = pad;
  const mid = size / 2;
  const seat = (i: number) => paints[i] ?? SEAT_PAINT[i];

  const run = (kind: Glyph, colour: string, x0: number, y0: number, len: number, across: boolean, rot: number) => {
    const n = Math.max(2, Math.min(4, Math.round(len / (cell * 1.90))));
    const gap = len / n;
    const half = Math.min(cell * 0.52, gap * 0.44, band * 0.40);
    for (let i = 0; i < n; i++) {
      const x = x0 + (across ? gap * (i + 0.5) : 0);
      const y = y0 + (across ? 0 : gap * (i + 0.5));
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rot);
      drawGlyph(ctx, kind, 0, 0, half, colour, INK, Math.max(0.6, half * 0.11), 0.94);
      ctx.restore();
    }
  };

  const lane = band * 0.70;              // the middle of the margin band
  const from = pad + cell * 0.34;        // where a run may start
  const to = mid - cell * 0.30;          // and where it must stop
  const span = Math.max(cell, to - from);

  /* the corners: flame top-left, leaf top-right, drop bottom-left, bolt bottom-right */
  const rose = seat(2), green = seat(3), blue = seat(0), amber = seat(1);

  // top edge
  run('flame', rose.mid, from, lane, span, true, 0);
  run('leaf', green.mid, mid + cell * 0.30, lane, span, true, 0);
  // bottom edge
  run('drop', blue.mid, from, size - lane, span, true, 0);
  run('bolt', amber.mid, mid + cell * 0.30, size - lane, span, true, 0);
  // left edge
  run('flame', rose.mid, lane, from, span, false, Math.PI / 2);
  run('drop', blue.mid, lane, mid + cell * 0.30, span, false, Math.PI / 2);
  // right edge
  run('leaf', green.mid, size - lane, from, span, false, -Math.PI / 2);
  run('bolt', amber.mid, size - lane, mid + cell * 0.30, span, false, -Math.PI / 2);

  /* one four-point spark in each outer corner, as the reference has */
  const spark = [[band * 0.42, band * 0.42, rose], [size - band * 0.42, band * 0.42, green], [band * 0.42, size - band * 0.42, blue], [size - band * 0.42, size - band * 0.42, amber]] as const;
  for (const [x, y, p] of spark) {
    const s = Math.min(cell * 0.22, band * 0.24);
    starPath(ctx, x, y, s, s * 0.30, 4);
    ctx.fillStyle = p.mid;
    ctx.fill();
    ctx.lineWidth = Math.max(0.4, s * 0.22);
    ctx.strokeStyle = INK;
    ctx.stroke();
  }
}

/* ------------------------------------------------------------------ the board */

export function buildBoard(size: number, active: number[], dpr: number, seatColours?: SeatPaint[]): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(size * dpr);
  canvas.height = Math.round(size * dpr);
  const ctx = canvas.getContext('2d')!;
  ctx.scale(dpr, dpr);
  paintBoard(ctx, boardLayout(size), active, seatColours ?? SEAT_PAINT);
  return canvas;
}

export function paintBoard(ctx: CanvasRenderingContext2D, l: Layout, active: number[], paints: SeatPaint[]) {
  const { size, cell } = l;
  const field = l.pad;
  const fieldW = size - field * 2;
  const seat = (i: number) => paints[i] ?? SEAT_PAINT[i];

  /* --- the stock ------------------------------------------------------ */
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, size, size);
  paperTooth(ctx, l);
  paperVignette(ctx, l);

  /* --- the rules around the margin ------------------------------------ */
  ctx.save();
  ctx.strokeStyle = INK;
  ctx.lineWidth = Math.max(1, size * 0.0032);
  ctx.strokeRect(field * 0.26, field * 0.26, size - field * 0.52, size - field * 0.52);
  ctx.strokeStyle = RULE;
  ctx.lineWidth = Math.max(0.7, size * 0.0016);
  ctx.strokeRect(field * 0.46, field * 0.46, size - field * 0.92, size - field * 0.92);
  ctx.restore();

  paintMargin(ctx, l, paints);

  /* --- the field ------------------------------------------------------ */
  ctx.fillStyle = mix(PAPER, '#ffffff', 0.35);
  ctx.fillRect(field, field, fieldW, fieldW);

  /* --- the yards ------------------------------------------------------
     Four flat corners of colour, all four printed whether or not four people
     are playing — the board is the board. The seat on turn is marked live by
     `drawTurnGlow`, not by washing the other three out. */
  for (let s = 0; s < 4; s++) {
    const [cx, cy] = YARD_CORNER[s];
    const p = seat(s);
    const x = place(l, cx), y = place(l, cy), w = cell * 6;

    ctx.fillStyle = p.mid;
    ctx.fillRect(x, y, w, w);

    /* a cream keyline just inside the colour, with a bracket in each corner */
    const k = cell * 0.26;
    ctx.save();
    ctx.strokeStyle = 'rgba(251,246,234,.60)';
    ctx.lineWidth = Math.max(0.8, cell * 0.045);
    ctx.strokeRect(x + k, y + k, w - k * 2, w - k * 2);

    /* a bracket in each corner of the keyline, as the reference has */
    const b = cell * 0.42;
    const k2 = k + cell * 0.14;
    ctx.strokeStyle = 'rgba(251,246,234,.42)';
    ctx.lineWidth = Math.max(0.7, cell * 0.038);
    for (const [sx, sy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]] as const) {
      const px = sx > 0 ? x + k2 : x + w - k2;
      const py = sy > 0 ? y + k2 : y + w - k2;
      ctx.beginPath();
      ctx.moveTo(px + sx * b, py);
      ctx.lineTo(px, py);
      ctx.lineTo(px, py + sy * b);
      ctx.stroke();
    }
    ctx.restore();

    /* the creature: as big as it can be without touching the keyline */
    const art = material(p.creature);
    /* the figures are trimmed to their own outline, so they fill the box they
       are given — a little smaller than the keyline keeps the frame readable */
    const as = w * 0.72;
    if (art) {
      ctx.save();
      ctx.globalAlpha = 0.98;
      ctx.drawImage(art, x + (w - as) / 2, y + (w - as) / 2 + cell * 0.02, as, as);
      ctx.restore();
    } else {
      /* before the picture lands — or if it never does — an emblem, printed in
         the same place at the same size, so nothing pops when it arrives */
      drawGlyph(ctx, p.glyph, x + w / 2, y + w / 2, w * 0.24, 'rgba(251,246,234,.30)', 'rgba(251,246,234,.45)', Math.max(0.8, cell * 0.05));
    }

    /* two printed sparks, in the gaps the sockets leave */
    for (const [sx, sy, k] of [[3, 0.95, 0.9], [3, 5.05, 1.15]] as const) {
      const px = place(l, cx + sx), py = place(l, cy + sy);
      const sz = cell * 0.20 * k;
      ctx.save();
      ctx.globalAlpha = 0.55;
      starPath(ctx, px, py, sz, sz * 0.32, 4);
      ctx.fillStyle = mix(p.mid, TILE, 0.72);
      ctx.fill();
      ctx.restore();
    }

    /* four sockets where the pieces wait — pushed out to the corners, so the
       creature in the middle stays whole */
    for (const [sx, sy] of [[1.25, 1.25], [4.75, 1.25], [1.25, 4.75], [4.75, 4.75]]) {
      const px = place(l, cx + sx), py = place(l, cy + sy);
      const r = cell * 0.38;
      ctx.save();
      /* The socket is a *spot*, not a piece: a pale wash and an ink ring, with
         a dot in the middle. A piece sitting on it is a cream disc with a
         coloured rim, so the two never read as the same thing. */
      ctx.globalAlpha = 0.78;
      ctx.lineWidth = Math.max(0.9, cell * 0.055);
      ctx.strokeStyle = INK;
      ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 0.50;
      ctx.fillStyle = INK;
      ctx.beginPath(); ctx.arc(px, py, r * 0.15, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
  }

  /* --- the squares ----------------------------------------------------
     Ivory stock, one ink edge. The edges of neighbouring squares are drawn
     separately and nearly touch, which is how a printed grid reads: a dark
     lattice with cream in the holes. */
  const drawTile = (gx: number, gy: number, kind: 'ring' | 'safe' | 'start' | 'lane', s: number, dir = 0) => {
    const p = seat(s);
    const x = place(l, gx), y = place(l, gy);

    /* Squares butt up against each other and their edges are the same line: the
       half-width of each stroke overlaps its neighbour's, so the grid reads as
       one ink lattice with cream in the holes — which is what a printed board
       actually looks like. */
    ctx.fillStyle = kind === 'lane' || kind === 'start' ? p.mid : TILE;
    ctx.fillRect(x, y, cell, cell);
    ctx.lineWidth = Math.max(1, cell * 0.052);
    ctx.strokeStyle = INK;
    ctx.strokeRect(x, y, cell, cell);

    if (kind === 'safe') {
      /* a flat ink star: the printed board's safe square */
      starPath(ctx, x + cell / 2, y + cell / 2, cell * 0.26, cell * 0.11);
      ctx.fillStyle = INK;
      ctx.fill();
    }

    if (kind === 'start') {
      /* a chevron pointing the way a piece actually leaves this square */
      const k = cell * 0.30;
      ctx.save();
      ctx.translate(x + cell / 2, y + cell / 2);
      ctx.rotate(dir);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      const arrow = () => {
        ctx.beginPath();
        ctx.moveTo(-k * 0.66, -k * 0.62);
        ctx.lineTo(k * 0.40, 0);
        ctx.lineTo(-k * 0.66, k * 0.62);
      };
      ctx.strokeStyle = INK;
      ctx.lineWidth = Math.max(1.2, cell * 0.13);
      arrow();
      ctx.stroke();
      ctx.strokeStyle = TILE;
      ctx.lineWidth = Math.max(0.9, cell * 0.07);
      arrow();
      ctx.stroke();
      ctx.restore();
    }
  };

  const headingAt = (index: number) => {
    const a = RING[index];
    const b = RING[(index + 1) % RING.length];
    return Math.atan2(b[1] - a[1], b[0] - a[0]);
  };

  RING.forEach(([x, y], i) => {
    const start = [0, 1, 2, 3].find((s) => START[s] === i);
    drawTile(x, y, start !== undefined ? 'start' : SAFE.has(i) ? 'safe' : 'ring', start ?? 0, headingAt(i));
  });
  for (let s = 0; s < 4; s++) {
    /* the lane is one flat colour from the mouth to the rosette — a printed
       board does not shade a run-in, it just colours it */
    for (const [x, y] of HOME_LANES[s]) drawTile(x, y, 'lane', s);
  }

  /* --- the rosette -----------------------------------------------------
     Three squares by three, divided into the four quadrants that the yards sit
     in, with an inscribed circle carrying an eight-slice pinwheel and a turned
     hub. The corners of the quadrants — the spandrels outside the circle — are
     the only part of the colour you see, exactly as on the reference. */
  const ox = place(l, 6), oy = place(l, 6), box = cell * 3;
  ctx.save();
  ctx.beginPath();
  ctx.rect(ox, oy, box, box);
  ctx.clip();
  for (let q = 0; q < 4; q++) {
    const left = q === 0 || q === 3;
    const top = q === 0 || q === 1;
    ctx.fillStyle = seat(q).mid;
    ctx.fillRect(ox + (left ? 0 : box / 2), oy + (top ? 0 : box / 2), box / 2, box / 2);
  }
  ctx.restore();

  const c = { x: place(l, 7.5), y: place(l, 7.5) };
  const R = cell * 1.5;

  ctx.save();
  ctx.beginPath();
  ctx.arc(c.x, c.y, R, 0, Math.PI * 2);
  ctx.clip();
  const slices = 8;
  for (let k = 0; k < slices; k++) {
    const a0 = (k * Math.PI * 2) / slices - Math.PI / 2 - Math.PI / 8;
    const a1 = a0 + (Math.PI * 2) / slices;
    ctx.beginPath();
    ctx.moveTo(c.x, c.y);
    ctx.arc(c.x, c.y, R, a0, a1);
    ctx.closePath();
    /* the four colours twice each, so no two neighbours match — a pinwheel, not
       four quadrants with spokes drawn over them */
    ctx.fillStyle = seat(k % 4).mid;
    ctx.fill();
  }
  /* the spokes of the pinwheel, one ink line each */
  ctx.strokeStyle = INK;
  ctx.lineWidth = Math.max(0.8, cell * 0.038);
  for (let k = 0; k < slices; k++) {
    const a = (k * Math.PI * 2) / slices - Math.PI / 2 - Math.PI / 8;
    ctx.beginPath();
    ctx.moveTo(c.x, c.y);
    ctx.lineTo(c.x + Math.cos(a) * R, c.y + Math.sin(a) * R);
    ctx.stroke();
  }
  ctx.restore();

  /* the rim of the rosette, in the same heavy ink as the grid */
  ctx.strokeStyle = INK;
  ctx.lineWidth = Math.max(1.2, cell * 0.085);
  ctx.beginPath();
  ctx.arc(c.x, c.y, R, 0, Math.PI * 2);
  ctx.stroke();

  /* a cream hairline just inside the rim — the printed board's second ring */
  ctx.strokeStyle = mix(TILE, INK, 0.15);
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = Math.max(0.6, cell * 0.022);
  ctx.beginPath();
  ctx.arc(c.x, c.y, R * 0.90, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 1;

  /* the hub: a cream boss, a sage ring, a hole */
  const hub = cell * 0.46;
  ctx.fillStyle = TILE;
  ctx.beginPath(); ctx.arc(c.x, c.y, hub, 0, Math.PI * 2); ctx.fill();
  ctx.lineWidth = Math.max(0.9, cell * 0.05);
  ctx.strokeStyle = INK;
  ctx.stroke();
  ctx.fillStyle = '#9a9464';
  ctx.beginPath(); ctx.arc(c.x, c.y, hub * 0.66, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = mix(INK, '#9a9464', 0.2);
  ctx.lineWidth = Math.max(0.6, cell * 0.026);
  ctx.stroke();
  ctx.fillStyle = TILE;
  ctx.beginPath(); ctx.arc(c.x, c.y, hub * 0.30, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = INK;
  ctx.lineWidth = Math.max(0.5, cell * 0.022);
  ctx.stroke();

  /* --- the frame of the field, drawn last so it sits over every tile --- */
  ctx.save();
  ctx.strokeStyle = INK;
  ctx.lineWidth = Math.max(2, cell * 0.13);
  ctx.strokeRect(field, field, fieldW, fieldW);
  ctx.restore();

  /* `active` is kept in the signature: the Board re-paints when the seats
     change, and the four corners are printed either way. */
  void active;
}

/* ------------------------------------------------------------------ pieces */

export interface TokenDraw {
  gx: number;
  gy: number;
  seat: number;
  /** 0…1 while hopping */
  lift?: number;
  scale?: number;
  alpha?: number;
  stack?: number;
}

/**
 * One piece.
 *
 * The sheet this is modelled on prints round tokens: a flat disc in the seat's
 * colour, a heavy ink edge, and an emblem in cream. Nothing is glossed — the
 * only depth is a hard shadow printed under the disc, which is what makes a
 * piece read as *on* the board rather than painted into it.
 */
export function drawToken(ctx: CanvasRenderingContext2D, l: Layout, t: TokenDraw, paints: SeatPaint[] = SEAT_PAINT) {
  const p = paints[t.seat] ?? SEAT_PAINT[0];
  const alpha = t.alpha ?? 1;
  if (alpha <= 0.01) return;
  const lift = t.lift ?? 0;
  const scale = t.scale ?? 1;
  const cx = place(l, t.gx);
  const cy = place(l, t.gy) - lift * l.cell * 0.34;
  const r = l.cell * 0.385 * scale * (1 + lift * 0.10);

  /* the shadow stays on the board while the piece rises off it */
  ctx.save();
  ctx.globalAlpha = alpha * Math.max(0.06, 0.22 - lift * 0.06);
  ctx.fillStyle = INK;
  ctx.beginPath();
  ctx.ellipse(place(l, t.gx) + r * 0.12, place(l, t.gy) + l.cell * 0.22, r * (1 + lift * 0.35), r * (0.40 + lift * 0.2), 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  /* The disc: a ring of the seat's colour around a cream face, the emblem in
     the middle. A piece has to be legible on a cream square *and* on its own
     coloured yard, and a disc of one colour can only manage one of those. */
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = p.mid;
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();

  ctx.fillStyle = TILE;
  ctx.beginPath(); ctx.arc(cx, cy, r * 0.70, 0, Math.PI * 2); ctx.fill();

  /* the ink edges — the heavy one outside, a hairline round the face */
  ctx.lineWidth = Math.max(1, r * 0.17);
  ctx.strokeStyle = INK;
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
  ctx.lineWidth = Math.max(0.6, r * 0.07);
  ctx.beginPath(); ctx.arc(cx, cy, r * 0.70, 0, Math.PI * 2); ctx.stroke();

  /* the emblem, in the seat's own ink */
  drawGlyph(ctx, p.glyph, cx, cy, r * 0.46, p.mid, p.ink, Math.max(0.7, r * 0.08));
  ctx.restore();

  if (t.stack && t.stack > 1) {
    ctx.save();
    ctx.globalAlpha = alpha;
    const bx = cx + r * 0.92, by = cy - r * 0.88;
    const br = l.cell * 0.20;
    ctx.fillStyle = TILE;
    ctx.beginPath(); ctx.arc(bx, by, br, 0, Math.PI * 2); ctx.fill();
    ctx.lineWidth = Math.max(0.8, br * 0.22);
    ctx.strokeStyle = INK;
    ctx.stroke();
    ctx.fillStyle = INK;
    ctx.font = `700 ${Math.round(br * 1.15)}px ui-sans-serif, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(t.stack), bx, by + br * 0.04);
    ctx.restore();
  }
}

/**
 * The marker on a square a piece could move to.
 *
 * Drawn as an ink ring with a cream ring inside it, so it is visible on the pale
 * squares *and* on a coloured lane — a single-colour ring always disappears on
 * one of the two.
 */
export function drawTarget(ctx: CanvasRenderingContext2D, l: Layout, gx: number, gy: number, colour: string, pulse: number) {
  const x = place(l, gx), y = place(l, gy);
  const r = l.cell * (0.47 + pulse * 0.03);

  ctx.save();
  /* a warm halo, so the eye finds the piece before it reads the ring */
  const halo = ctx.createRadialGradient(x, y, l.cell * 0.1, x, y, l.cell * 0.7);
  halo.addColorStop(0, colour);
  halo.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.globalAlpha = 0.22 + pulse * 0.30;
  ctx.fillStyle = halo;
  ctx.beginPath(); ctx.arc(x, y, l.cell * 0.7, 0, Math.PI * 2); ctx.fill();

  ctx.globalAlpha = 0.55 + pulse * 0.35;
  ctx.strokeStyle = INK;
  ctx.lineWidth = Math.max(1, l.cell * 0.055);
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();

  ctx.globalAlpha = 0.45 + pulse * 0.5;
  ctx.strokeStyle = TILE;
  ctx.lineWidth = Math.max(0.8, l.cell * 0.032);
  ctx.beginPath(); ctx.arc(x, y, r * 0.82, 0, Math.PI * 2); ctx.stroke();
  ctx.restore();
}

/**
 * The yard of whoever is on turn, marked.
 *
 * A printed board has no spotlight, so this is a cream keyline drawn just inside
 * the yard's own one, breathing slowly. It reads at a glance without pretending
 * the paper is lit.
 */
export function drawTurnGlow(ctx: CanvasRenderingContext2D, l: Layout, seat: number, t: number, paints: SeatPaint[] = SEAT_PAINT) {
  const [cx, cy] = YARD_CORNER[seat];
  const p = paints[seat] ?? SEAT_PAINT[0];
  const pulse = 0.5 + Math.sin(t / 640) * 0.5;
  const w = l.cell * 6;
  const x = place(l, cx), y = place(l, cy);

  ctx.save();
  /* a soft wash of the seat's own glow, kept well under the ink */
  const g = ctx.createRadialGradient(x + w / 2, y + w / 2, w * 0.1, x + w / 2, y + w / 2, w * 0.75);
  g.addColorStop(0, `${p.glow}${Math.round((0.10 + pulse * 0.14) * 255).toString(16).padStart(2, '0')}`);
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, w);

  const k = l.cell * 0.14;
  ctx.globalAlpha = 0.45 + pulse * 0.5;
  ctx.strokeStyle = TILE;
  ctx.lineWidth = Math.max(1.2, l.cell * 0.09);
  roundRect(ctx, x + k, y + k, w - k * 2, w - k * 2, l.cell * 0.12);
  ctx.stroke();
  ctx.restore();
}
