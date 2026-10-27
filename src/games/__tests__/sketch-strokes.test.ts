import { describe, expect, it } from 'vitest';
import {
  isDrawPointer, shouldKeep, thin, reconcilePending, strokeCacheKey, pointFrom, paintStroke,
} from '../sketch/strokes';
import { MAX_POINTS, type Stroke } from '../sketch/rules';

const stroke = (p: number[], c = 0, w = 1): Stroke => ({ p, c, w });

describe('Guess & Draw — one pointer draws', () => {
  it('refuses a finger that is not the primary one', () => {
    /* A palm resting on the glass reports isPrimary: false; the board used to
       start a stroke with it. */
    expect(isDrawPointer({ pointerType: 'touch', isPrimary: false, button: 0 })).toBe(false);
    expect(isDrawPointer({ pointerType: 'touch', isPrimary: true, button: 0 })).toBe(true);
  });

  it('refuses the secondary mouse button', () => {
    expect(isDrawPointer({ pointerType: 'mouse', button: 2, buttons: 2 })).toBe(false);
    expect(isDrawPointer({ pointerType: 'mouse', button: 0, buttons: 1 })).toBe(true);
  });

  it('accepts a pen tip but not the pen barrel button', () => {
    expect(isDrawPointer({ pointerType: 'pen', button: 0, buttons: 1, isPrimary: true })).toBe(true);
    expect(isDrawPointer({ pointerType: 'pen', button: 5, buttons: 32, isPrimary: true })).toBe(false);
  });

  it('lets a touch move through: touch reports button -1 while the finger is down', () => {
    expect(isDrawPointer({ pointerType: 'touch', isPrimary: true, button: -1, buttons: 1 })).toBe(true);
  });
});

describe('Guess & Draw — sample thinning', () => {
  it('keeps every sample when they are far apart', () => {
    const p: number[] = [];
    for (let x = 0; x <= 100; x += 20) {
      expect(shouldKeep(x, 0, p)).toBe(true);
      p.push(x, 0);
    }
    expect(p).toHaveLength(12);
  });

  it('drops samples that are on top of the last one', () => {
    /* two points already on the wire, so the dot allowance is spent */
    const p = [100, 100, 100, 100];
    expect(shouldKeep(101, 101, p)).toBe(false);
    expect(shouldKeep(110, 100, p)).toBe(true);
  });

  it('keeps the first point, and a second one even if it lands on it', () => {
    expect(shouldKeep(5, 5, [])).toBe(true);
    /* A tap that does not move is a dot: the second sample has to survive, and
       `paintStroke` turns a two-number stroke into a filled circle. Anything
       after that inside the threshold really is noise. */
    expect(shouldKeep(5, 5, [5, 5])).toBe(true);
    expect(shouldKeep(6, 6, [5, 5, 5, 5, 5, 5])).toBe(false);
  });

  it('caps a huge stroke at the wire limit without cutting the end off', () => {
    const long: number[] = [];
    for (let i = 0; i < 2000; i++) long.push(i % 1000, (i * 3) % 1000);
    const out = thin(long);
    expect(out.length / 2).toBeLessThanOrEqual(MAX_POINTS);
    /* the last point survives: shortening by halving rather than truncating is
       what keeps the line from stopping short of the finger */
    expect(out.slice(-2)).toEqual(long.slice(-2));
  });
});

describe('Guess & Draw — strokes you have sent but not yet seen echoed', () => {
  const a = stroke([0, 0, 10, 10]);
  const b = stroke([20, 20, 30, 30]);
  const c = stroke([40, 40, 50, 50]);

  it('keeps them while nothing has come back', () => {
    expect(reconcilePending([a, b], 3, 3)).toEqual([a, b]);
  });

  it('drops exactly the ones the server has echoed', () => {
    expect(reconcilePending([a, b], 3, 4)).toEqual([b]);
    expect(reconcilePending([a, b], 3, 5)).toEqual([]);
  });

  it('drops the queue when the picture shrinks — an undo, a clear, a new round', () => {
    expect(reconcilePending([a, b], 3, 2)).toEqual([]);
    expect(reconcilePending([a, b], 3, 0)).toEqual([]);
  });

  it('never drops more than it holds', () => {
    expect(reconcilePending([c], 3, 9)).toEqual([]);
  });
});

