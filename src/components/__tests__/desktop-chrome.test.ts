// @vitest-environment node
/**
 * The sticky chrome, pinned from the source.
 *
 * The site header is not 58 px tall. It is a 58 px row, plus the 3 px reading
 * -progress strip under it, plus its own 2 px rule — 63 px — and every sticky
 * bar that parks *under* it was pinned to `top-[58px]`, because that is the
 * number in the header's inner class. The result was a 5 px transparent seam
 * that the page scrolled through in daylight: the filter bar on Library and
 * Retro, the title bar on every solo screen, the room bar.
 *
 * Layout is not something vitest can measure (the suite runs in `node`), so the
 * contract is pinned here instead: the token exists, it carries the real height
 * of the header at both widths, every sticky offset reads it rather than
 * guessing, and the performance-tier fallback stays scoped to the wide layout
 * so the phone chrome cannot change by accident.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const CSS = readFileSync(join(ROOT, 'src/styles.css'), 'utf8');

function sources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) { sources(path, out); continue; }
    if (/\.tsx?$/.test(path) && !/__tests__/.test(path)) out.push(path);
  }
  return out;
}

const FILES = sources(join(ROOT, 'src'));

/** The header rule itself, so the arithmetic below cannot drift from the CSS. */
const header = readFileSync(join(ROOT, 'src/components/AppShell.tsx'), 'utf8');

describe('the header height token', () => {
  it('is the row, the progress strip and the rule added up', () => {
    // 58 px row + 3 px progress strip + 2 px border-b-2 = the number the sticky
    // bars park at, at `lg` and up.
    const row = /h-\[58px\]/.test(header);
    const strip = /h-\[3px\]/.test(header);
    const rule = /border-b-2/.test(header);
    expect({ row, strip, rule }).toEqual({ row: true, strip: true, rule: true });
    expect(58 + 3 + 2).toBe(63);
  });

  it('is declared once, and is 63 px on the wide layout', () => {
    expect(CSS).toMatch(/--topbar-h:\s*58px;/);
    expect(CSS).toMatch(/@media \(min-width: 1024px\) \{\s*:root \{ --topbar-h: 63px; \}\s*\}/);
  });

  it('is what the phone keeps, so the narrow layout does not shift', () => {
    // 58 is the pre-existing phone value: the phone layout is frozen.
    const declared = CSS.match(/--topbar-h:\s*(\d+)px/g) ?? [];
    expect(declared).toEqual(['--topbar-h: 58px', '--topbar-h: 63px']);
  });
});

describe('every sticky bar under the header', () => {
  it('reads the token instead of hard-coding 58', () => {
    const offenders = FILES.filter((f) => /top-\[(58|52|56)px\]/.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('is actually pinned to it', () => {
    const users = FILES.filter((f) => readFileSync(f, 'utf8').includes('top-[var(--topbar-h)]'));
    // Library, Retro, the solo shell and the room bar — the four surfaces that
    // sticky below the site header.
    expect(users.length).toBeGreaterThanOrEqual(4);
    for (const file of ['src/screens/Library.tsx', 'src/screens/Retro.tsx', 'src/components/SoloShell.tsx', 'src/screens/Room.tsx']) {
      expect(readFileSync(join(ROOT, file), 'utf8')).toContain('top-[var(--topbar-h)]');
    }
  });
});

describe('the performance tier', () => {
  it('keeps the blur off, as before', () => {
    expect(CSS).toMatch(/html\[data-quality="performance"\] \.blur-heavy \{ backdrop-filter: none !important; \}/);
  });

  it('never leaves a sticky bar as a window, whatever the tier or the engine', () => {
    // A 92 %-opaque bar is only legible because the blur behind it does the rest.
    // With the blur off — the performance tier, an older browser, a phone in
    // battery saver — that same bar let the settings rail scroll *through* the
    // title row, so on a game screen you could read "Advanced" inside the word
    // VANTA while the controls were pinned under a solid strip.
    //
    // The fix is no longer "make it opaque on one tier": the solid paper is the
    // base coat for every bar, and the glass tint is granted only where
    // `backdrop-filter` will really be painted.
    expect(CSS).toMatch(/\.sticky-chrome \{ background-color: var\(--color-ink-900\); \}/);
    expect(CSS).toMatch(/\.solo-bar \{ background-color: var\(--color-ink-850\); \}/);
    expect(CSS).toMatch(/@supports \(\(backdrop-filter: blur\(1px\)\) or \(-webkit-backdrop-filter: blur\(1px\)\)\)/);
    expect(CSS).toMatch(/html:not\(\[data-quality="performance"\]\) \.sticky-chrome/);
    // and the tier with no blur at all is still explicitly solid
    expect(CSS).toMatch(/html\[data-quality="performance"\] \.sticky-chrome \{ background-color: var\(--color-ink-900\); \}/);
    const chrome = FILES.filter((f) => readFileSync(f, 'utf8').includes('sticky-chrome'));
    expect(chrome.length).toBeGreaterThanOrEqual(5);
  });
});
