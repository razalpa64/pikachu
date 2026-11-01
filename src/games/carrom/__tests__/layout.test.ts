/**
 * The board's proportions, pinned.
 *
 * The rail has now been wrong in both directions — thin enough to look like a
 * diagram, then a sixth of the board in each direction, which left a third of
 * the picture as wood and a pinched playing surface. The reference sheet is the
 * tie-breaker, and these numbers are what it measures: the walnut is a sixteenth
 * of the board per side, the cream margin is a hairline, and the bed is most of
 * the piece. A test is the only thing that stops the next pass drifting.
 */
import { describe, expect, it } from 'vitest';
import { layout } from '../paint';
import { BOARD, POCKET_R, POCKETS } from '../physics';

describe('the carrom board layout', () => {
  const SIZE = 1000;
  const l = layout(SIZE);
  const bed = SIZE - (l.margin + l.frame) * 2;

  it('leaves the bed most of the picture', () => {
    expect(bed / SIZE).toBeGreaterThan(0.84);
  });

  it('keeps the rail a narrow rim, not a frame', () => {
    expect(l.frame / (SIZE - l.margin * 2)).toBeLessThan(0.075);
    expect(l.frame / (SIZE - l.margin * 2)).toBeGreaterThan(0.05);
  });

  it('keeps the cream margin a hairline', () => {
    expect(l.margin / SIZE).toBeLessThan(0.02);
  });

  it('maps the bed onto the referee’s 100 units', () => {
    expect(l.scale * BOARD).toBeCloseTo(bed, 6);
    // a pocket is drawn where the simulation kills a coin, and it has to fit
    expect(l.scale * POCKET_R * 2).toBeLessThan(l.frame * 3);
    for (const p of POCKETS) {
      expect(l.origin + p.x * l.scale).toBeGreaterThan(l.margin + l.frame - 1);
    }
  });
});
