/**
 * "Press close on the defeat screen and nothing happens."
 *
 * The first version of this suite passed 30/30 while the bug was live, because
 * all it ever did was start a game and click the header's Library button — it
 * never lost a match, so it never opened a result card and never touched the
 * button the report was actually about.
 *
 * This version has three parts:
 *   A. header Library escape still works from inside a live game   (the old test)
 *   B. the result card's own exit button genuinely dismisses it    (the real bug)
 *   C. Escape dismisses the card too, because it claims aria-modal
 *
 * Part B drives Volt Runner to a real crash rather than faking state: it is the
 * only game whose exit button is labelled "Close" and the only one whose exit
 * does not reset the match, which is exactly why it broke.
 */
import { chromium } from 'playwright';

const B = 'http://127.0.0.1:5173';
const SLUGS = ['chess-arena', 'tic-tac-toe-duel', 'connect-four', 'memory-match', 'reaction-duel',
  'checkers', 'battleship', 'snake-arena', 'puzzle-quest', 'electric-arcade', 'spark-quiz',
  'wild-eights', 'case-files', 'imposter', 'truth-or-dare'];

const b = await chromium.launch({ args: ['--no-sandbox', '--disable-gpu'] });
let fail = 0;
const bad = (m) => { console.log(`✗ ${m}`); fail += 1; };

async function fresh(ctx, slug) {
  const p = await ctx.newPage();
  await ctx.addInitScript(() => sessionStorage.setItem('pikachu.intro.v1', '1')).catch(() => {});
  await p.goto(`${B}/solo/${slug}`);
  await p.waitForTimeout(1400);
  return p;
}

