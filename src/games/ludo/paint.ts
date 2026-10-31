/**
 * Ludo, painted — properly.
 *
 * The board is expensive: a veneered walnut frame with a brass inlay, a marble
 * bed, sixty-four tiles with their own lighting, embossed yards, a gilt star in
 * the middle. None of that changes while a token hops, so it is painted once into
 * an offscreen canvas and blitted every frame. Only the pieces move on top.
 *
 * Materials come in two flavours. Where a generated texture exists (`materials.ts`)
 * it is used; where it does not — or has not arrived yet — the gradients that were
 * here first still paint a credible board. Both paths draw the same furniture in
 * the same places, so the board does not jump when the textures land.
 *
 * Everything is in squares (the 15×15 grid) and `Layout` turns a square into
 * pixels. One function, `place`, is the only place that multiplies by the cell
 * size.
 */
import { HOME_LANES, RING, SAFE, START, YARD_CORNER } from './track';
import { material } from './materials';

export interface Layout { size: number; pad: number; cell: number; ox: number; oy: number }

export const place = (l: Layout, gx: number) => l.ox + gx * l.cell;

export function boardLayout(size: number): Layout {
  /* A real board has a proper frame: the playing field fills most of the object,
     with a band of wood around it and a hairline of brass between the two. */
  const pad = size * 0.088;
  const inner = size - pad * 2;
  return { size, pad, cell: inner / 15, ox: pad, oy: pad };
}

export interface SeatPaint {
  /** what the player is called: "Blue", "Red" */
  name: string;
  light: string;
  mid: string;
  deep: string;
  glow: string;
  ink: string;
  /** the image key for this seat's pawn */
  pawn: 'pawn-blue' | 'pawn-red';
}

export const SEAT_PAINT: SeatPaint[] = [
  { name: 'Blue', light: '#9dc0ea', mid: '#2f5fae', deep: '#0d1f42', glow: '#7fb0ff', ink: '#081428', pawn: 'pawn-blue' },
  { name: 'Amber', light: '#f0c25c', mid: '#c07f16', deep: '#4a3005', glow: '#ffd27b', ink: '#2a1a03', pawn: 'pawn-red' },
  { name: 'Rose', light: '#f0948c', mid: '#bd3529', deep: '#520b0e', glow: '#ff7b6b', ink: '#320306', pawn: 'pawn-red' },
  { name: 'Green', light: '#7dc47a', mid: '#2c6b3a', deep: '#0a2612', glow: '#7fd07f', ink: '#062412', pawn: 'pawn-blue' },
];

const GOLD = '#b98f2e';
const GOLD_LIGHT = '#e8cf8c';
const GOLD_DARK = '#6f5313';

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

function starPath(ctx: CanvasRenderingContext2D, cx: number, cy: number, outer: number, inner = outer * 0.44) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = (Math.PI / 5) * i - Math.PI / 2;
    const r = i % 2 === 0 ? outer : inner;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

/** Tile one image across a box, keeping the aspect ratio of the source. */
function fillPattern(ctx: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, w: number, h: number, scale = 1) {
  const pattern = ctx.createPattern(img, 'repeat');
  if (!pattern) return false;
  const m = new DOMMatrix();
  const s = (scale * Math.max(w, h)) / Math.max(img.naturalWidth, img.naturalHeight);
  m.a = s; m.d = s;
  pattern.setTransform(m);
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.fillStyle = pattern;
  ctx.fillRect(x, y, w, h);
  ctx.restore();
  return true;
}

