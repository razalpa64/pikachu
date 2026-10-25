/**
 * Colour contrast guard.
 *
 * A UI pass fixed a batch of low-contrast accents — gold `#f0b429` at 1.8:1 on
 * paper, the "Drawn" heading at 1.1:1, blue stat numbers at 2.9:1 — and the only
 * thing that keeps them fixed is a test. Reading the numbers off the palette by
 * hand every release is exactly the chore that gets skipped, so the ratios are
 * computed here from the real hex values used in the components.
 *
 * Scope is deliberate: only colours that paint *text*. Bright accents are still
 * allowed as fills, dots, borders and progress bars, where WCAG's text rules do
 * not apply.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const PAPER = '#fffdf7';   // --color-ink-800, the card face most text sits on
const WHITE = '#ffffff';   // Stat chips are bg-white/80

function luminance(hex: string): number {
  const h = hex.replace('#', '');
  const channel = (i: number) => {
    const v = parseInt(h.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
}

export function contrast(fg: string, bg: string): number {
  const [a, b] = [luminance(fg), luminance(bg)].sort((x, y) => y - x);
  return (a + 0.05) / (b + 0.05);
}

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) { sourceFiles(path, out); continue; }
    if (/\.tsx?$/.test(name) && !name.includes('.test.')) out.push(path);
  }
  return out;
}

const FILES = sourceFiles(join(process.cwd(), 'src'));

describe('text colours', () => {
  it('every Stat accent clears WCAG AA on the chip it is painted on', () => {
    const found: { file: string; hex: string }[] = [];
    for (const file of FILES) {
      const src = readFileSync(file, 'utf8');
      for (const match of src.matchAll(/accent="(#[0-9a-fA-F]{6})"/g)) {
        found.push({ file: file.replace(process.cwd(), ''), hex: match[1] });
      }
    }
    // The point is coverage: an empty sweep would pass silently.
    expect(found.length).toBeGreaterThan(20);
    for (const { file, hex } of found) {
      const ratio = Math.min(contrast(hex, PAPER), contrast(hex, WHITE));
      expect(ratio, `${file}: accent ${hex} is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('result-overlay copy clears WCAG AA', () => {
    const src = readFileSync(join(process.cwd(), 'src/components/Overlays.tsx'), 'utf8');
    const inks = [...src.matchAll(/ink: '(#[0-9a-fA-F]{6})'/g)].map((m) => m[1]);
    expect(inks.length).toBe(3); // win, loss, draw — add the check when a verdict is added
    for (const hex of inks) {
      expect(contrast(hex, PAPER), `overlay ink ${hex}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('the turn pill never puts cocoa ink on a mid-tone pink', () => {
    // #5a3a12 on blush-300 is 5.9:1; on spark-400 it was 3.9:1 and failed.
    const src = FILES.map((f) => readFileSync(f, 'utf8')).join('\n');
    expect(src).not.toContain('bg-spark-400 text-[#5a3a12]');
    expect(contrast('#5a3a12', '#ffadc6')).toBeGreaterThanOrEqual(4.5);
  });
});
