/**
 * Guess & Draw — the drawing layer, separated from the React component.
 *
 * Everything here is arithmetic over stroke data, so it can be tested without a
 * canvas. It exists because the board used to keep all of this inline, and three
 * of the bugs a player actually notices lived in it:
 *
 *  1. **The picture vanished while you drew it.** A long stroke is flushed to the
 *     server mid-draw so the other screen keeps up; the local copy of the flushed
 *     part was dropped on the assumption that the echo would bring it back. It
 *     did — a full round trip later — so the line you had just drawn blinked out
 *     and reappeared. `reconcilePending` is the fix: strokes that have been sent
 *     but not yet echoed are kept in the local picture, and dropped exactly as the
 *     echo arrives.
 *  2. **The canvas got slower the more you drew.** Every pointermove repainted the
 *     entire history. At a few hundred strokes that is thousands of line
 *     segments per finger sample, on a phone. `strokeCacheKey` is what lets the
 *     board keep a pre-rendered bitmap of the committed strokes and only redraw
 *     the stroke under the finger.
 *  3. **A finger was treated as several.** Palm contact, a second finger, or the
 *     right mouse button started or ended a stroke at random. `isDrawPointer` is
 *     the rule: one pointer, primary button, and it owns the stroke until it is
 *     lifted or cancelled.
 */
import { MAX_POINTS, type Stroke } from './rules';

/** Only one pointer draws, and only with its primary button. */
export function isDrawPointer(e: {
  pointerType?: string;
  isPrimary?: boolean;
  button?: number;
  buttons?: number;
}): boolean {
  /* A pen or a mouse must press the primary button. For touch, the browser
     reports `button: 0` on contact and `-1` on moves, so the button test only
     applies to pointers that have buttons at all. */
  if (e.pointerType !== 'touch') {
    if ((e.button ?? 0) > 0) return false;
    if (e.buttons !== undefined && (e.buttons & 1) === 0) return false;
  }
  /* `isPrimary` is false for a palm or a second finger, which used to leave a
     stray line across the drawing. */
  return e.isPrimary !== false;
}

/**
 * Should this sample be kept?
 *
 * Two jobs: drop points that are within `min` units of the last one (which on a
 * 120 Hz digitiser is most of them), and keep the very first sample whatever it
 * is. The threshold is in the 0..1000 stroke space, so it does not change with
 * the size of the canvas on screen.
 */
export function shouldKeep(x: number, y: number, points: readonly number[], min = 4): boolean {
  /* The first sample starts the stroke and the second one is always kept, even
     if the finger has not moved: a tap that leaves a single coordinate is a dot,
     and dropping it made a tap draw nothing at all. */
  if (points.length <= 2) return true;
  const dx = points[points.length - 2] - x;
  const dy = points[points.length - 1] - y;
  return dx * dx + dy * dy >= min * min;
}

/** Throw away the points that add nothing, so a stroke fits the wire budget. */
export function thin(points: readonly number[], min = 4): number[] {
  const out: number[] = [];
  for (let i = 0; i < points.length; i += 2) {
    if (shouldKeep(points[i], points[i + 1], out, min)) out.push(points[i], points[i + 1]);
  }
  if (out.length === 0 && points.length >= 2) out.push(points[0], points[1]);
  /* The relay rejects a stroke over MAX_POINTS; a long single stroke is shortened
     by taking every other point rather than by chopping its end, which would
     visibly cut the line. */
  while (out.length / 2 > MAX_POINTS) {
    const half: number[] = [];
    for (let i = 0; i < out.length; i += 4) half.push(out[i], out[i + 1]);
    half.push(out[out.length - 2], out[out.length - 1]);
    out.length = 0;
    out.push(...half);
  }
  return out;
}

/**
 * The strokes that are drawn but not yet in the server's state.
 *
 * `sent` is local: a stroke we have handed to the server and are waiting to see
 * echoed. When the authoritative stroke count grows by n, n of ours have
 * arrived; when it shrinks (undo, clear, new round) none of them are ours any
 * more and the whole queue goes.
 */
export function reconcilePending(pending: Stroke[], prevCount: number, nextCount: number): Stroke[] {
  if (nextCount < prevCount) return [];
  if (nextCount === prevCount) return pending;
  return pending.slice(Math.min(nextCount - prevCount, pending.length));
}

/**
 * A key that changes exactly when the committed picture changes.
 *
 * The board renders this to an offscreen canvas; if the key is the same, the
 * bitmap can be reused untouched. Width and height are in it because a resize
 * has to repaint, and the last stroke's length is in it because the count alone
 * cannot see an undo followed by a new stroke (the arithmetic the server does).
 */
export function strokeCacheKey(strokes: readonly Stroke[], width: number, height: number): string {
  const last = strokes[strokes.length - 1];
  let hash = 0;
  if (last) {
    hash = last.p.length * 31 + last.c * 7 + last.w;
    for (let i = 0; i < last.p.length; i += 2) hash = (hash * 33 + last.p[i] + last.p[i + 1]) | 0;
  }
  return `${strokes.length}:${hash}:${Math.round(width)}x${Math.round(height)}`;
}

/** Where a pointer event lands, in the 0..1000 stroke space. */
export function pointFrom(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
  size = 1000,
): [number, number] {
  const clamp = (n: number) => Math.max(0, Math.min(size, Math.round(n)));
  if (rect.width <= 0 || rect.height <= 0) return [0, 0];
  return [clamp(((clientX - rect.left) / rect.width) * size), clamp(((clientY - rect.top) / rect.height) * size)];
}

/**
 * Draw one stroke into a context, smoothing between samples.
 *
 * Quadratic curves through the midpoints of consecutive samples: the line passes
 * through the samples instead of cornering at each one, which is the difference
 * between a drawn circle and a hexagon. A single sample is a dot, because a tap
 * with no movement should leave a mark.
 */
export function paintStroke(
  ctx: CanvasRenderingContext2D,
  stroke: Stroke,
  sx: number,
  sy: number,
  colour: string,
  widthOf: (index: number) => number,
) {
  const p = stroke.p;
  if (p.length < 2) return;
  ctx.strokeStyle = colour;
  ctx.fillStyle = colour;
  /* The nib stays round: scaling it per axis would make it an ellipse, which
     looks like a fountain pen defect. */
  ctx.lineWidth = Math.max(0.75, widthOf(stroke.w) * Math.min(sx, sy));
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (p.length === 2) {
    ctx.beginPath();
    ctx.arc(p[0] * sx, p[1] * sy, ctx.lineWidth / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }

  ctx.beginPath();
  ctx.moveTo(p[0] * sx, p[1] * sy);
  if (p.length === 4) {
    ctx.lineTo(p[2] * sx, p[3] * sy);
  } else {
    for (let i = 2; i + 3 < p.length; i += 2) {
      const cx = p[i] * sx;
      const cy = p[i + 1] * sy;
      const mx = ((p[i] + p[i + 2]) / 2) * sx;
      const my = ((p[i + 1] + p[i + 3]) / 2) * sy;
      ctx.quadraticCurveTo(cx, cy, mx, my);
    }
    const n = p.length;
    ctx.lineTo(p[n - 2] * sx, p[n - 1] * sy);
  }
  ctx.stroke();
}