/** A brass line: bright on the top-left, dim on the bottom-right. */
function brassStroke(ctx: CanvasRenderingContext2D, path: () => void, width: number, span: number) {
  ctx.save();
  ctx.lineWidth = width;
  const g = ctx.createLinearGradient(0, 0, span, span);
  g.addColorStop(0, GOLD_LIGHT);
  g.addColorStop(0.4, GOLD);
  g.addColorStop(1, GOLD_DARK);
  ctx.strokeStyle = g;
  path();
  ctx.stroke();
  ctx.restore();
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
  const { size } = l;
  /* Every seat's colour is on the board whether or not that seat is occupied:
     a printed board has four colours on it, and washing two of them out is what
     made the first version look half-finished. */
  const paintSeat = (seat: number) => paints[seat] ?? SEAT_PAINT[seat];
  const wood = material('wood');
  const ivory = material('ivory');

  /* --- the table the board sits on ------------------------------------ */
  const velvet = material('velvet');
  if (velvet) {
    fillPattern(ctx, velvet, 0, 0, size, size, 1.4);
    ctx.save();
    const shade = ctx.createRadialGradient(size / 2, size * 0.4, size * 0.2, size / 2, size / 2, size * 0.78);
    shade.addColorStop(0, 'rgba(10,22,40,0)');
    shade.addColorStop(1, 'rgba(3,8,18,.78)');
    ctx.fillStyle = shade;
    ctx.fillRect(0, 0, size, size);
    ctx.restore();
  } else {
    const bg = ctx.createRadialGradient(size * 0.45, size * 0.36, size * 0.08, size * 0.5, size * 0.5, size * 0.8);
    bg.addColorStop(0, '#24405f');
    bg.addColorStop(0.6, '#142639');
    bg.addColorStop(1, '#0a141f');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, size, size);
  }

  /* the frame: an outer shadow line, the walnut band, then the brass inlay */
  const frame = l.pad * 0.5;
  const radius = size * 0.022;

  /* --- the frame: veneered walnut, brass inlay, mitred corners -------- */
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,.75)';
  ctx.shadowBlur = size * 0.045;
  ctx.shadowOffsetY = size * 0.012;
  roundRect(ctx, frame, frame, size - frame * 2, size - frame * 2, radius);
  ctx.fillStyle = '#2a1a10';
  ctx.fill();
  ctx.restore();

  ctx.save();
  roundRect(ctx, frame, frame, size - frame * 2, size - frame * 2, radius);
  ctx.clip();
  if (wood) {
    fillPattern(ctx, wood, frame, frame, size - frame * 2, size - frame * 2, 0.55);
    // darken the corners so the frame reads as four pieces of wood meeting
    const vig = ctx.createRadialGradient(size / 2, size / 2, size * 0.3, size / 2, size / 2, size * 0.74);
    vig.addColorStop(0, 'rgba(20,10,4,0)');
    vig.addColorStop(1, 'rgba(20,10,4,.5)');
    ctx.fillStyle = vig;
    ctx.fillRect(frame, frame, size - frame * 2, size - frame * 2);
  } else {
    const g = ctx.createLinearGradient(0, frame, size, size - frame);
    g.addColorStop(0, '#8b5a2b');
    g.addColorStop(0.25, '#6a3f1e');
    g.addColorStop(0.55, '#8a5a2c');
    g.addColorStop(0.8, '#5c3617');
    g.addColorStop(1, '#40240f');
    ctx.fillStyle = g;
    ctx.fillRect(frame, frame, size - frame * 2, size - frame * 2);
  }
  ctx.restore();

  // mitre seams at the corners
  ctx.save();
  ctx.strokeStyle = 'rgba(24,12,4,.5)';
  ctx.lineWidth = Math.max(1, size * 0.0026);
  for (const [sx, sy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]] as const) {
    const x0 = sx > 0 ? frame : size - frame;
    const y0 = sy > 0 ? frame : size - frame;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x0 + sx * frame * 0.62, y0 + sy * frame * 0.62);
    ctx.stroke();
  }
  ctx.restore();

  // brass pin in each corner of the frame
  for (const [cx, cy] of [[frame * 1.55, frame * 1.55], [size - frame * 1.55, frame * 1.55], [frame * 1.55, size - frame * 1.55], [size - frame * 1.55, size - frame * 1.55]]) {
    const r = size * 0.0055;
    const pin = ctx.createRadialGradient(cx - r * 0.4, cy - r * 0.4, 0, cx, cy, r);
    pin.addColorStop(0, '#fff6d8');
    pin.addColorStop(0.55, GOLD);
    pin.addColorStop(1, '#6d4f10');
    ctx.fillStyle = pin;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
  }

  /* --- brass inlay, both sides of the walnut band -------------------- */
  brassStroke(ctx, () => roundRect(ctx, frame + size * 0.008, frame + size * 0.008, size - frame * 2 - size * 0.016, size - frame * 2 - size * 0.016, radius), Math.max(1, size * 0.0035), size);
  brassStroke(ctx, () => roundRect(ctx, l.pad - size * 0.007, l.pad - size * 0.007, (size - l.pad * 2) + size * 0.014, (size - l.pad * 2) + size * 0.014, size * 0.01), Math.max(1, size * 0.0035), size);

  /* --- the bed ------------------------------------------------------- */
  const bedW = size - l.pad * 2;
  ctx.save();
  roundRect(ctx, l.pad, l.pad, bedW, bedW, size * 0.008);
  ctx.fillStyle = '#f6ecd8';
  ctx.fill();
  ctx.restore();
  if (ivory) {
    fillPattern(ctx, ivory, l.pad, l.pad, bedW, bedW, 0.9);
    // keep the marble pale so tiles read against it
    ctx.save();
    roundRect(ctx, l.pad, l.pad, bedW, bedW, size * 0.008);
    ctx.clip();
    ctx.fillStyle = 'rgba(255,248,230,.5)';
    ctx.fillRect(l.pad, l.pad, bedW, bedW);
    ctx.restore();
  }
  // a soft shadow from the frame onto the bed
  ctx.save();
  roundRect(ctx, l.pad, l.pad, bedW, bedW, size * 0.008);
  ctx.clip();
  const inner = ctx.createLinearGradient(0, l.pad, 0, l.pad + size * 0.045);
  inner.addColorStop(0, 'rgba(48,28,8,.3)');
  inner.addColorStop(1, 'rgba(48,28,8,0)');
  ctx.fillStyle = inner;
  ctx.fillRect(l.pad, l.pad, bedW, size * 0.05);
  const innerL = ctx.createLinearGradient(l.pad, 0, l.pad + size * 0.045, 0);
  innerL.addColorStop(0, 'rgba(48,28,8,.26)');
  innerL.addColorStop(1, 'rgba(48,28,8,0)');
  ctx.fillStyle = innerL;
  ctx.fillRect(l.pad, l.pad, size * 0.05, bedW);
  ctx.restore();

  /* --- the yards ------------------------------------------------------
     A printed Ludo board colours all four corners whether or not four people
     are playing — the board is the board. Painting the idle corners a washed-out
     beige made the whole thing look unfinished (and matched nothing you can buy),
     so every corner is lacquered, and the seat on turn simply glows. */
  for (let seat = 0; seat < 4; seat++) {
    const [cx, cy] = YARD_CORNER[seat];
    const p = paints[seat] ?? SEAT_PAINT[seat];
    const inset = 0.06;
    const x = place(l, cx + inset), y = place(l, cy + inset);
    const w = l.cell * (6 - inset * 2);
    const rad = l.cell * 0.16;

    ctx.save();
    ctx.shadowColor = 'rgba(30,18,6,.45)';
    ctx.shadowBlur = l.cell * 0.28;
    ctx.shadowOffsetY = l.cell * 0.07;
    roundRect(ctx, x, y, w, w, rad);
    const g = ctx.createLinearGradient(x, y, x + w, y + w);
    g.addColorStop(0, p.light);
    g.addColorStop(0.3, p.mid);
    g.addColorStop(1, p.deep);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.restore();

    // chalky lacquer: brighter along the top-left, deeper into the corner
    ctx.save();
    roundRect(ctx, x, y, w, w, rad);
    ctx.clip();
    const lacquer = ctx.createLinearGradient(x, y, x + w * 0.7, y + w * 0.8);
    lacquer.addColorStop(0, 'rgba(255,255,255,.22)');
    lacquer.addColorStop(0.45, 'rgba(255,255,255,.02)');
    lacquer.addColorStop(1, 'rgba(0,0,0,.22)');
    ctx.fillStyle = lacquer;
    ctx.fillRect(x, y, w, w);
    ctx.restore();

    // a thin ivory keyline, the way a printed board frames each yard
    ctx.strokeStyle = 'rgba(255,250,238,.5)';
    ctx.lineWidth = Math.max(0.7, l.cell * 0.03);
    roundRect(ctx, x + l.cell * 0.1, y + l.cell * 0.1, w - l.cell * 0.2, w - l.cell * 0.2, rad);
    ctx.stroke();

    /* the seat's name, printed across the top of its yard */
    ctx.save();
    ctx.globalAlpha = 0.95;
    ctx.fillStyle = 'rgba(255,252,242,.96)';
    ctx.font = `700 ${Math.round(l.cell * 0.33)}px ui-serif, Georgia, 'Times New Roman', serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.letterSpacing = `${l.cell * 0.12}px`;
    ctx.fillText(p.name.toUpperCase(), x + w / 2, y + w * 0.105);
    ctx.restore();

    /* four ivory sockets where the pawns wait — pale discs, not dark holes:
       a real yard is four white circles on colour */
    for (const [sx, sy] of [[1.75, 1.75], [4.25, 1.75], [1.75, 4.25], [4.25, 4.25]]) {
      const px2 = place(l, cx + sx), py2 = place(l, cy + sy);
      const r = l.cell * 0.52;
      ctx.save();
      ctx.shadowColor = 'rgba(20,10,2,.4)';
      ctx.shadowBlur = l.cell * 0.16;
      ctx.shadowOffsetY = l.cell * 0.04;
      const disc = ctx.createRadialGradient(px2 - r * 0.3, py2 - r * 0.36, r * 0.08, px2, py2, r);
      disc.addColorStop(0, '#fffefb');
      disc.addColorStop(0.55, '#f1e7d3');
      disc.addColorStop(0.92, '#cbb99a');
      disc.addColorStop(1, '#b7a180');
      ctx.fillStyle = disc;
      ctx.beginPath(); ctx.arc(px2, py2, r, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      // a faint inner ring, so the socket looks turned rather than printed
      ctx.strokeStyle = 'rgba(120,92,52,.22)';
      ctx.lineWidth = Math.max(0.5, l.cell * 0.02);
      ctx.beginPath(); ctx.arc(px2, py2, r * 0.72, 0, Math.PI * 2); ctx.stroke();
    }
  }

  /* --- the tiles ------------------------------------------------------ */
  const drawTile = (gx: number, gy: number, kind: 'ring' | 'lane' | 'start' | 'star', seat: number, dir = 0, override?: SeatPaint) => {
    const pad2 = l.cell * 0.045;
    const x = place(l, gx) + pad2;
    const y = place(l, gy) + pad2;
    const s = l.cell - pad2 * 2;
    const r = l.cell * 0.1;
    const p = override ?? paintSeat(seat);

    ctx.save();
    ctx.shadowColor = 'rgba(60,36,10,.3)';
    ctx.shadowBlur = l.cell * 0.1;
    ctx.shadowOffsetY = l.cell * 0.03;
    roundRect(ctx, x, y, s, s, r);
    if (kind === 'ring' || kind === 'star') {
      const g = ctx.createLinearGradient(x, y, x + s, y + s);
      g.addColorStop(0, '#fffefb');
      g.addColorStop(0.65, '#fbf5e8');
      g.addColorStop(1, '#f0e5cf');
      ctx.fillStyle = g;
    } else {
      /* A printed board's coloured square is a flat, slightly chalky lacquer, not
         a glossy gradient — the gradient is what made the first version read as
         glass. Flat fill, a subtle rounded highlight, and a band of the seat's
         colour is what a real board looks like. */
      ctx.fillStyle = p.mid;
    }
    ctx.fill();
    ctx.restore();

    if (kind !== 'ring' && kind !== 'star') {
      // chalky depth: slightly darker at the outer edge, lighter at the middle
      const face = ctx.createLinearGradient(x, y, x, y + s);
      face.addColorStop(0, 'rgba(255,255,255,.16)');
      face.addColorStop(0.55, 'rgba(255,255,255,0)');
      face.addColorStop(1, 'rgba(0,0,0,.16)');
      ctx.save();
      roundRect(ctx, x, y, s, s, r);
      ctx.clip();
      ctx.fillStyle = face;
      ctx.fillRect(x, y, s, s);
      ctx.restore();
    }

    // inner keyline, gold on the coloured tiles, sepia on the plain ones
    ctx.lineWidth = Math.max(0.5, l.cell * 0.016);
    ctx.strokeStyle = kind === 'ring' || kind === 'star' ? 'rgba(146,116,68,.34)' : 'rgba(255,238,198,.55)';
    roundRect(ctx, x, y, s, s, r);
    ctx.stroke();

    // top light
    const top = ctx.createLinearGradient(x, y, x, y + s * 0.55);
    top.addColorStop(0, 'rgba(255,255,255,.3)');
    top.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.save();
    roundRect(ctx, x, y, s, s, r);
    ctx.clip();
    ctx.fillStyle = top;
    ctx.fillRect(x, y, s, s);
    ctx.restore();

    if (kind === 'star') {
      const cx2 = x + s / 2, cy2 = y + s / 2;
      ctx.save();
      ctx.shadowColor = 'rgba(120,86,12,.55)';
      ctx.shadowBlur = l.cell * 0.12;
      starPath(ctx, cx2, cy2, l.cell * 0.28);
      const gg = ctx.createLinearGradient(cx2, cy2 - l.cell * 0.3, cx2, cy2 + l.cell * 0.3);
      gg.addColorStop(0, GOLD_LIGHT);
      gg.addColorStop(0.55, GOLD);
      gg.addColorStop(1, '#8a6a14');
      ctx.fillStyle = gg;
      ctx.fill();
      ctx.restore();
      ctx.strokeStyle = 'rgba(110,80,12,.6)';
      ctx.lineWidth = Math.max(0.5, l.cell * 0.018);
      starPath(ctx, cx2, cy2, l.cell * 0.28);
      ctx.stroke();
    }

    if (kind === 'start') {
      // a chevron pointing the way a token actually leaves this square
      const cx2 = x + s / 2, cy2 = y + s / 2;
      const k = l.cell * 0.3;
      ctx.save();
      ctx.translate(cx2, cy2);
      ctx.rotate(dir);
      ctx.globalAlpha = 0.95;
      ctx.strokeStyle = 'rgba(255,252,240,.95)';
      ctx.lineWidth = Math.max(1, l.cell * 0.075);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(-k * 0.7, -k * 0.62);
      ctx.lineTo(k * 0.35, 0);
      ctx.lineTo(-k * 0.7, k * 0.62);
      ctx.stroke();
      ctx.restore();
    }
  };

  const headingAt = (index: number) => {
    const a = RING[index];
    const b = RING[(index + 1) % RING.length];
    return Math.atan2(b[1] - a[1], b[0] - a[0]);
  };

  RING.forEach((cell, i) => {
    const seat = [0, 1, 2, 3].find((s2) => START[s2] === i);
    drawTile(cell[0], cell[1], seat !== undefined ? 'start' : SAFE.has(i) ? 'star' : 'ring', seat ?? 0, headingAt(i));
  });
  for (let seat = 0; seat < 4; seat++) {
    HOME_LANES[seat].forEach(([x, y], i) => {
      /* the lane deepens towards home, which is how a printed board draws the
         run-in: a soft colour at the mouth, near-black at the centre */
      const base = paints[seat] ?? SEAT_PAINT[seat];
      const tone: SeatPaint = i >= 3 ? { ...base, mid: base.deep, light: base.mid } : base;
      drawTile(x, y, 'lane', seat, 0, tone);
    });
  }

  /* --- the middle: four triangles meeting under a gilt star -----------
     On a printed board the centre is where the four home lanes arrive, so it is
     split into four triangles pointing inwards, each in its seat's colour, with
     the star over the join. Filling only the two *occupied* seats left two
     triangles as bare marble, which read as a mistake rather than a design. */
  const cx0 = place(l, 6), cy0 = place(l, 6), box = l.cell * 3;
  ctx.save();
  roundRect(ctx, cx0, cy0, box, box, l.cell * 0.1);
  ctx.fillStyle = '#fbf4e4';
  ctx.fill();
  ctx.restore();
  if (ivory) {
    ctx.save();
    roundRect(ctx, cx0, cy0, box, box, l.cell * 0.1);
    ctx.clip();
    fillPattern(ctx, ivory, cx0, cy0, box, box, 0.42);
    ctx.fillStyle = 'rgba(255,250,236,.55)';
    ctx.fillRect(cx0, cy0, box, box);
    ctx.restore();
  }

  const mc = { x: cx0 + box / 2, y: cy0 + box / 2 };
  const corners: [number, number][] = [
    [cx0, cy0], [cx0 + box, cy0], [cx0 + box, cy0 + box], [cx0, cy0 + box],
  ];
  /* one triangle per edge of the centre: left, top, right, bottom — matching the
     four home lanes that arrive there */
  const WEDGE: [number, number][][] = [
    [corners[0], corners[3]], // left
    [corners[0], corners[1]], // top
    [corners[1], corners[2]], // right
    [corners[3], corners[2]], // bottom
  ];
  /* lane 0 arrives from the left, 1 from the top, 2 from the right, 3 from the
     bottom, so the seat that owns each triangle is the same index */
  for (let seat = 0; seat < 4; seat++) {
    const p = paints[seat] ?? SEAT_PAINT[seat];
    const [a, b] = WEDGE[seat];
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.lineTo(mc.x, mc.y);
    ctx.closePath();
    const g = ctx.createLinearGradient(a[0], a[1], mc.x, mc.y);
    g.addColorStop(0, p.mid);
    g.addColorStop(1, p.deep);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = 'rgba(255,250,232,.7)';
    ctx.lineWidth = Math.max(0.8, l.cell * 0.028);
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(mc.x, mc.y); ctx.stroke();
  }

  // the gilt star, with a fine dark edge and a highlight along its upper arms
  ctx.save();
  ctx.shadowColor = 'rgba(60,38,6,.55)';
  ctx.shadowBlur = l.cell * 0.3;
  starPath(ctx, mc.x, mc.y, l.cell * 0.78, l.cell * 0.32);
  const gs = ctx.createLinearGradient(mc.x - l.cell * 0.5, mc.y - l.cell * 0.6, mc.x + l.cell * 0.5, mc.y + l.cell * 0.6);
  gs.addColorStop(0, '#fff0c2');
  gs.addColorStop(0.45, '#d8ae45');
  gs.addColorStop(1, '#8a6512');
  ctx.fillStyle = gs;
  ctx.fill();
  ctx.restore();
  ctx.strokeStyle = 'rgba(74,52,6,.7)';
  ctx.lineWidth = Math.max(0.8, l.cell * 0.026);
  starPath(ctx, mc.x, mc.y, l.cell * 0.78, l.cell * 0.32);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,250,226,.6)';
  ctx.lineWidth = Math.max(0.6, l.cell * 0.018);
  starPath(ctx, mc.x - l.cell * 0.02, mc.y - l.cell * 0.02, l.cell * 0.7, l.cell * 0.29);
  ctx.stroke();

  return;
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
 * One pawn.
 *
 * The artwork is a photograph: a turned, lacquered pawn with a gold crown, keyed
 * off its background and tinted per seat. A drawn marble was never going to beat
 * that, so it does not try — but if the picture has not arrived (or a browser
 * blocks it) the old painted counter is still drawn, in the same place and the
 * same size, so nothing pops.
 */
export function drawToken(ctx: CanvasRenderingContext2D, l: Layout, t: TokenDraw, paints: SeatPaint[] = SEAT_PAINT) {
  const p = paints[t.seat] ?? SEAT_PAINT[0];
  const alpha = t.alpha ?? 1;
  if (alpha <= 0.01) return;
  const lift = t.lift ?? 0;
  const scale = t.scale ?? 1;
  const x = place(l, t.gx);
  /* A piece stands *on* its square, not behind it: its foot sits low in the cell
     and its body overlaps the square above, the way a chess piece does. With the
     foot at the cell's bottom edge instead, a token on row 8 looked like it was
     standing on row 7 — which, on a board where row 7 is somebody's home lane,
     reads as a lie about the position. */
  const groundY = place(l, t.gy) + l.cell * 0.7;
  const img = material(p.pawn);

  const h = l.cell * 1.32 * scale;
  const w = h * 0.62;

  /* contact shadow — tight on the board, wide and soft in the air */
  ctx.save();
  ctx.globalAlpha = alpha;
  const spread = 1 + lift * 0.55;
  const shadow = ctx.createRadialGradient(x, groundY, l.cell * 0.03, x, groundY, l.cell * 0.36 * spread);
  shadow.addColorStop(0, `rgba(16,10,4,${0.34 - lift * 0.12})`);
  shadow.addColorStop(0.6, `rgba(16,10,4,${0.13 - lift * 0.05})`);
  shadow.addColorStop(1, 'rgba(16,10,4,0)');
  ctx.fillStyle = shadow;
  ctx.beginPath();
  ctx.ellipse(x, groundY, l.cell * 0.32 * spread, l.cell * 0.14 * spread, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  const bottom = groundY + l.cell * 0.02 - lift * l.cell * 0.55;

  if (img) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.drawImage(img, x - w / 2, bottom - h, w, h);
    ctx.restore();
  } else {
    /* the fallback counter: a domed disc in the seat's colours */
    const r = l.cell * 0.38 * scale;
    const y = bottom - r;
    const body = ctx.createRadialGradient(x - r * 0.36, y - r * 0.44, r * 0.12, x, y, r * 1.05);
    body.addColorStop(0, '#ffffff');
    body.addColorStop(0.2, p.light);
    body.addColorStop(0.62, p.mid);
    body.addColorStop(1, p.deep);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = body;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    ctx.lineWidth = Math.max(0.8, r * 0.12);
    ctx.strokeStyle = 'rgba(30,14,4,.45)';
    ctx.beginPath(); ctx.arc(x, y, r * 0.96, 0, Math.PI * 2); ctx.stroke();
    const gloss = ctx.createRadialGradient(x - r * 0.34, y - r * 0.42, 0, x - r * 0.34, y - r * 0.42, r * 0.72);
    gloss.addColorStop(0, 'rgba(255,255,255,.95)');
    gloss.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gloss;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  if (t.stack && t.stack > 1) {
    ctx.save();
    ctx.globalAlpha = alpha;
    const bx = x + w * 0.34, by = bottom - h * 0.3;
    ctx.fillStyle = 'rgba(16,10,4,.85)';
    ctx.beginPath(); ctx.arc(bx, by, l.cell * 0.17, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff6e2';
    ctx.font = `700 ${Math.round(l.cell * 0.24)}px ui-sans-serif, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(t.stack), bx, by + l.cell * 0.008);
    ctx.restore();
  }
}