describe('Guess & Draw — the committed bitmap', () => {
  it('changes when a stroke is added', () => {
    const k1 = strokeCacheKey([stroke([0, 0, 10, 10])], 400, 300);
    const k2 = strokeCacheKey([stroke([0, 0, 10, 10]), stroke([5, 5, 9, 9])], 400, 300);
    expect(k1).not.toBe(k2);
  });

  it('changes when a stroke is replaced rather than added', () => {
    /* undo-then-draw keeps the count identical; the count alone cannot see it,
       which would leave the canvas showing a stroke that no longer exists. */
    const before = strokeCacheKey([stroke([0, 0, 10, 10])], 400, 300);
    const after = strokeCacheKey([stroke([0, 0, 90, 90])], 400, 300);
    expect(before).not.toBe(after);
  });

  it('changes with the size of the canvas', () => {
    expect(strokeCacheKey([], 400, 300)).not.toBe(strokeCacheKey([], 800, 600));
  });

  it('is stable when nothing changed', () => {
    const strokes = [stroke([0, 0, 10, 10]), stroke([3, 4, 5, 6], 2, 3)];
    expect(strokeCacheKey(strokes, 400, 300)).toBe(strokeCacheKey([...strokes], 400, 300));
  });
});

describe('Guess & Draw — coordinates', () => {
  const rect = { left: 100, top: 50, width: 400, height: 300 };

  it('maps the corners of the canvas to the corners of the stroke space', () => {
    expect(pointFrom(100, 50, rect)).toEqual([0, 0]);
    expect(pointFrom(500, 350, rect)).toEqual([1000, 1000]);
    expect(pointFrom(300, 200, rect)).toEqual([500, 500]);
  });

  it('clamps a pointer that leaves the canvas mid-stroke', () => {
    expect(pointFrom(-40, 900, rect)).toEqual([0, 1000]);
  });

  it('does not divide by zero before layout', () => {
    expect(pointFrom(10, 10, { left: 0, top: 0, width: 0, height: 0 })).toEqual([0, 0]);
  });
});

describe('Guess & Draw — painting', () => {
  /** A recording stand-in for a 2D context: enough surface for paintStroke. */
  function recorder() {
    const calls: string[] = [];
    const ctx = {
      strokeStyle: '', fillStyle: '', lineWidth: 0, lineCap: '', lineJoin: '',
      beginPath: () => calls.push('begin'),
      moveTo: () => calls.push('move'),
      lineTo: () => calls.push('line'),
      quadraticCurveTo: () => calls.push('curve'),
      arc: () => calls.push('arc'),
      fill: () => calls.push('fill'),
      stroke: () => calls.push('stroke'),
    };
    return { ctx: ctx as unknown as CanvasRenderingContext2D, calls, raw: ctx };
  }

  it('draws a tap as a dot, not a zero-length line', () => {
    const { ctx, calls } = recorder();
    paintStroke(ctx, stroke([500, 500]), 1, 1, '#000', () => 7);
    expect(calls).toContain('arc');
    expect(calls).toContain('fill');
  });

  it('smooths a long stroke with curves rather than corners', () => {
    const { ctx, calls } = recorder();
    paintStroke(ctx, stroke([0, 0, 10, 10, 20, 0, 30, 10]), 1, 1, '#000', () => 7);
    expect(calls.filter((c) => c === 'curve').length).toBeGreaterThan(0);
  });

  it('scales the nib by the smaller axis so a 4:3 canvas gets a round nib', () => {
    const { ctx, raw } = recorder();
    paintStroke(ctx, stroke([0, 0, 500, 500]), 2, 0.5, '#000', () => 10);
    expect(raw.lineWidth).toBe(5);
  });

  it('never draws a nib thinner than a pixel', () => {
    const { ctx, raw } = recorder();
    paintStroke(ctx, stroke([0, 0, 10, 10]), 0.01, 0.01, '#000', () => 3);
    expect(raw.lineWidth).toBeGreaterThanOrEqual(0.75);
  });
});
