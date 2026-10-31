/**
 * Ludo, painted.
 *
 * The board is expensive to draw — carved frame, lacquered surface, embossed
 * yards, four wedges meeting in the middle, sixty-odd tiles with their own
 * lighting — and none of that changes while a token hops. So it is drawn once
 * into an offscreen canvas and blitted every frame; only the tokens move on top.
 * That is what buys the detail: the grain, the bevels and the soft shadows cost
 * nothing per frame.
 *
 * Everything is in squares (the 15×15 grid), and `Layout` turns a square
 * coordinate into pixels. One function, `place`, is the only place that multiplies
 * by the cell size, so the whole board scales without a single magic number.
 */
import { HOME_LANES, RING, SAFE, START, YARD_CORNER } from './track';

export interface Layout { size: number; pad: number; cell: number; ox: number; oy: number }

export const place = (l: Layout, gx: number) => l.ox + gx * l.cell;

export function boardLayout(size: number): Layout {
  const pad = size * 0.035;
  const inner = size - pad * 2;
  return { size, pad, cell: inner / 15, ox: pad, oy: pad };
}

export interface SeatPaint {
  /** the colour the player is called by: "Gold", "Rose" */
  name: string;
  light: string;
  mid: string;
  deep: string;
  glow: string;
  ink: string;
}

export const SEAT_PAINT: SeatPaint[] = [
  { name: 'Gold', light: '#ffe08a', mid: '#efa11c', deep: '#8a4a05', glow: '#ffd25c', ink: '#5b3103' },
  { name: 'Rose', light: '#ffb3c6', mid: '#e0456b', deep: '#7d0e2c', glow: '#ff7fa0', ink: '#4d0519' },
  { name: 'Rose', light: '#ffb3c6', mid: '#e0456b', deep: '#7d0e2c', glow: '#ff7fa0', ink: '#4d0519' },
  { name: 'Leaf', light: '#b7e7a1', mid: '#4f9b52', deep: '#1d4a2c', glow: '#8cd47a', ink: '#10331c' },
];

/** Seats that are not being played are painted as quiet, unpainted wood. */
const EMPTY: SeatPaint = { name: '', light: '#f0e4cd', mid: '#dccaa8', deep: '#b7a077', glow: '#d8c3a3', ink: '#6b563b' };

const paintFor = (seat: number, active: number[]): SeatPaint =>
  active.includes(seat) ? SEAT_PAINT[seat] : EMPTY;

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

/** A five-point star, used for the safe squares. */
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

function noise(ctx: CanvasRenderingContext2D, w: number, h: number, seed: number, alpha: number, count: number) {
  // deterministic speckle, so the board does not shimmer between rebuilds
  let s = seed >>> 0;
  const rnd = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
  ctx.save();
  for (let i = 0; i < count; i++) {
    const x = rnd() * w, y = rnd() * h;
    const a = rnd() * alpha;
    ctx.fillStyle = rnd() > 0.5 ? `rgba(255,255,255,${a})` : `rgba(70,45,15,${a})`;
    ctx.fillRect(x, y, 1.1, 1.1);
  }
  ctx.restore();
}

/* ------------------------------------------------------------------ the board */

/**
 * The whole static board, painted once. Returns a canvas the caller blits.
 * `active` lists the seats in play, so an empty corner is visibly empty.
 */
