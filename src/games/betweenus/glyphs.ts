/**
 * The eight glyphs the wall can show.
 *
 * Drawn as paths rather than shipped as images so they stay crisp at any size —
 * they appear twice in the game, once small on a steel legend plate and once as
 * big as a hand on the signal wall. Every one of them has to be describable out
 * loud, because the whole game is one player telling the other what they see:
 * "the one like a hook", "the one with three legs".
 */
export type Glyph = 'ring' | 'fork' | 'wave' | 'eye' | 'key' | 'spiral' | 'cross' | 'gate';

export const GLYPHS: { id: Glyph; spoken: string; draw: (ctx: CanvasRenderingContext2D, s: number) => void }[] = [
  {
    id: 'ring', spoken: 'a ring',
    draw: (c, s) => { c.beginPath(); c.arc(s / 2, s / 2, s * 0.3, 0, Math.PI * 2); c.stroke(); c.beginPath(); c.arc(s / 2, s / 2, s * 0.11, 0, Math.PI * 2); c.fill(); },
  },
  {
    id: 'fork', spoken: 'a fork',
    draw: (c, s) => {
      c.beginPath(); c.moveTo(s * 0.28, s * 0.24); c.lineTo(s * 0.28, s * 0.5); c.lineTo(s * 0.5, s * 0.72); c.lineTo(s * 0.72, s * 0.5); c.lineTo(s * 0.72, s * 0.24); c.stroke();
    },
  },
  {
    id: 'wave', spoken: 'a wave',
    draw: (c, s) => {
      c.beginPath();
      for (let i = 0; i <= 40; i++) {
        const x = s * 0.2 + (s * 0.6 * i) / 40;
        const y = s * 0.5 + Math.sin((i / 40) * Math.PI * 3) * s * 0.16;
        if (i === 0) c.moveTo(x, y); else c.lineTo(x, y);
      }
      c.stroke();
    },
  },
  {
    id: 'eye', spoken: 'an eye',
    draw: (c, s) => {
      c.beginPath(); c.ellipse(s / 2, s / 2, s * 0.32, s * 0.19, 0, 0, Math.PI * 2); c.stroke();
      c.beginPath(); c.arc(s / 2, s / 2, s * 0.085, 0, Math.PI * 2); c.fill();
      c.beginPath(); c.moveTo(s * 0.2, s * 0.78); c.lineTo(s * 0.8, s * 0.78); c.stroke();
    },
  },
  {
    id: 'key', spoken: 'a key',
    draw: (c, s) => {
      c.beginPath(); c.arc(s * 0.36, s * 0.36, s * 0.13, 0, Math.PI * 2); c.stroke();
      c.beginPath(); c.moveTo(s * 0.45, s * 0.45); c.lineTo(s * 0.72, s * 0.72); c.stroke();
      c.beginPath(); c.moveTo(s * 0.6, s * 0.72); c.lineTo(s * 0.72, s * 0.6); c.stroke();
    },
  },
  {
    id: 'spiral', spoken: 'a spiral',
    draw: (c, s) => {
      c.beginPath();
      for (let i = 0; i <= 90; i++) {
        const t = (i / 90) * Math.PI * 4.2;
        const r = s * 0.05 + (t / (Math.PI * 4.2)) * s * 0.3;
        const x = s / 2 + Math.cos(t) * r, y = s / 2 + Math.sin(t) * r;
        if (i === 0) c.moveTo(x, y); else c.lineTo(x, y);
      }
      c.stroke();
    },
  },
  {
    id: 'cross', spoken: 'a cross',
    draw: (c, s) => {
      c.beginPath(); c.moveTo(s * 0.5, s * 0.2); c.lineTo(s * 0.5, s * 0.8); c.moveTo(s * 0.2, s * 0.5); c.lineTo(s * 0.8, s * 0.5); c.stroke();
      c.beginPath(); c.arc(s / 2, s / 2, s * 0.3, 0, Math.PI * 2); c.stroke();
    },
  },
  {
    id: 'gate', spoken: 'a gate',
    draw: (c, s) => {
      c.beginPath();
      c.moveTo(s * 0.26, s * 0.78); c.lineTo(s * 0.26, s * 0.44);
      c.arc(s / 2, s * 0.44, s * 0.24, Math.PI, 0);
      c.lineTo(s * 0.74, s * 0.78);
      c.stroke();
      c.beginPath(); c.moveTo(s * 0.4, s * 0.78); c.lineTo(s * 0.4, s * 0.56); c.moveTo(s * 0.6, s * 0.78); c.lineTo(s * 0.6, s * 0.56); c.stroke();
    },
  },
];

/**
 * One glyph painted onto a canvas, lit like something cut into metal and
 * backlit. `lit` decides whether it glows or reads as an unlit plate.
 */
export function paintGlyph(
  ctx: CanvasRenderingContext2D, size: number, index: number, opts: { lit: boolean; ink?: string; glow?: string },
) {
  const glyph = GLYPHS[index % GLYPHS.length];
  ctx.save();
  ctx.lineWidth = size * 0.055;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = opts.lit ? (opts.ink ?? '#ffe9b0') : 'rgba(150,160,150,.22)';
  ctx.fillStyle = ctx.strokeStyle;
  if (opts.lit) {
    ctx.shadowColor = opts.glow ?? 'rgba(255,190,90,.95)';
    ctx.shadowBlur = size * 0.22;
  }
  glyph.draw(ctx, size);
  if (opts.lit) {
    // a second pass without the shadow, so the shape itself stays sharp
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 0.9;
    glyph.draw(ctx, size);
  }
  ctx.restore();
}

export function glyphTexture(index: number, opts: { lit: boolean }): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d')!;
  paintGlyph(ctx, 256, index, { lit: opts.lit });
  return c;
}
