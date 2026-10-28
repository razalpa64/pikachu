import { describe, expect, it } from 'vitest';
import { keyboardInset } from '../viewport';

describe('keyboardInset', () => {
  it('is 0 when nothing is covering the page', () => {
    expect(keyboardInset({ innerHeight: 844, viewportHeight: 844 })).toBe(0);
  });

  it('measures the iOS keyboard that does not resize the layout viewport', () => {
    // iPhone 13, Safari, keyboard open: layout stays 844, visible is ~544
    expect(keyboardInset({ innerHeight: 844, viewportHeight: 544 })).toBe(300);
  });

  it('ignores a collapsed URL bar (a few pixels of visual offset)', () => {
    expect(keyboardInset({ innerHeight: 844, viewportHeight: 830 })).toBe(0);
    expect(keyboardInset({ innerHeight: 844, viewportHeight: 826 })).toBe(0);
  });

  it('subtracts a scrolled visual viewport so the numbers stay honest', () => {
    expect(keyboardInset({ innerHeight: 844, viewportHeight: 544, viewportTop: 20 })).toBe(280);
  });

  it('never claims more than 60% of the screen, even mid-animation', () => {
    expect(keyboardInset({ innerHeight: 844, viewportHeight: 60 })).toBe(506);
    expect(keyboardInset({ innerHeight: 400, viewportHeight: 5 })).toBe(240);
  });

  it('survives nonsense numbers instead of moving the composer off-screen', () => {
    expect(keyboardInset({ innerHeight: Number.NaN, viewportHeight: 500 })).toBe(0);
    expect(keyboardInset({ innerHeight: 844, viewportHeight: 0 })).toBe(0);
    expect(keyboardInset({ innerHeight: 0, viewportHeight: 0 })).toBe(0);
    expect(keyboardInset({ innerHeight: 844, viewportHeight: 844, viewportTop: Number.NaN })).toBe(0);
  });
});
