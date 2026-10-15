/**
 * Phone audit. These games are played on a phone — the pass-the-phone ones
 * especially — so this checks every game at 390×844 for the things that
 * actually break on small screens: horizontal overflow, controls pushed off
 * the viewport, and tap targets too small to hit.
 */
import { chromium } from 'playwright';
const B = 'http://127.0.0.1:5173';
const SLUGS = ['chess-arena','tic-tac-toe-duel','connect-four','memory-match','reaction-duel',
  'snake-arena','battleship','checkers','puzzle-quest','electric-arcade',
  'spark-quiz','wild-eights','case-files','imposter','truth-or-dare'];
let fail = 0;
const b = await chromium.launch({ args: ['--no-sandbox','--disable-gpu'] });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });

const rows = [];
for (const slug of SLUGS) {
  const p = await ctx.newPage();
  const errs = [];
  p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  p.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
  await p.goto(B + '/');
  await p.evaluate(() => sessionStorage.setItem('pikachu.intro.v1', '1'));
  await p.goto(`${B}/solo/${slug}`, { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(2400);

  const m = await p.evaluate(() => {
    const de = document.documentElement;
    const overflow = de.scrollWidth - de.clientWidth;
    // elements that genuinely stick out past the right edge
    const wide = [...document.querySelectorAll('body *')].filter(e => {
      const r = e.getBoundingClientRect();
      return r.width > 0 && r.right > de.clientWidth + 2 && getComputedStyle(e).position !== 'fixed';
    }).slice(0, 4).map(e => `${e.tagName.toLowerCase()}.${(e.className || '').toString().split(' ')[0]}`);
    // interactive targets that are too small to tap reliably
    // Two different bars, because they are two different questions.
    //
    //  * Board squares must fit the viewport: a 10x10 fleet grid on a 390px
    //    phone cannot have 44px cells and still be one board. They are held to
    //    the WCAG 2.5.8 (AA) floor of 24x24 and no higher.
    //  * Everything else is chrome the layout can afford to grow, so it is
    //    held to a 32px comfort floor.
    //  * Skip links are deliberately 1x1 until focused — exempt, not a failure.
    const measure = (e) => {
      const r = e.getBoundingClientRect();
      return { w: r.width, h: r.height };
    };
    const name = (e) => `${(e.getAttribute('aria-label') || e.textContent || e.tagName).trim().slice(0, 20)}(${Math.round(e.getBoundingClientRect().height)}px)`;
    const all = [...document.querySelectorAll('button:not([disabled]), a[href], input')]
      .filter(e => { const m = measure(e); return m.w > 0 && m.h > 0; })
      .filter(e => !(e.closest('.sr-only') || e.classList.contains('sr-only')));
    const inGrid = (e) => !!e.closest('[role="grid"], [role="group"][aria-label*="grid" i], canvas');
    const small = all.filter(e => {
      const m = measure(e);
      return inGrid(e) ? (m.h < 24 || m.w < 24) : (m.h < 32 || m.w < 24);
    }).map(name);
    /* How much of the screen is permanently spent on chrome rather than game.
       Everything sticky/fixed that sits at the top, plus whatever scrolls above
       the playfield, is screen you never get back. On a phone this was 420px of
       a 727px viewport: the board started below the fold and a side-scroller
       was a 129px letterbox slit with its controls off-screen entirely. */
    const chrome = [...document.querySelectorAll('body *')]
      .filter(e => {
        const st = getComputedStyle(e);
        if (st.position !== 'fixed' && st.position !== 'sticky') return false;
        const r = e.getBoundingClientRect();
        return r.height > 4 && r.top < innerHeight * 0.5;
      })
      .reduce((n, e) => n + e.getBoundingClientRect().height, 0);

    // the playfield: a canvas, or the biggest board-ish element
    const field = document.querySelector('canvas, [role="grid"], .board, [data-board]');
    const fr = field && field.getBoundingClientRect();
    return {
      overflow, wide, small: [...new Set(small)].slice(0, 5), smallCount: small.length,
      chrome: Math.round(chrome),
      fieldTop: fr ? Math.round(fr.top) : null,
      fieldVisible: fr ? fr.top < innerHeight && fr.bottom > 0 : null,
      fieldPct: fr ? +((fr.width * fr.height) / (innerWidth * innerHeight) * 100).toFixed(1) : null,
    };
  });

  // 150px is the header (63) plus one compact game bar (44) plus slack
  const chromeBad = m.chrome > 150;
  const fieldBad = m.fieldVisible === false;
  const bad = m.overflow > 2 || m.smallCount > 0 || errs.length > 0 || chromeBad || fieldBad;
  if (bad) fail++;
  rows.push({ slug, ...m, errs: errs.slice(0, 1) });
  console.log(`${bad ? '✗' : '✓'} ${slug.padEnd(18)} overflow=${m.overflow}px  tiny=${m.smallCount}  sticky-chrome=${m.chrome}px${chromeBad ? ' TOO MUCH' : ''}  field=${m.fieldPct === null ? 'n/a' : m.fieldPct + '% @y' + m.fieldTop}${fieldBad ? ' OFF-SCREEN' : ''}${m.small.length ? ' [' + m.small.join(', ') + ']' : ''}${errs.length ? '  ERR:' + errs[0].slice(0,60) : ''}`);
  await p.close();
}
console.log(`\n${SLUGS.length - fail}/${SLUGS.length} games are clean on a 390px phone`);
await b.close();
process.exit(fail ? 1 : 0);