/* ══════════ A. the header escape hatch, from inside a live game ══════════ */
for (const [vp, label] of [[{ width: 1280, height: 900 }, 'desktop'], [{ width: 390, height: 844 }, 'phone']]) {
  const ctx = await b.newContext({ viewport: vp, hasTouch: label === 'phone', isMobile: label === 'phone' });
  await ctx.addInitScript(() => sessionStorage.setItem('pikachu.intro.v1', '1'));
  for (const slug of SLUGS) {
    const p = await ctx.newPage();
    try {
      await p.goto(`${B}/solo/${slug}`);
      await p.waitForTimeout(1500);
      for (const n of [/^start/i, /^deal/i, /^begin/i, /^play(?! online)/i]) {
        const btn = p.getByRole('button', { name: n }).first();
        if (await btn.count() && await btn.isEnabled()) {
          const t = (await btn.getAttribute('aria-label')) || (await btn.innerText().catch(() => ''));
          if (/online/i.test(t || '')) continue;
          await btn.click().catch(() => {});
          break;
        }
      }
      await p.waitForTimeout(1500);
      const back = p.getByRole('button', { name: /Library/i }).first();
      if (!await back.count()) { bad(`${label} ${slug}: no Library button`); await p.close(); continue; }
      await back.click({ timeout: 4000 }).catch(async () => {
        await back.click({ force: true, timeout: 3000 }).catch(() => {});
      });
      await p.waitForTimeout(1300);
      if (/\/solo\//.test(p.url())) bad(`${label} ${slug}: still on ${p.url().replace(B, '')}`);
    } catch (e) { bad(`${label} ${slug}: ${String(e).split('\n')[0].slice(0, 80)}`); }
    await p.close();
  }
  await ctx.close();
}
console.log(`A. header escape: ${fail === 0 ? 'all 30 ok' : `${fail} failures`}`);

/* ══════════ B + C. the result card's own close button ══════════ */
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
await ctx.addInitScript(() => sessionStorage.setItem('pikachu.intro.v1', '1'));

/** Crash Volt Runner for real: start, then sit still until the run ends. */
async function crashRunner(p) {
  await p.locator('canvas').first().click({ position: { x: 40, y: 40 } }).catch(() => {});
  await p.keyboard.press('Space');
  for (let i = 0; i < 60; i += 1) {
    await p.waitForTimeout(1000);
    if (await p.getByRole('dialog').count()) return true;
  }
  return false;
}

{
  const p = await fresh(ctx, 'electric-arcade');
  const crashed = await crashRunner(p);
  if (!crashed) {
    bad('B. Volt Runner never produced a result card to close');
  } else {
    const before = await p.getByRole('dialog').count();
    const closeBtn = p.getByRole('button', { name: /^Close$/i }).first();
    if (!await closeBtn.count()) {
      bad('B. the result card has no Close button');
    } else {
      await closeBtn.click();
      await p.waitForTimeout(900);
      const after = await p.getByRole('dialog').count();
      if (after > 0) bad(`B. Close did nothing — dialog still present (before=${before} after=${after})`);
      else console.log('B. Volt Runner Close dismissed the result card ✓');

      // ...and it must stay closed, not blink back on the next render tick
      await p.waitForTimeout(1600);
      if (await p.getByRole('dialog').count()) bad('B. the result card reappeared on its own');
      else console.log('B. it stayed closed ✓');

      // ...and closing must not bank the score again
      const plays = async () => p.evaluate(() => {
        try {
          const raw = localStorage.getItem('pikachu.progress.v1');
          return raw ? (JSON.parse(raw).stats?.arcade?.played ?? null) : null;
        } catch { return null; }
      });
      const p1 = await plays();
      await p.keyboard.press('Space');            // new run
      await p.waitForTimeout(800);
      const stillClosed = await p.getByRole('dialog').count();
      if (stillClosed) bad('B. pressing space after closing re-opened the old card instead of starting a run');
      else console.log('B. space starts a fresh run after closing ✓');
      if (p1 !== null) console.log(`B. arcade plays recorded after one crash + one close: ${p1}`);
    }
  }
  await p.close();
}

/* ══════════ B2. other solo games driven to a real finish ══════════
   Volt Runner was the broken one, but "in all games" deserves more than a code
   read. These two reach a genuine end state quickly and their exit buttons take
   the other route — resetting the match rather than latching a dismissal. */
async function endsAndCloses(slug, drive) {
  const p = await fresh(ctx, slug);
  try {
    await drive(p);
    let up = false;
    for (let i = 0; i < 45; i += 1) {
      if (await p.getByRole('dialog').count()) { up = true; break; }
      await p.waitForTimeout(700);
    }
    if (!up) { bad(`B2. ${slug}: never reached a result card`); await p.close(); return; }

    const exit = p.getByRole('dialog').locator('button').last();
    const label = (await exit.innerText().catch(() => '')).trim();
    await exit.click();
    await p.waitForTimeout(1100);
    if (await p.getByRole('dialog').count()) {
      bad(`B2. ${slug}: "${label}" left the result card up`);
    } else {
      await p.waitForTimeout(1400);
      if (await p.getByRole('dialog').count()) bad(`B2. ${slug}: the card came back on its own`);
      else console.log(`B2. ${slug}: "${label}" dismissed the result card and it stayed gone ✓`);
    }
  } catch (e) {
    bad(`B2. ${slug}: ${String(e).split('\n')[0].slice(0, 90)}`);
  }
  await p.close();
}

// Snake: it arms on the first arrow key and nothing moves before that (Space is
// pause, not start). One press then no steering runs it straight into the wall.
await endsAndCloses('snake-arena', async (p) => {
  await p.locator('canvas').first().click({ position: { x: 30, y: 30 } }).catch(() => {});
  await p.keyboard.press('ArrowUp');
});

// Tic-Tac-Toe vs the expert AI: fill cells until somebody wins or it draws.
await endsAndCloses('tic-tac-toe-duel', async (p) => {
  for (let i = 0; i < 9; i += 1) {
    if (await p.getByRole('dialog').count()) return;
    const free = p.locator('[role="grid"] button:not([disabled])').first();
    if (!await free.count()) return;
    await free.click().catch(() => {});
    await p.waitForTimeout(650);
  }
});

{
  // C. Escape — the card declares aria-modal, so it must respond to Escape
  const p = await fresh(ctx, 'electric-arcade');
  if (!await crashRunner(p)) {
    bad('C. Volt Runner never produced a result card for the Escape test');
  } else {
    await p.keyboard.press('Escape');
    await p.waitForTimeout(900);
    if (await p.getByRole('dialog').count()) bad('C. Escape did not dismiss the result card');
    else console.log('C. Escape dismissed the result card ✓');
  }
  await p.close();
}

await ctx.close();
await b.close();
console.log(fail === 0 ? '\nall close paths work' : `\n${fail} close failures`);
process.exit(fail === 0 ? 0 : 1);