/**
 * The ring drawn on a square a token could move to.
 *
 * It lies on the board — an ellipse, not a circle — because the board is a table
 * seen from above and a perfectly round ring under a piece reads as a sticker.
 */
export function drawTarget(ctx: CanvasRenderingContext2D, l: Layout, gx: number, gy: number, colour: string, pulse: number) {
  const x = place(l, gx), y = place(l, gy) + l.cell * 0.7;

  ctx.save();
  // a warm halo behind the piece, so the eye finds it before the ring
  const halo = ctx.createRadialGradient(x, y - l.cell * 0.55, 0, x, y - l.cell * 0.55, l.cell * 0.62);
  halo.addColorStop(0, colour);
  halo.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.globalAlpha = 0.3 + pulse * 0.34;
  ctx.fillStyle = halo;
  ctx.beginPath(); ctx.arc(x, y - l.cell * 0.55, l.cell * 0.62, 0, Math.PI * 2); ctx.fill();

  // and the ring at its feet, lying flat on the board
  const rx = l.cell * (0.42 + pulse * 0.03);
  ctx.globalAlpha = 0.6 + pulse * 0.4;
  ctx.strokeStyle = 'rgba(255,244,204,.98)';
  ctx.lineWidth = Math.max(1, l.cell * 0.032);
  ctx.beginPath(); ctx.ellipse(x, y, rx, rx * 0.42, 0, 0, Math.PI * 2); ctx.stroke();
  ctx.restore();
}

/** A soft halo behind the yard of whoever is on turn. */
export function drawTurnGlow(ctx: CanvasRenderingContext2D, l: Layout, seat: number, t: number, paints: SeatPaint[] = SEAT_PAINT) {
  const [cx, cy] = YARD_CORNER[seat];
  const x = place(l, cx + 3), y = place(l, cy + 3);
  const p = paints[seat] ?? SEAT_PAINT[0];
  const pulse = 0.5 + Math.sin(t / 640) * 0.5;
  ctx.save();
  const g = ctx.createRadialGradient(x, y, l.cell * 1.1, x, y, l.cell * 3.4);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(0.62, `${p.glow}${Math.round((0.06 + pulse * 0.1) * 255).toString(16).padStart(2, '0')}`);
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(x, y, l.cell * 3.4, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}