export function buildBoard(size: number, active: number[], dpr: number, seatColours?: SeatPaint[]): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(size * dpr);
  canvas.height = Math.round(size * dpr);
  const ctx = canvas.getContext('2d')!;
  ctx.scale(dpr, dpr);
  const l = boardLayout(size);
  const paints = (seatColours ?? SEAT_PAINT);

  const paintSeat = (seat: number) => (active.includes(seat) ? (paints[seat] ?? SEAT_PAINT[seat]) : EMPTY);

  /* --- backdrop ------------------------------------------------------- */
  /* The outer band is the table's shadow, not a black border: a warm walnut
     that darkens towards the corners, so the frame sits *in* the scene. */
  const bg = ctx.createRadialGradient(size * 0.42, size * 0.36, size * 0.1, size * 0.5, size * 0.5, size * 0.78);
  bg.addColorStop(0, '#6b4522');
  bg.addColorStop(0.65, '#4a2e15');
  bg.addColorStop(1, '#2a1a0c');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, size, size);
  // and a soft contact shadow just outside the frame
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,.55)';
  ctx.shadowBlur = size * 0.02;
  ctx.strokeStyle = 'rgba(0,0,0,.35)';
  ctx.lineWidth = size * 0.01;
  roundRect(ctx, size * 0.012, size * 0.012, size * 0.976, size * 0.976, size * 0.034);
  ctx.stroke();
  ctx.restore();

  /* --- carved frame --------------------------------------------------- */
  const frame = l.pad * 0.62;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,.55)';
  ctx.shadowBlur = size * 0.035;
  ctx.shadowOffsetY = size * 0.012;
  roundRect(ctx, frame, frame, size - frame * 2, size - frame * 2, size * 0.028);
  const wood = ctx.createLinearGradient(0, frame, size, size - frame);
  wood.addColorStop(0, '#c08a45');
  wood.addColorStop(0.18, '#a5712f');
  wood.addColorStop(0.42, '#7d4f1e');
  wood.addColorStop(0.7, '#9b6a2c');
  wood.addColorStop(1, '#6a4318');
  ctx.fillStyle = wood;
  ctx.fill();
  ctx.restore();

  // grain on the frame
  ctx.save();
  roundRect(ctx, frame, frame, size - frame * 2, size - frame * 2, size * 0.028);
  ctx.clip();
  for (let i = 0; i < 120; i++) {
    const t = i / 120;
    const y = frame + t * (size - frame * 2);
    ctx.strokeStyle = `rgba(58,32,8,${0.03 + (i % 5) * 0.012})`;
    ctx.lineWidth = 0.6 + (i % 3) * 0.5;
    ctx.beginPath();
    ctx.moveTo(frame, y);
    for (let x = frame; x <= size - frame; x += size / 9) {
      ctx.lineTo(x, y + Math.sin((x / size) * 7 + i * 0.9) * (1.1 + (i % 4)));
    }
    ctx.stroke();
  }
  ctx.restore();

  // brass inlay line
  ctx.strokeStyle = 'rgba(255,226,168,.35)';
  ctx.lineWidth = Math.max(1, size * 0.0022);
  roundRect(ctx, frame + size * 0.012, frame + size * 0.012, size - (frame + size * 0.012) * 2, size - (frame + size * 0.012) * 2, size * 0.022);
  ctx.stroke();

  ctx.strokeStyle = 'rgba(255,236,190,.5)';
  ctx.lineWidth = Math.max(1, size * 0.0018);
  roundRect(ctx, frame + 1, frame + 1, size - frame * 2 - 2, size - frame * 2 - 2, size * 0.026);
  ctx.stroke();

  /* --- playing surface ------------------------------------------------ */
  const surf = l.pad;
  const surfW = size - surf * 2;
  ctx.save();
  roundRect(ctx, surf, surf, surfW, surfW, size * 0.016);
  const paper = ctx.createRadialGradient(size * 0.32, size * 0.22, size * 0.05, size * 0.5, size * 0.55, size * 0.82);
  paper.addColorStop(0, '#fff9ec');
  paper.addColorStop(0.45, '#fdf1d9');
  paper.addColorStop(0.78, '#f5e3c3');
  paper.addColorStop(1, '#e8d2ab');
  ctx.fillStyle = paper;
  ctx.fill();
  ctx.restore();

  ctx.save();
  roundRect(ctx, surf, surf, surfW, surfW, size * 0.016);
  ctx.clip();
  noise(ctx, size, size, 0x51d3, 0.05, Math.round(size * 2.2));
  // fine horizontal grain, like a lacquered board
  for (let i = 0; i < 70; i++) {
    const y = surf + (i / 70) * surfW;
    ctx.strokeStyle = `rgba(160,120,70,${0.012 + (i % 4) * 0.006})`;
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.moveTo(surf, y);
    for (let x = surf; x <= size - surf; x += size / 10) ctx.lineTo(x, y + Math.sin(x / size * 5 + i) * 1.6);
    ctx.stroke();
  }
  // inner shadow at the surface edge
  const edge = ctx.createLinearGradient(0, surf, 0, surf + size * 0.05);
  edge.addColorStop(0, 'rgba(90,60,20,.18)');
  edge.addColorStop(1, 'rgba(90,60,20,0)');
  ctx.fillStyle = edge;
  ctx.fillRect(surf, surf, surfW, size * 0.05);
  ctx.restore();

  /* --- light on the surface, before anything sits on it ---------------- */
  ctx.save();
  roundRect(ctx, surf, surf, surfW, surfW, size * 0.016);
  ctx.clip();
  const topLight = ctx.createLinearGradient(0, surf, 0, size * 0.5);
  topLight.addColorStop(0, 'rgba(255,252,240,.5)');
  topLight.addColorStop(1, 'rgba(255,252,240,0)');
  ctx.fillStyle = topLight;
  ctx.fillRect(surf, surf, surfW, surfW * 0.5);
  const vig = ctx.createRadialGradient(size / 2, size * 0.46, size * 0.26, size / 2, size / 2, size * 0.78);
  vig.addColorStop(0, 'rgba(120,78,28,0)');
  vig.addColorStop(1, 'rgba(120,78,28,.16)');
  ctx.fillStyle = vig;
  ctx.fillRect(surf, surf, surfW, surfW);
  ctx.restore();

  /* --- the yards ------------------------------------------------------ */
  for (let seat = 0; seat < 4; seat++) {
    const [cx, cy] = YARD_CORNER[seat];
    const p = paintSeat(seat);
    const inset = 0.16;
    const x = place(l, cx + inset), y = place(l, cy + inset);
    const w = l.cell * (6 - inset * 2);
    const radius = l.cell * 0.85;

    ctx.save();
    // drop shadow
    ctx.shadowColor = 'rgba(60,35,10,.35)';
    ctx.shadowBlur = l.cell * 0.5;
    ctx.shadowOffsetY = l.cell * 0.14;
    roundRect(ctx, x, y, w, w, radius);
    const g = ctx.createLinearGradient(x, y, x + w, y + w);
    g.addColorStop(0, p.light);
    g.addColorStop(0.5, p.mid);
    g.addColorStop(1, p.deep);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.restore();

    // gloss sheen
    ctx.save();
    roundRect(ctx, x, y, w, w, radius);
    ctx.clip();
    const sheen = ctx.createLinearGradient(x, y, x + w * 0.7, y + w * 0.8);
    sheen.addColorStop(0, 'rgba(255,255,255,.42)');
    sheen.addColorStop(0.45, 'rgba(255,255,255,.06)');
    sheen.addColorStop(1, 'rgba(0,0,0,.16)');
    ctx.fillStyle = sheen;
    ctx.fillRect(x, y, w, w);
    noise(ctx, x + w, y + w, 0x9e11 + seat * 977, 0.05, Math.round(w * 1.1));
    ctx.restore();

    // rim
    ctx.strokeStyle = 'rgba(255,255,255,.38)';
    ctx.lineWidth = Math.max(1, l.cell * 0.055);
    roundRect(ctx, x + 1, y + 1, w - 2, w - 2, radius);
    ctx.stroke();

    /* the seat's name, engraved into the top of its yard */
    if (active.includes(seat)) {
      ctx.save();
      ctx.globalAlpha = 0.72;
      ctx.fillStyle = 'rgba(255,255,255,.92)';
      ctx.font = `700 ${Math.round(l.cell * 0.36)}px ui-sans-serif, system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.letterSpacing = `${l.cell * 0.04}px`;
      ctx.fillText(p.name.toUpperCase(), x + w / 2, y + w * 0.115);
      ctx.restore();
    }

    // the four sockets the tokens wait in
    for (const [sx, sy] of [[1.75, 1.75], [4.25, 1.75], [1.75, 4.25], [4.25, 4.25]]) {
      const px = place(l, cx + (seat === 1 || seat === 2 ? sx : sx));
      const py = place(l, cy + (seat === 2 || seat === 3 ? sy : sy));
      const r = l.cell * 0.52;
      const hole = ctx.createRadialGradient(px - r * 0.2, py - r * 0.25, r * 0.1, px, py, r);
      hole.addColorStop(0, 'rgba(40,20,5,.55)');
      hole.addColorStop(0.75, 'rgba(40,20,5,.32)');
      hole.addColorStop(1, 'rgba(255,255,255,.18)');
      ctx.fillStyle = hole;
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,.22)';
      ctx.lineWidth = Math.max(0.6, l.cell * 0.03);
      ctx.beginPath();
      ctx.arc(px, py, r * 0.98, Math.PI * 0.15, Math.PI * 0.95);
      ctx.stroke();
    }
  }

  /* --- the lanes, and the ring ---------------------------------------- */
  const tileFill = (seat: number, lit: boolean) => {
    const p = paintSeat(seat);
    return { p, lit };
  };
  void tileFill;

  const drawTile = (gx: number, gy: number, kind: 'ring' | 'lane' | 'start' | 'star', seat: number, dir: number = 0) => {
    const x = place(l, gx) + l.cell * 0.055;
    const y = place(l, gy) + l.cell * 0.055;
    const s = l.cell * 0.89;
    const r = l.cell * 0.2;
    const p = paintSeat(seat);

    ctx.save();
    ctx.shadowColor = 'rgba(80,50,15,.22)';
    ctx.shadowBlur = l.cell * 0.22;
    ctx.shadowOffsetY = l.cell * 0.06;
    roundRect(ctx, x, y, s, s, r);
    if (kind === 'ring') {
      const g = ctx.createLinearGradient(x, y, x + s, y + s);
      g.addColorStop(0, '#fffdf6');
      g.addColorStop(1, '#f6e8cd');
      ctx.fillStyle = g;
    } else if (kind === 'star') {
      const g = ctx.createLinearGradient(x, y, x + s, y + s);
      g.addColorStop(0, '#fff8e4');
      g.addColorStop(1, '#f7e6bd');
      ctx.fillStyle = g;
    } else {
      const g = ctx.createLinearGradient(x, y, x + s, y + s);
      g.addColorStop(0, p.light);
      g.addColorStop(0.55, p.mid);
      g.addColorStop(1, p.deep);
      ctx.fillStyle = g;
    }
    ctx.fill();
    ctx.restore();

    // bevelled edge
    ctx.strokeStyle = kind === 'ring' || kind === 'star' ? 'rgba(168,131,84,.55)' : 'rgba(255,255,255,.5)';
    ctx.lineWidth = Math.max(0.7, l.cell * 0.028);
    roundRect(ctx, x, y, s, s, r);
    ctx.stroke();

    // top-light
    const top = ctx.createLinearGradient(x, y, x, y + s * 0.55);
    top.addColorStop(0, 'rgba(255,255,255,.5)');
    top.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.save();
    roundRect(ctx, x, y, s, s, r);
    ctx.clip();
    ctx.fillStyle = top;
    ctx.fillRect(x, y, s, s);
    ctx.restore();

    if (kind === 'star') {
      const cx = x + s / 2, cy = y + s / 2;
      ctx.save();
      ctx.shadowColor = 'rgba(168,120,20,.5)';
      ctx.shadowBlur = l.cell * 0.18;
      starPath(ctx, cx, cy, l.cell * 0.29);
      const gg = ctx.createLinearGradient(cx, cy - l.cell * 0.3, cx, cy + l.cell * 0.3);
      gg.addColorStop(0, '#ffe9a8');
      gg.addColorStop(1, '#d99a1d');
      ctx.fillStyle = gg;
      ctx.fill();
      ctx.restore();
      ctx.strokeStyle = 'rgba(120,75,10,.5)';
      ctx.lineWidth = Math.max(0.6, l.cell * 0.022);
      starPath(ctx, cx, cy, l.cell * 0.29);
      ctx.stroke();
    }

    if (kind === 'start') {
      /* a chevron pointing the way a token leaves the yard — the direction the
         ring actually runs from this square, not a fixed arrow */
      const cx = x + s / 2, cy = y + s / 2;
      const size2 = l.cell * 0.3;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(dir);
      ctx.globalAlpha = 0.92;
      ctx.strokeStyle = 'rgba(255,255,255,.95)';
      ctx.lineWidth = Math.max(1, l.cell * 0.09);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(-size2 * 0.7, -size2 * 0.62);
      ctx.lineTo(size2 * 0.35, 0);
      ctx.lineTo(-size2 * 0.7, size2 * 0.62);
      ctx.stroke();
      ctx.restore();
    }
  };

  /* the heading of the ring at each start square, in radians */
  const headingAt = (index: number) => {
    const a = RING[index];
    const b = RING[(index + 1) % RING.length];
    return Math.atan2(b[1] - a[1], b[0] - a[0]);
  };

  RING.forEach((cell, i) => {
    const seat = [0, 1, 2, 3].find((s2) => START[s2] === i);
    const safe = SAFE.has(i);
    drawTile(cell[0], cell[1], seat !== undefined ? 'start' : safe ? 'star' : 'ring', seat ?? 0, headingAt(i));
  });
  for (let seat = 0; seat < 4; seat++) {
    /* A lane only exists for a seat that is playing. Painting the two idle
       lanes in their own colour made a two-player board look like a faded
       four-player one; they are ordinary ring tiles instead. */
    for (const [x, y] of HOME_LANES[seat]) {
      if (active.includes(seat)) drawTile(x, y, 'lane', seat);
      else drawTile(x, y, 'ring', seat);
    }
  }

  /* --- the middle ------------------------------------------------------ */
  const cx0 = place(l, 6), cy0 = place(l, 6), box = l.cell * 3;
  ctx.save();
  roundRect(ctx, cx0, cy0, box, box, l.cell * 0.3);
  ctx.fillStyle = '#fbf1dc';
  ctx.fill();
  ctx.strokeStyle = 'rgba(168,131,84,.6)';
  ctx.lineWidth = Math.max(1, l.cell * 0.04);
  ctx.stroke();
  ctx.restore();

  /* Four wedges to the middle, each one facing the lane that feeds it: seat 0's
     lane comes in from the left, so its wedge is based on the left edge. Getting
     this a quarter-turn wrong makes the board read as somebody else's game. */
  const mc = { x: cx0 + box / 2, y: cy0 + box / 2 };
  const L = [cx0, cy0], TR = [cx0 + box, cy0], BR = [cx0 + box, cy0 + box], BL = [cx0, cy0 + box];
  const WEDGE: [number[], number[]][] = [
    [L, BL],   // seat 0 — from the left
    [L, TR],   // seat 1 — from the top
    [TR, BR],  // seat 2 — from the right
    [BL, BR],  // seat 3 — from the bottom
  ];
  for (let seat = 0; seat < 4; seat++) {
    const p = paintSeat(seat);
    const [a, b] = WEDGE[seat];
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.lineTo(mc.x, mc.y);
    ctx.closePath();
    const g = ctx.createLinearGradient(a[0], a[1], mc.x, mc.y);
    g.addColorStop(0, p.light);
    g.addColorStop(0.55, p.mid);
    g.addColorStop(1, p.deep);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.restore();
    // a bright seam where two wedges meet
    ctx.strokeStyle = 'rgba(255,248,232,.8)';
    ctx.lineWidth = Math.max(0.8, l.cell * 0.03);
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(mc.x, mc.y);
    ctx.stroke();
  }

  // medallion
  ctx.save();
  ctx.shadowColor = 'rgba(60,35,8,.5)';
  ctx.shadowBlur = l.cell * 0.4;
  const med = ctx.createRadialGradient(mc.x - l.cell * 0.2, mc.y - l.cell * 0.25, l.cell * 0.05, mc.x, mc.y, l.cell * 0.72);
  med.addColorStop(0, '#fffbee');
  med.addColorStop(0.55, '#f6dfa8');
  med.addColorStop(1, '#c99a3e');
  ctx.fillStyle = med;
  ctx.beginPath();
  ctx.arc(mc.x, mc.y, l.cell * 0.62, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  ctx.strokeStyle = 'rgba(122,84,26,.75)';
  ctx.lineWidth = Math.max(1, l.cell * 0.045);
  ctx.beginPath();
  ctx.arc(mc.x, mc.y, l.cell * 0.62, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,.7)';
  ctx.lineWidth = Math.max(0.6, l.cell * 0.025);
  ctx.beginPath();
  ctx.arc(mc.x, mc.y, l.cell * 0.5, Math.PI * 0.1, Math.PI * 0.9);
  ctx.stroke();

  return canvas;
}

/* ------------------------------------------------------------------ tokens */

export interface TokenDraw {
  gx: number;
  gy: number;
  seat: number;
  /** 0…1 while hopping */
  lift?: number;
  scale?: number;
  alpha?: number;
  /** small badge for stacks */
  stack?: number;
}

/**
 * One token: a domed marble with a rim, a specular highlight and a contact
 * shadow that tightens as it lands. Drawn in device-independent units so the
 * same code paints a 24 px token on a phone and a 60 px one on a monitor.
 */
export function drawToken(
  ctx: CanvasRenderingContext2D, l: Layout, t: TokenDraw, paints: SeatPaint[] = SEAT_PAINT,
) {
  const p = paints[t.seat] ?? SEAT_PAINT[0];
  const r = l.cell * 0.4 * (t.scale ?? 1);
  const x = place(l, t.gx);
  const lift = (t.lift ?? 0) * l.cell * 0.85;
  const y = place(l, t.gy) - lift;
  const alpha = t.alpha ?? 1;
  if (alpha <= 0.01 || r <= 0.2) return;

  ctx.save();
  ctx.globalAlpha = alpha;

  /* contact shadow — smaller and darker as the token comes down */
  const spread = 1 + (t.lift ?? 0) * 0.8;
  const shadow = ctx.createRadialGradient(x, place(l, t.gy) + r * 0.3, r * 0.1, x, place(l, t.gy) + r * 0.3, r * 1.25 * spread);
  shadow.addColorStop(0, `rgba(58,34,10,${0.42 - (t.lift ?? 0) * 0.18})`);
  shadow.addColorStop(1, 'rgba(58,34,10,0)');
  ctx.fillStyle = shadow;
  ctx.beginPath();
  ctx.ellipse(x, place(l, t.gy) + r * 0.32, r * 1.22 * spread, r * 0.86 * spread, 0, 0, Math.PI * 2);
  ctx.fill();

  /* body */
  const body = ctx.createRadialGradient(x - r * 0.36, y - r * 0.44, r * 0.12, x, y, r * 1.05);
  body.addColorStop(0, '#ffffff');
  body.addColorStop(0.18, p.light);
  body.addColorStop(0.62, p.mid);
  body.addColorStop(1, p.deep);
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();

  /* rim */
  ctx.lineWidth = Math.max(0.8, r * 0.12);
  ctx.strokeStyle = `rgba(30,14,4,${0.45})`;
  ctx.beginPath();
  ctx.arc(x, y, r * 0.96, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = Math.max(0.5, r * 0.07);
  ctx.strokeStyle = 'rgba(255,255,255,.55)';
  ctx.beginPath();
  ctx.arc(x, y, r * 0.8, Math.PI * 0.95, Math.PI * 1.9);
  ctx.stroke();

  /* dome gloss */
  const gloss = ctx.createRadialGradient(x - r * 0.34, y - r * 0.42, 0, x - r * 0.34, y - r * 0.42, r * 0.72);
  gloss.addColorStop(0, 'rgba(255,255,255,.95)');
  gloss.addColorStop(0.35, 'rgba(255,255,255,.28)');
  gloss.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gloss;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();

  /* a tiny sparkle when it is in the air */
  if ((t.lift ?? 0) > 0.35) {
    ctx.globalAlpha = alpha * (t.lift ?? 0) * 0.9;
    ctx.fillStyle = 'rgba(255,255,255,.9)';
    ctx.beginPath();
    ctx.arc(x + r * 0.42, y - r * 0.42, r * 0.1, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  if (t.stack && t.stack > 1) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = 'rgba(32,18,6,.82)';
    ctx.beginPath();
    ctx.arc(x + r * 0.72, y + r * 0.72, r * 0.42, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff6e2';
    ctx.font = `700 ${Math.round(r * 0.62)}px ui-sans-serif, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(t.stack), x + r * 0.72, y + r * 0.72 + r * 0.02);
    ctx.restore();
  }
}

/** A glowing ring on a square a token could move to. */
export function drawTarget(ctx: CanvasRenderingContext2D, l: Layout, gx: number, gy: number, colour: string, pulse: number) {
  const x = place(l, gx), y = place(l, gy);
  const r = l.cell * (0.2 + pulse * 0.08);
  ctx.save();
  const g = ctx.createRadialGradient(x, y, 0, x, y, l.cell * 0.5);
  g.addColorStop(0, colour);
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.globalAlpha = 0.35 + pulse * 0.35;
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, l.cell * 0.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 0.9;
  ctx.strokeStyle = 'rgba(255,255,255,.9)';
  ctx.lineWidth = Math.max(1, l.cell * 0.05);
  ctx.beginPath();
  ctx.arc(x, y, r + l.cell * 0.14, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

/** A soft halo behind the tokens of whoever is on turn. */
export function drawTurnGlow(ctx: CanvasRenderingContext2D, l: Layout, seat: number, t: number, paints: SeatPaint[] = SEAT_PAINT) {
  const [cx, cy] = YARD_CORNER[seat];
  const x = place(l, cx + 3), y = place(l, cy + 3);
  const p = paints[seat] ?? SEAT_PAINT[0];
  const pulse = 0.5 + Math.sin(t / 620) * 0.5;
  ctx.save();
  const g = ctx.createRadialGradient(x, y, l.cell * 1.2, x, y, l.cell * 3.4);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(0.6, `${p.glow}${Math.round((0.1 + pulse * 0.12) * 255).toString(16).padStart(2, '0')}`);
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, l.cell * 3.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
